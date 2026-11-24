"""Admin routes for the swarm runner.

The swarm runner itself is ``jarvis.core.swarm.run_swarm`` — it fans a
list of independent tool calls out through the orchestrator in parallel.
It keeps no persistent state of its own, so these endpoints report the
runner's availability plus the swarm-kind tasks in the Phase 4 task
store (if any).

``POST /api/swarm/run`` fans a caller-supplied task list out through
the runner and returns the collected events. It requires confirm mode:
fanning out arbitrary tool calls over REST is a CAUTION write, and the
orchestrator's own permission checks still apply per tool. No keys.
"""
from __future__ import annotations

import importlib
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from .common import _services

router = APIRouter()

_MAX_CONCURRENCY = 16


def _require_confirm(cfg: Any) -> None:
    """Swarm runs fan out arbitrary tool calls — confirm mode only."""
    mode = getattr(getattr(cfg, "permissions", None), "mode", "confirm")
    if mode != "confirm":
        raise HTTPException(
            status_code=403,
            detail=(
                "refused: permissions.mode is %r — swarm runs require "
                "confirm mode; set permissions.mode: confirm in config.yaml"
                % mode
            ),
        )


def _swarm_module():
    try:
        return importlib.import_module("jarvis.core.swarm")
    except Exception:
        return None


def _event_dict(ev: Any) -> dict[str, Any]:
    kind = getattr(ev, "kind", "info")
    kind = getattr(kind, "value", kind)
    kind = str(kind)
    payload = getattr(ev, "payload", None) or {}
    try:
        json.dumps(payload)
    except Exception:  # noqa: BLE001 - payloads must stay JSON-safe
        payload = {"_unserializable": str(payload)}
    return {
        "kind": kind,
        "text": getattr(ev, "text", ""),
        "payload": payload,
        "swarm_id": getattr(ev, "swarm_id", None),
        "swarm_label": getattr(ev, "swarm_label", None),
    }


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


@router.post("/swarm/run")
async def swarm_run(request: Request, body: dict | None = None):
    """Fan a task list out through the swarm runner (CAUTION).

    Body::

        {"tasks": [{"label": "Weather", "tool": "get_weather",
                    "args": {"city": "Cairo"}}],
         "max_concurrency": 4}

    ``label`` defaults to the tool name, ``args`` defaults to ``{}``.
    Tool names are validated against the registry when one is attached
    (unknown tools → 400); otherwise the runner reports per-task errors
    in the collected events. Returns the run id, the collected events
    (in arrival order) and the runner's summary lines.
    """
    cfg, orchestrator, registry, *_ = _services(request)
    _require_confirm(cfg)
    body = body or {}
    tasks = body.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        raise HTTPException(
            status_code=400, detail="tasks must be a non-empty list")
    max_concurrency = body.get("max_concurrency", 4)
    if (isinstance(max_concurrency, bool)
            or not isinstance(max_concurrency, int)
            or not 1 <= max_concurrency <= _MAX_CONCURRENCY):
        raise HTTPException(
            status_code=400,
            detail="max_concurrency must be an integer between 1 and "
                   f"{_MAX_CONCURRENCY}")
    mod = _swarm_module()
    if mod is None or not hasattr(mod, "run_swarm"):
        return JSONResponse(
            status_code=503,
            content={"available": False,
                     "reason": "swarm runner not present on this backend build"},
        )
    if orchestrator is None:
        return JSONResponse(
            status_code=503,
            content={"available": False,
                     "reason": "no orchestrator attached to this backend"},
        )
    known_tools: set[str] | None = None
    if registry is not None:
        try:
            known_tools = {t.name for t in registry.all_tools()}
        except Exception:  # noqa: BLE001 - validation is best-effort
            known_tools = None
    swarm_tasks = []
    unknown: list[str] = []
    for i, item in enumerate(tasks):
        if not isinstance(item, dict):
            raise HTTPException(
                status_code=400, detail=f"tasks[{i}] must be an object")
        tool = str(item.get("tool") or "").strip()
        if not tool:
            raise HTTPException(
                status_code=400, detail=f"tasks[{i}].tool is required")
        label = str(item.get("label") or tool)
        args = item.get("args") or {}
        if not isinstance(args, dict):
            raise HTTPException(
                status_code=400, detail=f"tasks[{i}].args must be an object")
        if known_tools is not None and tool not in known_tools:
            unknown.append(tool)
        swarm_tasks.append(mod.SwarmTask(label=label, tool=tool, args=args))
    if unknown:
        raise HTTPException(
            status_code=400, detail=f"unknown tools: {sorted(set(unknown))}")
    events: list[dict[str, Any]] = []
    swarm_run_id: str | None = None
    summary: list[str] = []
    try:
        async for ev in mod.run_swarm(
                orchestrator, swarm_tasks, max_concurrency=max_concurrency):
            d = _event_dict(ev)
            events.append(d)
            payload = d.get("payload") or {}
            if isinstance(payload, dict):
                if payload.get("swarm_run_id"):
                    swarm_run_id = payload["swarm_run_id"]
                if payload.get("summary"):
                    summary = list(payload["summary"])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=500, detail=f"swarm run failed: {e}")
    errors = sum(1 for e in events if e.get("kind") == "error")
    return {
        "available": True,
        "ok": True,
        "swarm_run_id": swarm_run_id,
        "tasks": [{"label": t.label, "tool": t.tool} for t in swarm_tasks],
        "events": events,
        "summary": summary,
        "counts": {
            "tasks": len(swarm_tasks),
            "events": len(events),
            "errors": errors,
        },
    }
