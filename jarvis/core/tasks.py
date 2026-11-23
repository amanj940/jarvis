"""Persistent task system (Phase 4) — foundation for scheduled / recurring
work (reminders, recurring checks, missions).

Tasks live in the same SQLite file as memory (``config.memory.db_path``),
so they survive a restart: on boot the scheduler reloads every task whose
status is ``pending`` and re-arms it. One-shot tasks run once at
``next_run``; cron tasks (5-field crontab in ``schedule``) re-arm after
each run with their next fire time.

Execution is deliberately boring: a task has a ``kind`` and a JSON
``payload``; the scheduler dispatches to a registered async handler for
that kind. Built-in kinds:

* ``reminder`` — records the reminder in the ActionLog and returns its
  message (the WS/frontend layer surfaces it; no push channel exists yet).
* ``note``     — appends ``payload["note"]`` as a project note
  (``payload["project"]``, default ``"general"``).

Anything else needs ``register_handler(kind, fn)`` — unhandled kinds are
marked ``failed`` with ``"no handler for kind …"`` so the gap is visible
in ``GET /api/tasks`` instead of silently dropped.

APScheduler is the only new dependency (``requirements-core.txt``);
``TaskStore`` itself is plain SQLite and works without it, which is what
the unit tests exercise for CRUD/persistence.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

from ..config import Config

log = logging.getLogger("jarvis.tasks")

TASKS_SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'reminder',
    status TEXT NOT NULL DEFAULT 'pending',
    schedule TEXT,
    payload TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    last_run REAL,
    next_run REAL,
    result TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON tasks(next_run);
"""

VALID_STATUSES = {"pending", "running", "done", "failed", "cancelled"}
VALID_KINDS = {"reminder", "note"}  # + any kind registered via register_handler


def _cron_trigger(schedule: str):
    """Build an APScheduler CronTrigger from a 5-field crontab string."""
    from apscheduler.triggers.cron import CronTrigger

    return CronTrigger.from_crontab(schedule)


def _next_fire(schedule: str | None, run_at: float | None) -> float | None:
    if run_at is not None:
        return float(run_at)
    if schedule:
        trigger = _cron_trigger(schedule)
        nxt = trigger.get_next_fire_time(None, datetime.now(timezone.utc))
        return nxt.timestamp() if nxt else None
    return None


def _parse_run_at(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            pass
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    raise ValueError(f"run_at must be an epoch number or ISO-8601 string, got {value!r}")


class TaskStore:
    """SQLite-backed task CRUD. No scheduler — see :class:`TaskScheduler`."""

    def __init__(self, cfg: Config, db_path: str | Path | None = None):
        self.path: Path = Path(db_path) if db_path else cfg.abs_path(cfg.memory.db_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(TASKS_SCHEMA)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # ------------------------------------------------------------------
    def create(
        self,
        title: str,
        kind: str = "reminder",
        payload: dict | None = None,
        schedule: str | None = None,
        run_at: Any = None,
    ) -> dict:
        title = (title or "").strip()
        if not title:
            raise ValueError("title must not be blank")
        if schedule:
            _cron_trigger(schedule)  # raises ValueError on a bad crontab
        next_run = _next_fire(schedule, _parse_run_at(run_at))
        now = time.time()
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO tasks(title,kind,status,schedule,payload,created_at,updated_at,last_run,next_run,result)"
                " VALUES(?,?,?,?,?,?,?,?,?,?)",
                (title, kind, "pending", schedule, json.dumps(payload or {}),
                 now, now, None, next_run, None),
            )
            task_id = cur.lastrowid
        # get() opens a new connection: only visible after the insert commits.
        return self.get(task_id)

    def get(self, task_id: int) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
            return self._row(row) if row else None

    def list_tasks(self, status: str | None = None, kind: str | None = None) -> list[dict]:
        q = "SELECT * FROM tasks"
        clauses, args = [], []
        if status:
            clauses.append("status=?")
            args.append(status)
        if kind:
            clauses.append("kind=?")
            args.append(kind)
        if clauses:
            q += " WHERE " + " AND ".join(clauses)
        q += " ORDER BY COALESCE(next_run, created_at), id"
        with self._conn() as c:
            return [self._row(r) for r in c.execute(q, args).fetchall()]

    def update(self, task_id: int, **fields: Any) -> dict | None:
        allowed = {"title", "kind", "status", "schedule", "payload", "next_run", "result"}
        sets, args = [], []
        if "schedule" in fields and fields["schedule"]:
            _cron_trigger(fields["schedule"])
        for k, v in fields.items():
            if k not in allowed:
                raise ValueError(f"cannot update field {k!r}")
            if k == "payload":
                v = json.dumps(v or {})
            if k == "next_run":
                v = _parse_run_at(v)
            if k == "status" and v not in VALID_STATUSES:
                raise ValueError(f"invalid status {v!r}")
            sets.append(f"{k}=?")
            args.append(v)
        if not sets:
            return self.get(task_id)
        # A rescheduled cron task gets its next fire recomputed.
        if "schedule" in fields and fields["schedule"] and "next_run" not in fields:
            sets.append("next_run=?")
            args.append(_next_fire(fields["schedule"], None))
        sets.append("updated_at=?")
        args.append(time.time())
        args.append(task_id)
        with self._conn() as c:
            c.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id=?", args)
        return self.get(task_id)

    def cancel(self, task_id: int) -> dict | None:
        return self.update(task_id, status="cancelled")

    def mark_running(self, task_id: int) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE tasks SET status='running', last_run=?, updated_at=? WHERE id=?",
                (time.time(), time.time(), task_id),
            )

    def mark_done(self, task_id: int, result: str | None = None, next_run: float | None = None) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE tasks SET status=?, result=?, next_run=?, updated_at=? WHERE id=?",
                ("pending" if next_run else "done", result, next_run, time.time(), task_id),
            )

    def mark_failed(self, task_id: int, error: str) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE tasks SET status='failed', result=?, updated_at=? WHERE id=?",
                (error[:1000], time.time(), task_id),
            )

    @staticmethod
    def _row(row: sqlite3.Row) -> dict:
        d = dict(row)
        try:
            d["payload"] = json.loads(d.get("payload") or "{}")
        except json.JSONDecodeError:
            d["payload"] = {}
        return d


