"""Phase 3 efficiency tests — lazy loading, fewer LLM calls, vector index,
web cache + shared HTTP client.

Runs with no model, no network and no server: a FakeBrain records LLM calls,
a FakeEmbedder returns deterministic vectors, and web providers are stubbed.
"""
import asyncio
import os
import tempfile
import unittest
from pathlib import Path

from jarvis.config import Config, load_config
from jarvis.core.brain import BrainReply
from jarvis.core.events import EventKind
from jarvis.core.orchestrator import Orchestrator, _looks_complex
from jarvis.core.semantic_memory import SemanticMemory, _from_blob, _to_blob
from jarvis.core.memory_store import MemoryStore
from jarvis.core.permissions import PermissionManager
from jarvis.core.logger import ActionLog
from jarvis.plugins.registry import PluginRegistry


# ----------------------------------------------------------------------
# Fake brain — routes each prompt kind to a canned reply and counts calls.
# ----------------------------------------------------------------------
class FakeBrain:
    def __init__(self, reflect_verdict: str = "DONE", suggest_delay: float = 0.0):
        self.chat_calls: list[str] = []
        self.stream_calls = 0
        self.reflect_verdict = reflect_verdict
        self.suggest_delay = suggest_delay

    def build_system_prompt(self, persona: str, tools_doc: str) -> str:
        return persona + "\n" + tools_doc

    async def chat(self, messages, tool_schemas=None) -> BrainReply:
        blob = "\n".join(str(m.get("content", "")) for m in messages)
        if "planning stage" in blob:
            self.chat_calls.append("plan")
            return BrainReply(text="1. Draft the meal plan\n2. Make the shopping list\n3. Estimate the cost")
        if "verify whether" in blob:
            self.chat_calls.append("reflect")
            return BrainReply(text=self.reflect_verdict)
        if "propose what the user might want" in blob:
            self.chat_calls.append("suggest")
            if self.suggest_delay:
                await asyncio.sleep(self.suggest_delay)
            return BrainReply(text="Check the pantry\nPlan next week")
        if "compress conversation" in blob:
            self.chat_calls.append("summarize")
            return BrainReply(text="• User discussed meal planning\n• Shopping list requested")
        self.chat_calls.append("other")
        return BrainReply(text="ok")

    async def chat_stream(self, messages, tool_schemas=None, on_delta=None) -> BrainReply:
        self.stream_calls += 1
        # NOTE: must stay >= 40 chars — _suggest() ignores shorter replies.
        return BrainReply(text="Quantum computers use qubits, sir — they compute with superposition and entanglement.")

    async def aclose(self) -> None:
        pass


def _make_orchestrator(tmp: str, brain: FakeBrain) -> Orchestrator:
    cfg = Config()
    cfg.project_root = Path(tmp)
    cfg.memory.db_path = os.path.join(tmp, "memory.db")
    cfg.logging.action_log = os.path.join(tmp, "actions.jsonl")
    cfg.ultimate.enabled = True
    cfg.ultimate.semantic_memory = False
    cfg.ultimate.auto_remember = False
    cfg.ultimate.autonomous_planning = True
    cfg.ultimate.plan_min_chars = 60
    cfg.ultimate.plan_require_complexity = True
    cfg.ultimate.proactive_suggestions = True
    cfg.ultimate.context_compaction = True
    cfg.ultimate.compaction_trigger_messages = 28
    cfg.ultimate.compaction_keep_recent = 12
    registry = PluginRegistry(cfg)
    memory = MemoryStore(cfg, semantic=None)
    return Orchestrator(cfg, brain, registry, memory, PermissionManager(cfg), ActionLog(cfg))


def _collect_turn(orch, text, timeout_s: float = 5.0):
    """Run one turn AND drain its late follow-ups in a SINGLE event loop.

    (A separate asyncio.run() per phase would cancel the fire-and-forget
    late tasks at loop shutdown — production runs one long-lived loop, so
    the test must too.) Returns (events, late_events, turn_seconds)."""
    import time

    async def _run():
        t0 = time.monotonic()
        events = []
        async for ev in orch.handle_user_message(text):
            events.append(ev)
        elapsed = time.monotonic() - t0
        late = []
        async for ev in orch.drain_late_events(timeout_s=timeout_s):
            late.append(ev)
        return events, late, elapsed

    return asyncio.run(_run())


