"""Backend-consolidation tests (audit/fixes merge into ui-hud-upgrade).

Covers the merged pieces that had no prior test: the KeyManager rotation,
the provider failover cascade (tiers + key rotation + no-cascade on
non-transient 4xx), and the schema-less memory entities behind the
db_* tools. No model, no network, no server process.
"""
import asyncio
import os
import tempfile
import unittest
from pathlib import Path

import httpx

from jarvis.config import Config
from jarvis.core import brain as brain_mod
from jarvis.core.brain import BrainReply, LLMBrain, _brain_error_status, _is_local_endpoint
from jarvis.core.key_manager import KeyManager, mask_key
from jarvis.core.memory_store import MemoryStore
from jarvis.plugins.registry import PluginRegistry


def _cfg(tmp: str) -> Config:
    cfg = Config()
    cfg.project_root = Path(tmp)
    cfg.memory.db_path = os.path.join(tmp, "memory.db")
    cfg.logging.action_log = os.path.join(tmp, "actions.jsonl")
    return cfg


def _req(url: str = "http://localhost:11434/v1/chat/completions"):
    return httpx.Request("POST", url)


class _FakeResp:
    status_code = 200

    def raise_for_status(self):
        pass

    def json(self):
        return {"choices": [{"message": {"content": "hello", "tool_calls": None},
                             "finish_reason": "stop"}]}


class KeyManagerTests(unittest.TestCase):
    def test_round_robin_and_rotation(self):
        km = KeyManager({"groq": ["k1", "k2"]})
        self.assertEqual(km.get_active_key("groq"), "k1")
        self.assertEqual(km.get_active_key("groq"), "k2")
        self.assertEqual(km.get_active_key("groq"), "k1")

    def test_rate_limited_key_cools_down_then_next_key_served(self):
        km = KeyManager({"groq": ["k1", "k2"]})
        self.assertEqual(km.get_active_key("groq"), "k1")
        nxt = km.mark_rate_limited("groq", "k1", cooldown_seconds=3600)
        self.assertEqual(nxt, "k2")
        # k1 is cooling down: rotation keeps serving k2
        self.assertEqual(km.get_active_key("groq"), "k2")

    def test_invalid_key_never_served_again(self):
        km = KeyManager({"groq": ["k1", "k2"]})
        km.mark_invalid("groq", "k1", "Auth failed 401")
        self.assertEqual(km.get_active_key("groq"), "k2")
        self.assertEqual(km.get_active_key("groq"), "k2")

    def test_mask_key_never_leaks_full_key(self):
        self.assertEqual(mask_key(""), "")
        self.assertEqual(mask_key("short"), "••••••••")
        masked = mask_key("sk-abcdefghijklmnop")
        self.assertNotIn("abcdefghijklmnop", masked)
        self.assertTrue(masked.startswith("sk-a"))
        self.assertTrue(masked.endswith("mnop"))


class CascadeTierTests(unittest.TestCase):
    def _brain(self):
        brain = LLMBrain.__new__(LLMBrain)
        brain.cfg = Config()
        brain.mc = brain.cfg.model
        return brain

    def test_tiers_primary_fallback_omniroute(self):
        tiers = self._brain().get_cascade_tiers()
        self.assertEqual(tiers[0].provider, "openai_compatible")
        self.assertEqual(tiers[0].model, "gemma4:31b-cloud")
        self.assertTrue(tiers[0].is_local)  # localhost endpoint counts as local
        providers = [t.provider for t in tiers]
        self.assertIn("openrouter", providers)  # Tier 2 fallback
        self.assertIn("omniroute", providers)  # Tier 3 local aggregator
        omni = next(t for t in tiers if t.provider == "omniroute")
        self.assertTrue(omni.is_local)
        self.assertIn("20128", omni.endpoint)

    def test_is_local_endpoint(self):
        self.assertTrue(_is_local_endpoint("http://localhost:11434/v1"))
        self.assertTrue(_is_local_endpoint("http://127.0.0.1:20128/v1"))
        self.assertFalse(_is_local_endpoint("https://openrouter.ai/api/v1"))
        self.assertFalse(_is_local_endpoint(""))

    def test_brain_error_status_parsing(self):
        self.assertEqual(_brain_error_status(BrainReply(text="[brain error] HTTP 429: slow down")), 429)
        self.assertEqual(_brain_error_status(BrainReply(text="[brain error] HTTP 400: bad")), 400)
        self.assertIsNone(_brain_error_status(BrainReply(text="[brain error] boom")))
        self.assertIsNone(_brain_error_status(BrainReply(text="hello")))


