"""Phase 4 assistant-behaviour tests — persistent tasks, voice state
machine, Arabic STT config, LLM retries, project goals, action-log
visibility. No model, no network, no server process (TestClient runs the
app in-process; the /models probe just reports unreachable).
"""
import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path

import httpx
import pytest

from jarvis.config import Config, load_config
from jarvis.core import brain as brain_mod
from jarvis.core.brain import BrainReply, LLMBrain
from jarvis.core.events import EventKind
from jarvis.core.logger import ActionLog
from jarvis.core.memory_store import MemoryStore
from jarvis.core.orchestrator import Orchestrator
from jarvis.core.permissions import PermissionManager
from jarvis.core.tasks import TaskScheduler, TaskStore, build_task_system
from jarvis.core.voice_state import VoiceState, VoiceStateMachine
from jarvis.models.whisper import (
    STT_INITIAL_PROMPT_AR,
    STT_INITIAL_PROMPT_EN,
    _filter_whisper_hallucination,
    build_transcribe_kwargs,
)
from jarvis.plugins.registry import PluginRegistry


def _cfg(tmp: str) -> Config:
    cfg = Config()
    cfg.project_root = Path(tmp)
    cfg.memory.db_path = os.path.join(tmp, "memory.db")
    cfg.logging.action_log = os.path.join(tmp, "actions.jsonl")
    cfg.ultimate.enabled = True
    cfg.ultimate.semantic_memory = False
    cfg.ultimate.auto_remember = False
    return cfg


# ----------------------------------------------------------------------
# 1. Persistent tasks
# ----------------------------------------------------------------------
class TaskStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.store = TaskStore(_cfg(self.tmp))

    def test_create_list_get_roundtrip(self):
        t = self.store.create("Remind me", kind="reminder", payload={"message": "hi"},
                              run_at=1893456000.0)
        self.assertEqual(t["status"], "pending")
        self.assertEqual(t["payload"], {"message": "hi"})
        self.assertEqual(t["next_run"], 1893456000.0)
        self.assertEqual(self.store.get(t["id"])["title"], "Remind me")
        self.assertEqual(len(self.store.list_tasks()), 1)

    def test_tasks_survive_reopen(self):
        t = self.store.create("Persist me", run_at=1893456000.0)
        reopened = TaskStore(_cfg(self.tmp))
        self.assertEqual(reopened.get(t["id"])["title"], "Persist me")

    def test_bad_cron_rejected(self):
        with self.assertRaises(ValueError):
            self.store.create("Bad cron", schedule="not a cron")

    def test_cron_computes_next_run(self):
        t = self.store.create("Daily", schedule="0 9 * * *")
        self.assertIsNotNone(t["next_run"])
        self.assertGreater(t["next_run"], 0)

    def test_cancel_and_update(self):
        t = self.store.create("To cancel")
        self.assertEqual(self.store.cancel(t["id"])["status"], "cancelled")
        t2 = self.store.create("To edit")
        upd = self.store.update(t2["id"], title="Edited")
        self.assertEqual(upd["title"], "Edited")
        with self.assertRaises(ValueError):
            self.store.update(t2["id"], status="bogus")

    def test_blank_title_rejected(self):
        with self.assertRaises(ValueError):
            self.store.create("   ")


class TaskSchedulerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cfg = _cfg(self.tmp)
        self.memory = MemoryStore(self.cfg, semantic=None)
        self.store, self.sched = build_task_system(self.cfg, memory=self.memory,
                                                   actions=ActionLog(self.cfg))

    def test_reminder_runs_and_marks_done(self):
        t = self.store.create("Say hi", kind="reminder", payload={"message": "hello sir"})
        done = asyncio.run(self.sched.run_task(t["id"]))
        self.assertEqual(done["status"], "done")
        self.assertEqual(done["result"], "hello sir")

    def test_note_task_writes_memory(self):
        t = self.store.create("Save note", kind="note",
                              payload={"project": "jarvis", "note": "phase 4 done"})
        done = asyncio.run(self.sched.run_task(t["id"]))
        self.assertEqual(done["status"], "done")
        self.assertEqual(self.memory.notes("jarvis")[0]["note"], "phase 4 done")

    def test_custom_handler(self):
        async def handler(task):
            return "custom:" + task["title"]
        self.sched.register_handler("custom", handler)
        t = self.store.create("Custom job", kind="custom")
        done = asyncio.run(self.sched.run_task(t["id"]))
        self.assertEqual(done["result"], "custom:Custom job")

    def test_unknown_kind_fails_visibly(self):
        t = self.store.create("Mystery", kind="nope")
        done = asyncio.run(self.sched.run_task(t["id"]))
        self.assertEqual(done["status"], "failed")
        self.assertIn("no handler", done["result"])

    def test_cron_task_rearms(self):
        t = self.store.create("Hourly", kind="reminder", schedule="0 * * * *")
        done = asyncio.run(self.sched.run_task(t["id"]))
        self.assertEqual(done["status"], "pending")  # re-armed, not done
        self.assertIsNotNone(done["next_run"])