class Phase3ConfigTests(unittest.TestCase):
    def test_lazy_loading_is_the_default(self):
        cfg = load_config()
        self.assertIs(cfg.voice.preload_models, False)
        self.assertIs(cfg.ultimate.plan_require_complexity, True)

    def test_flux_idle_unload_is_positive(self):
        from jarvis.plugins.media.flux import _FLUX_IDLE_UNLOAD_S

        self.assertEqual(_FLUX_IDLE_UNLOAD_S, 120.0)


class WhisperEvictionTests(unittest.TestCase):
    def test_evict_drops_cached_model_by_default(self):
        import jarvis.models.whisper as w

        old = w._whisper_model
        old_env = os.environ.pop("EVICT_WHISPER_FOR_FLUX", None)
        try:
            w._whisper_model = object()  # sentinel: "a loaded model"
            w._evict_whisper_from_gpu()
            self.assertIsNone(w._whisper_model)
        finally:
            w._whisper_model = old
            if old_env is not None:
                os.environ["EVICT_WHISPER_FOR_FLUX"] = old_env

    def test_evict_opt_out_keeps_model_resident(self):
        import jarvis.models.whisper as w

        old = w._whisper_model
        os.environ["EVICT_WHISPER_FOR_FLUX"] = "0"
        try:
            sentinel = object()
            w._whisper_model = sentinel
            w._evict_whisper_from_gpu()
            self.assertIs(w._whisper_model, sentinel)
        finally:
            w._whisper_model = old
            del os.environ["EVICT_WHISPER_FOR_FLUX"]


class PlanGateTests(unittest.TestCase):
    def test_long_single_question_is_not_complex(self):
        self.assertFalse(_looks_complex(
            "What is the capital of France, and can you also tell me about "
            "its history and population in detail, plus the best time to visit?"
        ))

    def test_multi_step_requests_are_complex(self):
        self.assertTrue(_looks_complex(
            "Build a weekly meal plan for a family of four, then create a "
            "shopping list for the first week and estimate the total cost"
        ))
        self.assertTrue(_looks_complex(
            "Fix the bug in app.py where login fails, then run the tests "
            "and tell me if they pass"
        ))
        self.assertTrue(_looks_complex("1: search for cats\n2: show me pictures of dogs"))

    def test_maybe_plan_skips_llm_call_for_long_simple_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            brain = FakeBrain()
            orch = _make_orchestrator(tmp, brain)
            plan = asyncio.run(orch._maybe_plan(
                "What is the capital of France, and can you also tell me "
                "about its history and population in detail, plus the best "
                "time to visit?"
            ))
            self.assertEqual(plan, "")
            self.assertEqual(brain.chat_calls, [])

    def test_maybe_plan_calls_llm_once_for_complex_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            brain = FakeBrain()
            orch = _make_orchestrator(tmp, brain)
            plan = asyncio.run(orch._maybe_plan(
                "Build a weekly meal plan for a family of four, then create "
                "a shopping list for the first week and estimate the total cost"
            ))
            self.assertIn("meal plan", plan)
            self.assertEqual(brain.chat_calls, ["plan"])


