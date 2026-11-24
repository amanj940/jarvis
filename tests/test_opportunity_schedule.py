"""Daily 09:00 opportunity scan — registration + boot wiring tests.

No network, no real API keys: the ``web_search`` tool is a fake on a
fake registry returning canned ``__JARVIS_MEDIA__`` payloads, and the
scheduler is the real ``TaskScheduler`` over a temp SQLite file. The
boot test drives the real server lifespan through a TestClient, so it
proves the job is registered when the server boots — not just that the
registration function exists.
"""
import asyncio
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from jarvis.config import Config, PluginToggle
from jarvis.core.tasks import TaskScheduler, TaskStore
from jarvis.plugins.opportunity.jobs import (
    DAILY_SCHEDULE,
    MEDIA_PREFIX,
    register_opportunity_daily_job,
)
from jarvis.plugins.opportunity.leads import LeadsStore
from jarvis.server.app import create_app, register_daily_jobs


def _cfg(tmp: str) -> Config:
    cfg = Config()
    cfg.project_root = Path(tmp)
    cfg.memory.db_path = os.path.join(tmp, "memory.db")
    cfg.logging.action_log = os.path.join(tmp, "actions.jsonl")
    return cfg


def _media_payload(items: list[dict]) -> str:
    return MEDIA_PREFIX + json.dumps(
        {"kind": "search", "items": items, "summary": "test"}, ensure_ascii=False)


class _FakeTool:
    """Stands in for the web_search Tool: async invoke, canned results."""

    def __init__(self, results: dict):
        self.results = results
        self.calls: list[dict] = []

    async def invoke(self, args: dict):
        self.calls.append(dict(args))
        return self.results.get(
            args["query"], "web search (duckduckgo): no results")


class _FakeRegistry:
    def __init__(self, tool=None):
        self._tool = tool

    def get(self, name: str):
        return self._tool if name == "web_search" else None

    def all_tools(self):
        return []

    def plugins(self):
        return []


def _hackerone_registry():
    from jarvis.plugins.opportunity.jobs import source_queries

    queries = source_queries()
    hq = [q for q in queries if q["name"] == "HackerOne"][0]["query"]
    tool = _FakeTool({hq: _media_payload([
        {"url": "https://hackerone.com/opportunities/program-a",
         "title": "Bug bounty program A — security research",
         "snippet": "New program, urgent", "source": "hackerone.com"},
        {"url": "https://hackerone.com/opportunities/program-b",
         "title": "Bug bounty program B", "snippet": "", "source": "hackerone.com"},
    ])})
    return _FakeRegistry(tool)


# ----------------------------------------------------------------------
# register_opportunity_daily_job
# ----------------------------------------------------------------------
class DailyJobRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.leads = LeadsStore(Path(self.tmp) / "opportunity.db")
        self.cfg = _cfg(self.tmp)
        self.task_store = TaskStore(self.cfg)
        self.scheduler = TaskScheduler(self.task_store)

    def _pending_scan_tasks(self):
        return self.task_store.list_tasks(
            kind="opportunity_scan", status="pending")

    def test_creates_daily_0900_cron_task(self):
        self.assertEqual(DAILY_SCHEDULE, "0 9 * * *")
        task = register_opportunity_daily_job(
            self.task_store, self.scheduler, self.leads)
        self.assertEqual(task["kind"], "opportunity_scan")
        self.assertEqual(task["schedule"], "0 9 * * *")
        self.assertEqual(task["status"], "pending")
        nxt = datetime.fromtimestamp(task["next_run"], tz=timezone.utc)
        self.assertEqual((nxt.hour, nxt.minute), (9, 0))

    def test_second_registration_reuses_same_task(self):
        first = register_opportunity_daily_job(
            self.task_store, self.scheduler, self.leads)
        second = register_opportunity_daily_job(
            self.task_store, self.scheduler, self.leads)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(self._pending_scan_tasks()), 1)

    def test_registration_realigns_drifted_schedule(self):
        task = register_opportunity_daily_job(
            self.task_store, self.scheduler, self.leads)
        self.task_store.update(task["id"], schedule="0 10 * * *")
        again = register_opportunity_daily_job(
            self.task_store, self.scheduler, self.leads)
        self.assertEqual(again["id"], task["id"])
        self.assertEqual(again["schedule"], "0 9 * * *")
        self.assertEqual(len(self._pending_scan_tasks()), 1)

    def test_registered_handler_runs_scan(self):
        registry = _hackerone_registry()
        task = register_opportunity_daily_job(
            self.task_store, self.scheduler, self.leads, registry=registry)
        self.assertIn("opportunity_scan", self.scheduler.handlers)
        result = asyncio.run(self.scheduler.run_task(task["id"]))
        self.assertEqual(self.leads.count(), 2)
        self.assertIn("program A", result.get("result") or "")