# ----------------------------------------------------------------------
# 2. Voice state machine
# ----------------------------------------------------------------------
class VoiceStateTests(unittest.TestCase):
    def test_happy_path(self):
        vs = VoiceStateMachine()
        self.assertEqual(vs.value, "idle")
        self.assertTrue(vs.begin_listening())
        self.assertTrue(vs.begin_thinking())
        self.assertTrue(vs.begin_speaking())
        self.assertTrue(vs.to_idle())

    def test_illegal_transition_rejected(self):
        vs = VoiceStateMachine()
        self.assertFalse(vs.begin_speaking.__self__.transition(VoiceState.INTERRUPTED, "x"))
        self.assertEqual(vs.value, "idle")

    def test_barge_in(self):
        vs = VoiceStateMachine()
        vs.begin_speaking()
        self.assertTrue(vs.barge_in())
        self.assertEqual(vs.value, "listening")
        self.assertEqual(vs.history()[-2]["state"], "interrupted")

    def test_barge_in_when_idle_is_noop(self):
        vs = VoiceStateMachine()
        self.assertFalse(vs.barge_in())
        self.assertEqual(vs.value, "idle")

    def test_cancel_from_speaking(self):
        vs = VoiceStateMachine()
        vs.begin_speaking()
        self.assertTrue(vs.cancel())
        self.assertEqual(vs.value, "idle")


# ----------------------------------------------------------------------
# 3. Arabic STT config
# ----------------------------------------------------------------------
class SttConfigTests(unittest.TestCase):
    def test_default_language_is_arabic(self):
        cfg = load_config()
        self.assertEqual(cfg.voice.stt_language, "ar")
        self.assertIsNone(cfg.voice.stt_initial_prompt)

    def test_arabic_kwargs_by_default(self):
        kw = build_transcribe_kwargs(None)
        self.assertEqual(kw["language"], "ar")
        self.assertEqual(kw["initial_prompt"], STT_INITIAL_PROMPT_AR)

    def test_english_override(self):
        cfg = Config()
        cfg.voice.stt_language = "en"
        kw = build_transcribe_kwargs(cfg)
        self.assertEqual(kw["language"], "en")
        self.assertEqual(kw["initial_prompt"], STT_INITIAL_PROMPT_EN)

    def test_per_request_language_override(self):
        kw = build_transcribe_kwargs(None, language="en")
        self.assertEqual(kw["language"], "en")

    def test_auto_language(self):
        kw = build_transcribe_kwargs(None, language="auto")
        self.assertIsNone(kw["language"])

    def test_arabic_hallucination_filtered(self):
        self.assertEqual(_filter_whisper_hallucination("شكرا على المشاهدة"), "")
        self.assertEqual(_filter_whisper_hallucination("اشتركوا في القناة"), "")
        self.assertEqual(_filter_whisper_hallucination("ابحث عن الأخبار"), "ابحث عن الأخبار")

    def test_arabic_persona_now_default(self):
        # 2026-11-24: the user chose Arabic as the default voice/persona.
        # (Was test_english_persona_still_default in Phase 4, when English
        # was the default and Arabic was opt-in.)
        cfg = load_config()
        self.assertEqual(cfg.A.persona_file, "persona/jarvis-ar.md")
        self.assertTrue(Path(cfg.project_root, "persona/jarvis-ar.md").is_file())
        # English persona still ships, so switching back stays one line.
        self.assertTrue(Path(cfg.project_root, "persona/jarvis.md").is_file())