class LateFollowUpTests(unittest.TestCase):
    SIMPLE = "Explain how quantum computers work in simple terms"
    COMPLEX = (
        "Build a weekly meal plan for a family of four, then create a "
        "shopping list for the first week and estimate the total cost"
    )

    def test_done_arrives_before_slow_suggestions(self):
        """The reply + DONE must not wait on the suggestion LLM call."""
        with tempfile.TemporaryDirectory() as tmp:
            brain = FakeBrain(suggest_delay=0.5)
            orch = _make_orchestrator(tmp, brain)
            events, late, elapsed = _collect_turn(orch, self.SIMPLE)
            kinds = [e.kind for e in events]
            self.assertEqual(kinds, [EventKind.THINKING, EventKind.ASSISTANT, EventKind.DONE])
            self.assertLess(elapsed, 0.3, "DONE waited on the suggestion call")
            # Suggestions arrive afterwards, via the late drain.
            self.assertEqual([e.kind for e in late], [EventKind.SUGGESTIONS])
            self.assertEqual(late[0].payload["items"], ["Check the pantry", "Plan next week"])
            self.assertEqual(brain.chat_calls, ["suggest"])

    def test_planned_turn_reflects_late_and_surfaces_next_step(self):
        with tempfile.TemporaryDirectory() as tmp:
            brain = FakeBrain(reflect_verdict="Call web_search for prices")
            orch = _make_orchestrator(tmp, brain)
            events, late, _ = _collect_turn(orch, self.COMPLEX)
            kinds = [e.kind for e in events]
            self.assertIn(EventKind.PLAN, kinds)
            self.assertEqual(kinds[-1], EventKind.DONE)
            # No SUGGESTIONS / INFO inline — reflect + suggest run late.
            self.assertNotIn(EventKind.SUGGESTIONS, kinds)
            self.assertNotIn(EventKind.INFO, kinds)
            late_kinds = [e.kind for e in late]
            self.assertIn(EventKind.SUGGESTIONS, late_kinds)
            self.assertIn(EventKind.INFO, late_kinds)
            info = next(e for e in late if e.kind is EventKind.INFO)
            self.assertIn("Call web_search for prices", info.text)
            self.assertEqual(sorted(brain.chat_calls), ["plan", "reflect", "suggest"])

    def test_compaction_runs_late_and_summarizes(self):
        with tempfile.TemporaryDirectory() as tmp:
            brain = FakeBrain()
            orch = _make_orchestrator(tmp, brain)
            # Fake a long session: 15 alternating turns (over the trigger).
            for i in range(15):
                orch._history.append({"role": "user", "content": f"question {i}"})
                orch._history.append({"role": "assistant", "content": f"answer {i}"})
            before = len(orch._history)
            events, late, _ = _collect_turn(orch, self.SIMPLE)
            self.assertEqual(events[-1].kind, EventKind.DONE)
            # Compaction must NOT have run inline: no INFO event yet, and
            # the summarize call happens only after the reply is out.
            self.assertNotIn(EventKind.INFO, [e.kind for e in events])
            self.assertIn("summarize", brain.chat_calls)
            self.assertTrue(orch._running_summary)
            self.assertLess(len(orch._history), before)
            self.assertTrue(any(
                e.kind is EventKind.INFO and "compacted" in e.text for e in late
            ))


