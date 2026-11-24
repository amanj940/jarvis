"""Admin routes for the swarm runner (read-only).

The swarm runner itself is ``jarvis.core.swarm.run_swarm`` — it fans a
list of independent tool calls out through the orchestrator in parallel.
It keeps no persistent state of its own, so these endpoints report the
runner's availability plus the swarm-kind tasks in the Phase 4 task
store (if any). No writes, no network, no keys.
"""
from __future__ import annotations

import importlib
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .common import _services

router = APIRouter()


def _task_store(request: Request):
    return getattr(request.app.state, "task_store", None)


@router.get("/swarm/status")
async def swarm_status(request: Request):
    _, orchestrator, *_ = _services(request)
    try:
        swarm_mod = importlib.import_module("jarvis.core.swarm")
        runner_available = hasattr(swarm_mod, "run_swarm")
    except Exception:
        swarm_mod = None
        runner_available = False
    store = _task_store(request)
    pending = 0
    total = 0
    if store is not None:
        try:
            tasks = store.list_tasks(kind="swarm")
            total = len(tasks)
            pending = sum(1 for t in tasks if t.get("status") == "pending")
        except Exception:  # noqa: BLE001 - counts are best-effort
            total = pending = 0
    return {
        "available": runner_available,
        "runner": "jarvis.core.swarm.run_swarm" if runner_available else None,
        "max_concurrency_default": 4,
        "orchestrator_present": orchestrator is not None,
        "swarm_tasks_total": total,
        "swarm_tasks_pending": pending,
        "note": "Swarm runs are dispatched by the LLM via the parallel_tasks "
                "meta-tool; they keep no persistent state beyond task-store "
                "entries of kind 'swarm'.",
    }


@router.get("/swarm/tasks")
async def swarm_tasks(request: Request, status: str | None = None):
    store = _task_store(request)
    if store is None:
        return JSONResponse(
            status_code=503,
            content={"available": False,
                     "reason": "task store not present on this backend build"},
        )
    try:
        tasks = store.list_tasks(kind="swarm", status=status)
    except Exception as e:  # noqa: BLE001
        return JSONResponse(
            status_code=503,
            content={"available": False, "reason": f"task store error: {e}"},
        )
    return {"available": True, "tasks": tasks, "count": len(tasks)}