# ----------------------------------------------------------------------
# 4. LLM retries
# ----------------------------------------------------------------------
class _FakeResp:
    status_code = 200

    def raise_for_status(self):
        pass

    def json(self):
        return {"choices": [{"message": {"content": "hello", "tool_calls": None},
                             "finish_reason": "stop"}]}


def _req():
    return httpx.Request("POST", "http://localhost:11434/v1/chat/completions")


class _FlakyClient:
    def __init__(self, failures=2):
        self.calls = 0
        self.failures = failures

    async def post(self, *a, **k):
        self.calls += 1
        if self.calls <= self.failures:
            raise httpx.ConnectError("boom", request=_req())
        return _FakeResp()

    async def aclose(self):
        pass


class _BadClient:
    def __init__(self):
        self.calls = 0

    async def post(self, *a, **k):
        self.calls += 1
        resp = httpx.Response(400, request=_req())
        raise httpx.HTTPStatusError("bad request", request=_req(), response=resp)

    async def aclose(self):
        pass


class BrainRetryTests(unittest.TestCase):
    def setUp(self):
        brain_mod.LLM_RETRY_BASE_S = 0

    def _brain_with(self, client):
        # LLMBrain() builds a real httpx.AsyncClient, which chokes on this
        # sandbox's no_proxy env ([ipv6] entries) — pre-existing env quirk,
        # unrelated to retries. Bypass the ctor for the retry unit tests.
        brain = LLMBrain.__new__(LLMBrain)
        brain.cfg = Config()
        brain.mc = brain.cfg.model
        brain._client = client
        return brain

    def test_transient_failures_retried_then_succeed(self):
        brain = self._brain_with(_FlakyClient(failures=2))
        reply = asyncio.run(brain.chat([{"role": "user", "content": "hi"}]))
        self.assertEqual(reply.text, "hello")
        self.assertEqual(brain._client.calls, 3)

    def test_non_transient_400_not_retried(self):
        brain = self._brain_with(_BadClient())
        reply = asyncio.run(brain.chat([{"role": "user", "content": "hi"}]))
        self.assertTrue(reply.text.startswith("[brain error] HTTP 400"))
        self.assertEqual(brain._client.calls, 1)


# ----------------------------------------------------------------------
# 5. Project goals + action log
# ----------------------------------------------------------------------
class ProjectGoalsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.memory = MemoryStore(_cfg(self.tmp), semantic=None)

    def test_goal_lifecycle(self):
        gid = self.memory.add_goal("jarvis", "Finish Phase 4", "docs first")
        goals = self.memory.goals("jarvis")
        self.assertEqual(len(goals), 1)
        self.assertEqual(goals[0]["status"], "open")
        done = self.memory.complete_goal(gid)
        self.assertEqual(done["status"], "done")
        self.assertIsNotNone(done["completed_at"])
        self.assertEqual(self.memory.goals("jarvis", status="open"), [])
        self.assertEqual(len(self.memory.goals("jarvis", status="done")), 1)

    def test_goal_searchable(self):
        self.memory.add_goal("jarvis", "Ship the release")
        hits = self.memory.search("Ship the release")
        self.assertTrue(any(h["kind"] == "goal" for h in hits))

    def test_blank_goal_rejected(self):
        with self.assertRaises(ValueError):
            self.memory.add_goal("jarvis", "  ")


class ActionLogTests(unittest.TestCase):
    def test_recent_only_failed(self):
        tmp = tempfile.mkdtemp()
        cfg = _cfg(tmp)
        log = ActionLog(cfg)
        log.record("ran", tool="x", ok=True)
        log.record("failed", tool="y", ok=False, error="boom")
        log.record("denied", tool="z", ok=False)
        self.assertEqual(len(log.recent()), 3)
        failed = log.recent(only_failed=True)
        self.assertEqual(len(failed), 2)
        self.assertTrue(all(e["ok"] is False for e in failed))