class SemanticMemoryTests(unittest.TestCase):
    VECS = {
        "cats are cute": [1.0, 0.0, 0.0, 0.0],
        "dogs are loyal": [0.0, 1.0, 0.0, 0.0],
        "fish swim deep": [0.0, 0.0, 1.0, 0.0],
        "i love cats": [0.9, 0.1, 0.0, 0.0],
    }

    class FakeEmbedder:
        def __init__(self, vecs):
            self.vecs = vecs

        async def embed(self, text):
            return list(self.vecs.get(text, [0.0, 0.0, 0.0, 1.0]))

    def _make_sm(self, tmp, prefer_vec):
        cfg = Config()
        cfg.project_root = Path(tmp)
        cfg.memory.db_path = os.path.join(tmp, "mem.db")
        return SemanticMemory(cfg, self.FakeEmbedder(self.VECS), prefer_vec=prefer_vec)

    def test_blob_roundtrip_matches_old_numpy_format(self):
        # float32 little-endian — byte-identical to numpy tobytes() on x86.
        self.assertEqual(_from_blob(_to_blob([1.0, -2.5]), 2), [1.0, -2.5])

    def _exercise_backend(self, prefer_vec):
        with tempfile.TemporaryDirectory() as tmp:
            sm = self._make_sm(tmp, prefer_vec)
            expected_backend = "sqlite-vec" if prefer_vec else "python"
            self.assertEqual(sm.index_backend, expected_backend)

            async def _run():
                self.assertTrue(await sm.remember("cats are cute"))
                self.assertTrue(await sm.remember("dogs are loyal"))
                self.assertTrue(await sm.remember("fish swim deep"))
                self.assertFalse(await sm.remember("cats are cute"))  # dup
                self.assertEqual(sm.count(), 3)
                hits = await sm.recall("i love cats", k=2, min_score=0.0)
                self.assertEqual([h["text"] for h in hits], ["cats are cute", "dogs are loyal"])
                self.assertGreater(hits[0]["score"], 0.99)
                self.assertAlmostEqual(hits[1]["score"], 0.1104, places=3)
                # Default min_score filters the weak second hit.
                self.assertEqual(len(await sm.recall("i love cats", k=2)), 1)
                first_id = hits[0]["id"]
                self.assertTrue(sm.forget(first_id))
                after = await sm.recall("i love cats", k=1, min_score=0.0)
                self.assertEqual(after[0]["text"], "dogs are loyal")
                return sm

            sm = asyncio.run(_run())
            # Reopen: the index must survive a restart.
            sm2 = self._make_sm(tmp, prefer_vec)
            self.assertEqual(sm2.index_backend, expected_backend)
            hits = asyncio.run(sm2.recall("i love cats", k=1, min_score=0.0))
            self.assertEqual(hits[0]["text"], "dogs are loyal")

    def test_sqlite_vec_backend(self):
        self._exercise_backend(prefer_vec=True)

    def test_python_fallback_backend(self):
        self._exercise_backend(prefer_vec=False)

    def test_vec_table_mirrors_source_rows(self):
        import sqlite3

        with tempfile.TemporaryDirectory() as tmp:
            sm = self._make_sm(tmp, prefer_vec=True)
            self.assertEqual(sm.index_backend, "sqlite-vec")

            async def _run():
                await sm.remember("cats are cute")
                await sm.remember("dogs are loyal")

            asyncio.run(_run())
            import sqlite_vec

            conn = sqlite3.connect(os.path.join(tmp, "mem.db"))
            conn.enable_load_extension(True)
            conn.load_extension(sqlite_vec.loadable_path())
            try:
                n = conn.execute(
                    "SELECT COUNT(*) FROM semantic_memory_vec"
                ).fetchone()[0]
            finally:
                conn.close()
            self.assertEqual(n, 2)

    def test_python_index_loads_once_and_appends(self):
        with tempfile.TemporaryDirectory() as tmp:
            sm = self._make_sm(tmp, prefer_vec=False)

            async def _run():
                await sm.remember("cats are cute")
                await sm.remember("dogs are loyal")
                await sm.recall("i love cats", k=1)
                idx_obj = sm._py_index
                # A second recall must NOT rebuild the matrix…
                await sm.recall("i love cats", k=1)
                self.assertIs(sm._py_index, idx_obj)
                # …and a new fact appends incrementally instead.
                await sm.remember("fish swim deep")
                self.assertEqual(len(sm._py_index), 3)

            asyncio.run(_run())