Handler = Callable[[dict], Awaitable[str | None]]


class TaskScheduler:
    """APScheduler wrapper: reloads pending tasks on boot, runs handlers."""

    def __init__(
        self,
        store: TaskStore,
        handlers: dict[str, Handler] | None = None,
        memory=None,
        actions=None,
    ):
        self.store = store
        self.memory = memory
        self.actions = actions
        self.handlers: dict[str, Handler] = dict(handlers or {})
        self._scheduler = None  # AsyncIOScheduler, created in start()

    def register_handler(self, kind: str, fn: Handler) -> None:
        self.handlers[kind] = fn

    # -- built-in handlers ----------------------------------------------
    async def _default_handler(self, task: dict) -> str:
        kind = task["kind"]
        payload = task.get("payload") or {}
        if kind == "reminder":
            msg = str(payload.get("message") or task["title"])
            if self.actions is not None:
                self.actions.record("task_reminder", task_id=task["id"], title=task["title"], message=msg)
            log.info("task reminder #%s: %s", task["id"], msg)
            return msg
        if kind == "note":
            if self.memory is None:
                raise RuntimeError("note task needs a memory store")
            note = str(payload.get("note") or task["title"])
            self.memory.add_note(str(payload.get("project") or "general"), note)
            return note
        handler = self.handlers.get(kind)
        if handler is None:
            raise RuntimeError(f"no handler for kind {kind!r}")
        return await handler(task) or ""

    async def run_task(self, task_id: int) -> dict:
        """Execute one task now (used by the scheduler job and by tests)."""
        task = self.store.get(task_id)
        if task is None:
            raise ValueError(f"no task {task_id}")
        if task["status"] in ("cancelled", "done"):
            return task
        self.store.mark_running(task_id)
        try:
            result = await self._default_handler(task)
        except Exception as e:  # noqa: BLE001
            log.exception("task #%s failed", task_id)
            self.store.mark_failed(task_id, f"{type(e).__name__}: {e}")
            if self.actions is not None:
                self.actions.record("task_failed", task_id=task_id, error=str(e))
            return self.store.get(task_id)
        # Cron tasks re-arm; one-shots finish.
        next_run = _next_fire(task.get("schedule"), None) if task.get("schedule") else None
        self.store.mark_done(task_id, result=result, next_run=next_run)
        if self.actions is not None:
            self.actions.record("task_done", task_id=task_id, result=(result or "")[:500])
        if next_run:
            self._schedule(self.store.get(task_id))
        return self.store.get(task_id)

    # -- scheduler lifecycle ---------------------------------------------
    def _schedule(self, task: dict) -> None:
        if self._scheduler is None or task is None or task.get("status") != "pending":
            return
        job_id = f"task-{task['id']}"
        try:
            self._scheduler.remove_job(job_id)
        except Exception:  # noqa: BLE001
            pass
        if task.get("schedule"):
            trigger = _cron_trigger(task["schedule"])
        elif task.get("next_run"):
            from apscheduler.triggers.date import DateTrigger

            trigger = DateTrigger(run_date=datetime.fromtimestamp(task["next_run"], tz=timezone.utc))
        else:
            return  # no time to run at — stays pending until edited
        self._scheduler.add_job(self.run_task, trigger, args=[task["id"]], id=job_id,
                                replace_existing=True, misfire_grace_time=300)

    def start(self) -> None:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler

        self._scheduler = AsyncIOScheduler(timezone="UTC")
        for task in self.store.list_tasks(status="pending"):
            self._schedule(task)
        self._scheduler.start()
        log.info("task scheduler started — %d pending task(s) re-armed",
                 len(self.store.list_tasks(status="pending")))

    def schedule_task(self, task: dict) -> None:
        self._schedule(task)

    def unschedule_task(self, task_id: int) -> None:
        if self._scheduler is None:
            return
        try:
            self._scheduler.remove_job(f"task-{task_id}")
        except Exception:  # noqa: BLE001
            pass

    async def shutdown(self) -> None:
        if self._scheduler is not None:
            self._scheduler.shutdown(wait=False)
            self._scheduler = None


def build_task_system(cfg: Config, memory=None, actions=None) -> tuple[TaskStore, TaskScheduler]:
    store = TaskStore(cfg)
    scheduler = TaskScheduler(store, memory=memory, actions=actions)
    return store, scheduler