# ----------------------------------------------------------------------
# 6. HTTP surface: health / tasks / goals / voice state
# ----------------------------------------------------------------------
class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cfg = _cfg(self.tmp)
        self.memory = MemoryStore(self.cfg, semantic=None)

        class FakeBrain:
            def build_system_prompt(self, persona, tools_doc):
                return persona + "\n" + tools_doc

            async def chat(self, messages, tool_schemas=None):
                return BrainReply(text="ok")

            async def chat_stream(self, messages, tool_schemas=None, on_delta=None):
                return BrainReply(text="ok")

            async def aclose(self):
                pass

        registry = PluginRegistry(self.cfg)
        orch = Orchestrator(self.cfg, FakeBrain(), registry, self.memory,
                            PermissionManager(self.cfg), ActionLog(self.cfg))
        from jarvis.core.modes import build_default_registry
        from jarvis.server.app import create_app
        self.store, self.sched = build_task_system(self.cfg, memory=self.memory,
                                                   actions=ActionLog(self.cfg))
        self.app = create_app(cfg=self.cfg, orchestrator=orch, registry=registry,
                              memory=self.memory, agents=build_default_registry(self.cfg),
                              task_store=self.store, task_scheduler=self.sched)

    def test_health_reports_model_reachability_and_voice(self):
        from fastapi.testclient import TestClient
        with TestClient(self.app) as client:
            r = client.get("/api/health")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn("reachable", body["model"])
        self.assertEqual(body["voice"]["stt_language"], "ar")
        self.assertIn("state", body["voice"])

    def test_tasks_api_crud(self):
        from fastapi.testclient import TestClient
        with TestClient(self.app) as client:
            r = client.post("/api/tasks", json={"title": "API task", "kind": "reminder",
                                                "payload": {"message": "m"}, "run_at": 1893456000.0})
            self.assertEqual(r.status_code, 200, r.text)
            tid = r.json()["id"]
            self.assertEqual(client.get("/api/tasks").json()["tasks"][0]["id"], tid)
            r = client.post(f"/api/tasks/{tid}/cancel")
            self.assertEqual(r.json()["status"], "cancelled")
            self.assertEqual(client.get(f"/api/tasks/{tid}").json()["status"], "cancelled")

    def test_tasks_api_bad_cron_400(self):
        from fastapi.testclient import TestClient
        with TestClient(self.app) as client:
            r = client.post("/api/tasks", json={"title": "x", "schedule": "bogus"})
            self.assertEqual(r.status_code, 400)

    def test_goals_api(self):
        from fastapi.testclient import TestClient
        with TestClient(self.app) as client:
            r = client.post("/api/memory/goals",
                            json={"project": "jarvis", "title": "API goal"})
            self.assertEqual(r.status_code, 200, r.text)
            gid = r.json()["id"]
            r = client.post(f"/api/memory/goals/{gid}/complete")
            self.assertEqual(r.json()["status"], "done")
            self.assertEqual(len(client.get("/api/memory/goals?project=jarvis").json()["goals"]), 1)

    def test_voice_state_api(self):
        from fastapi.testclient import TestClient
        with TestClient(self.app) as client:
            self.assertEqual(client.get("/api/voice/state").json()["state"], "idle")
            r = client.post("/api/voice/state", json={"state": "listening"})
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["state"], "listening")
            # idle -> interrupted is illegal
            client.post("/api/voice/state", json={"state": "idle"})
            r = client.post("/api/voice/state", json={"state": "interrupted"})
            self.assertEqual(r.status_code, 409)
            # interrupt from idle is a no-op; from speaking it barges in
            r = client.post("/api/voice/interrupt")
            self.assertEqual(r.json()["state"], "idle")
            client.post("/api/voice/state", json={"state": "speaking"})
            r = client.post("/api/voice/interrupt")
            self.assertEqual(r.json()["state"], "listening")  # barge-in -> listening

    def test_actions_api_only_failed(self):
        from fastapi.testclient import TestClient
        actions = ActionLog(self.cfg)
        actions.record("ran", tool="x", ok=True)
        actions.record("failed", tool="y", ok=False, error="boom")
        with TestClient(self.app) as client:
            r = client.get("/api/actions?only_failed=true")
        self.assertEqual(len(r.json()["actions"]), 1)
        self.assertEqual(r.json()["actions"][0]["tool"], "y")


if __name__ == "__main__":
    unittest.main()