class WebCacheTests(unittest.TestCase):
    def test_cache_put_get_and_expiry(self):
        import time as _time

        from jarvis.plugins import web_tools

        web_tools.clear_web_cache()
        key = ("web_search", "duckduckgo", "q", 3)
        self.assertIsNone(web_tools._cache_get(key))
        web_tools._cache_put(key, "result")
        self.assertEqual(web_tools._cache_get(key), "result")
        # Expired entry is a miss.
        web_tools._web_cache[key] = (_time.monotonic() - 1, "stale")
        self.assertIsNone(web_tools._cache_get(key))
        web_tools.clear_web_cache()

    def test_cache_evicts_oldest_when_full(self):
        from jarvis.plugins import web_tools

        web_tools.clear_web_cache()
        for i in range(web_tools._WEB_CACHE_MAX_ENTRIES + 5):
            web_tools._cache_put(("k", i), "v")
        self.assertEqual(len(web_tools._web_cache), web_tools._WEB_CACHE_MAX_ENTRIES)
        self.assertNotIn(("k", 0), web_tools._web_cache)
        self.assertIn(("k", web_tools._WEB_CACHE_MAX_ENTRIES + 4), web_tools._web_cache)
        web_tools.clear_web_cache()

    def test_shared_client_is_stable_within_a_loop(self):
        from jarvis.plugins import web_tools

        async def _run():
            c1 = web_tools._get_client()
            c2 = web_tools._get_client()
            self.assertIs(c1, c2)
            await web_tools.aclose_shared_client()

        asyncio.run(_run())

    def test_shared_client_is_recreated_on_loop_change(self):
        from jarvis.plugins import web_tools

        async def _run():
            return web_tools._get_client()

        c1 = asyncio.run(_run())
        c2 = asyncio.run(_run())
        self.assertIsNot(c1, c2)
        asyncio.run(web_tools.aclose_shared_client())

    def test_web_search_is_cached_at_tool_level(self):
        from jarvis.config import PluginToggle
        from jarvis.plugins import web_tools

        cfg = Config()
        cfg.plugins["web_tools"] = PluginToggle(enabled=True, provider="duckduckgo")
        registry = PluginRegistry(cfg)
        web_tools.register(registry)
        tool = registry.get("web_search")
        self.assertIsNotNone(tool)
        calls = []

        async def _fake_search(provider, query, n):
            calls.append((provider, query, n))
            return [{"title": "T", "url": "https://example.com", "snippet": "S"}]

        web_tools.clear_web_cache()
        orig = web_tools._do_search
        web_tools._do_search = _fake_search
        try:
            async def _run():
                r1 = await tool.invoke({"query": "flibberty gibbet xyz", "max_results": 3})
                r2 = await tool.invoke({"query": "flibberty gibbet xyz", "max_results": 3})
                return r1, r2

            r1, r2 = asyncio.run(_run())
            self.assertEqual(r1, r2)
            self.assertEqual(len(calls), 1)  # second call served from cache
        finally:
            web_tools._do_search = orig
            web_tools.clear_web_cache()

    def test_web_fetch_is_cached_and_errors_are_not(self):
        from jarvis.plugins import web_tools

        class FakeResponse:
            def __init__(self, text, status_code=200):
                self.text = text
                self.status_code = status_code

        class FakeClient:
            def __init__(self):
                self.get_calls = []

            async def get(self, url, **kwargs):
                self.get_calls.append(url)
                if "boom" in url:
                    return FakeResponse("nope", status_code=500)
                return FakeResponse("<html><body>hello world</body></html>")

        cfg = Config()
        registry = PluginRegistry(cfg)
        web_tools.register(registry)
        tool = registry.get("web_fetch")
        self.assertIsNotNone(tool)
        fake = FakeClient()
        orig = web_tools._get_client
        web_tools._get_client = lambda: fake
        web_tools.clear_web_cache()
        try:
            async def _run():
                ok1 = await tool.invoke({"url": "https://example.com/page", "max_chars": 8000})
                ok2 = await tool.invoke({"url": "https://example.com/page", "max_chars": 8000})
                err1 = await tool.invoke({"url": "https://example.com/boom", "max_chars": 8000})
                err2 = await tool.invoke({"url": "https://example.com/boom", "max_chars": 8000})
                return ok1, ok2, err1, err2

            ok1, ok2, err1, err2 = asyncio.run(_run())
            self.assertEqual(ok1, "hello world")
            self.assertEqual(ok1, ok2)
            self.assertIn("HTTP 500", err1)
            # Success cached (1 GET), errors not cached (2 GETs).
            self.assertEqual(fake.get_calls.count("https://example.com/page"), 1)
            self.assertEqual(fake.get_calls.count("https://example.com/boom"), 2)
        finally:
            web_tools._get_client = orig
            web_tools.clear_web_cache()


if __name__ == "__main__":
    unittest.main()