# ----------------------------------------------------------------------
# Startup wiring (jarvis/server/app.py)
# ----------------------------------------------------------------------
class StartupWiringTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cfg = _cfg(self.tmp)
        self.task_store = TaskStore(self.cfg)
        self.scheduler = TaskScheduler(self.task_store)

    def test_register_daily_jobs_registers_scan(self):
        task = register_daily_jobs(
            self.cfg, _hackerone_registry(), self.task_store, self.scheduler)
        self.assertIsNotNone(task)
        self.assertEqual(task["kind"], "opportunity_scan")
        self.assertEqual(task["schedule"], "0 9 * * *")
        self.assertIn("opportunity_scan", self.scheduler.handlers)
        stored = self.task_store.list_tasks(
            kind="opportunity_scan", status="pending")
        self.assertEqual(len(stored), 1)

    def test_register_daily_jobs_is_idempotent(self):
        register_daily_jobs(
            self.cfg, _hackerone_registry(), self.task_store, self.scheduler)
        register_daily_jobs(
            self.cfg, _hackerone_registry(), self.task_store, self.scheduler)
        stored = self.task_store.list_tasks(
            kind="opportunity_scan", status="pending")
        self.assertEqual(len(stored), 1)

    def test_register_daily_jobs_respects_disabled_plugin(self):
        self.cfg.plugins["opportunity"] = PluginToggle(enabled=False)
        task = register_daily_jobs(
            self.cfg, _hackerone_registry(), self.task_store, self.scheduler)
        self.assertIsNone(task)
        self.assertEqual(self.task_store.list_tasks(kind="opportunity_scan"), [])

    def test_register_daily_jobs_without_scheduler_is_safe(self):
        self.assertIsNone(register_daily_jobs(
            self.cfg, _hackerone_registry(), self.task_store, None))
        self.assertIsNone(register_daily_jobs(
            self.cfg, _hackerone_registry(), None, None))


# ----------------------------------------------------------------------
# Full boot path: the server lifespan must register the job
# ----------------------------------------------------------------------
class ServerBootTests(unittest.TestCase):
    def test_lifespan_registers_daily_scan(self):
        from fastapi.testclient import TestClient

        tmp = tempfile.mkdtemp()
        cfg = _cfg(tmp)
        task_store = TaskStore(cfg)
        scheduler = TaskScheduler(task_store)

        class _FakeBrain:
            async def aclose(self):
                return None

        app = create_app(
            cfg=cfg,
            orchestrator=SimpleNamespace(brain=_FakeBrain()),
            registry=_hackerone_registry(),
            memory=SimpleNamespace(),
            agents=SimpleNamespace(list=lambda: []),
            task_store=task_store,
            task_scheduler=scheduler,
        )
        with TestClient(app) as client:
            self.assertEqual(client.get("/").status_code, 200)
            stored = task_store.list_tasks(
                kind="opportunity_scan", status="pending")
            self.assertEqual(len(stored), 1)
            self.assertEqual(stored[0]["schedule"], "0 9 * * *")
            # Actually armed in APScheduler, not just in SQLite.
            jobs = scheduler._scheduler.get_jobs()
            self.assertEqual(len(jobs), 1)
            self.assertEqual(jobs[0].id, f"task-{stored[0]['id']}")
            nxt = jobs[0].next_run_time
            self.assertEqual((nxt.hour, nxt.minute), (9, 0))
        # Lifespan shutdown stopped the scheduler.
        self.assertIsNone(scheduler._scheduler)


if __name__ == "__main__":
    unittest.main()