class CascadeChatTests(unittest.TestCase):
    def setUp(self):
        brain_mod.LLM_RETRY_BASE_S = 0

    def _brain_with(self, client):
        brain = LLMBrain.__new__(LLMBrain)
        brain.cfg = Config()
        brain.mc = brain.cfg.model
        brain._client = client
        return brain

    def test_transient_500_on_primary_cascades_to_next_tier(self):
        """Primary (localhost) always 500s; the next reachable tier
        answers. 3 inner retries on Tier 0 + 1 call on the next tier."""
        class _TieredClient:
            def __init__(self):
                self.calls = 0

            async def post(self, url, *a, **k):
                self.calls += 1
                if "11434" in str(url):
                    resp = httpx.Response(500, request=_req(str(url)))
                    raise httpx.HTTPStatusError("boom", request=_req(str(url)), response=resp)
                return _FakeResp()

            async def aclose(self):
                pass

        brain = self._brain_with(_TieredClient())
        reply = asyncio.run(brain.chat([{"role": "user", "content": "hi"}]))
        self.assertEqual(reply.text, "hello")
        self.assertEqual(brain._client.calls, 4)


class MemoryEntityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.memory = MemoryStore(_cfg(self.tmp), semantic=None)

    def test_store_get_set_field_roundtrip(self):
        fields = self.memory.store_entity("devices", "laptop", {"ram": "8GB"}, ["mine"])
        self.assertEqual(fields, {"ram": "8GB"})
        self.assertEqual(self.memory.get_entity("devices", "laptop"), {"ram": "8GB"})
        fields = self.memory.set_entity_field("devices", "laptop", "cpu", "i5")
        self.assertEqual(fields, {"ram": "8GB", "cpu": "i5"})
        # set_entity_field must not wipe tags stored by store_entity
        hits = self.memory.query_entities(tag="mine")
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["key"], "laptop")

    def test_query_and_list_collections(self):
        self.assertIsNone(self.memory.get_entity("devices", "nope"))
        self.memory.store_entity("devices", "laptop", {"ram": "8GB"})
        self.memory.store_entity("devices", "phone", {"ram": "6GB"})
        self.memory.store_entity("projects", "jarvis", {"lang": "python"})
        hits = self.memory.query_entities("devices", "phone")
        self.assertEqual([h["key"] for h in hits], ["phone"])
        self.assertEqual(len(self.memory.query_entities(query="8GB")), 1)
        cols = {c["collection"]: c["count"] for c in self.memory.list_collections()}
        self.assertEqual(cols, {"devices": 2, "projects": 1})


class MemoryDbToolsTests(unittest.TestCase):
    def test_db_tools_registered_and_roundtrip(self):
        tmp = tempfile.mkdtemp()
        memory = MemoryStore(_cfg(tmp), semantic=None)
        reg = PluginRegistry(_cfg(tmp), services={"memory": memory})
        import jarvis.plugins.memory_tools as mt
        mt.register(reg)
        for name in ("db_store", "db_set_field", "db_get", "db_query", "db_list_collections"):
            self.assertIsNotNone(reg.get(name), f"{name} not registered")
        store = reg.get("db_store").handler
        self.assertIn("Stored devices:laptop", store(collection="devices", key="laptop", data={"ram": "8GB"}))
        get = reg.get("db_get").handler
        self.assertIn("8GB", get(collection="devices", key="laptop"))
        self.assertIn("Not found", get(collection="devices", key="nope"))

    def test_register_without_memory_service_skips_cleanly(self):
        reg = PluginRegistry(_cfg(tempfile.mkdtemp()), services={})
        import jarvis.plugins.memory_tools as mt
        mt.register(reg)  # must not raise KeyError
        self.assertIsNone(reg.get("remember"))


if __name__ == "__main__":
    unittest.main()
