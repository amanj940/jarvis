"""Admin routes for the AI council.

The council module (``jarvis.core.council``) lives on audit/fixes and
may not exist on this backend build yet. Handlers import it lazily and
answer 503 with an honest ``{"available": false, "reason": ...}`` when
it is absent, instead of crashing the app.

GETs are read-only. The two POSTs run real inference through the brain
(benchmark probes providers; deliberate runs a full 3-stage council
session), so they are slow and network-bound — the response carries the
results, never a bare "started". No writes, no keys.
"""
from __future__ import annotations

import importlib
from dataclasses import asdict, is_dataclass
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from .common import _services

router = APIRouter()


def _unavailable(reason: str) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"available": False, "reason": reason},
    )


def _council_module():
    try:
        return importlib.import_module("jarvis.core.council")
    except Exception:
        return None


def _member_dict(m: Any) -> dict[str, Any]:
    if is_dataclass(m):
        return asdict(m)
    if isinstance(m, dict):
        return dict(m)
    return {"id": str(m), "name": str(m)}


def _result_dict(r: Any) -> dict[str, Any]:
    if is_dataclass(r):
        return asdict(r)
    if isinstance(r, dict):
        return dict(r)
    return {"result": str(r)}


def _brain(request: Request):
    _, orchestrator, *_ = _services(request)
    return getattr(orchestrator, "brain", None) if orchestrator is not None else None


@router.get("/council/members")
async def council_members(request: Request):
    mod = _council_module()
    if mod is None:
        return _unavailable(
            "council module not present on this backend build "
            "(arrives with the audit/fixes merge)")
    _, orchestrator, *_ = _services(request)
    brain = getattr(orchestrator, "brain", None)
    members: list[dict[str, Any]] = []
    source = "verified-lineup"
    # Prefer the live availability check (needs brain + KeyManager).
    if brain is not None:
        try:
            council = mod.AICouncil(brain)
            members = [_member_dict(m) for m in council.get_available_members()]
            source = "available-members"
        except Exception:
            members = []
    if not members:
        try:
            members = [_member_dict(m) for m in mod.roster_from_verified_lineup()]
            source = "verified-lineup"
        except Exception as e:  # noqa: BLE001
            return _unavailable(f"could not load council roster: {e}")
    return {"available": True, "source": source, "members": members,
            "count": len(members)}


@router.get("/council/roster")
async def council_roster(request: Request):
    mod = _council_module()
    if mod is None:
        return _unavailable(
            "council module not present on this backend build "
            "(arrives with the audit/fixes merge)")
    static = getattr(mod, "COUNCIL_ROSTER", {}) or {}
    static_out = [
        _member_dict(m) for m in
        (static.values() if isinstance(static, dict) else static)
    ]
    dynamic: list[dict[str, Any]] = []
    try:
        dynamic = [_member_dict(m)
                   for m in getattr(mod.AICouncil, "_dynamic_roster", []) or []]
    except Exception:  # noqa: BLE001
        dynamic = []
    return {
        "available": True,
        "static_roster": static_out,
        "dynamic_roster": dynamic,
    }


@router.get("/council/fast-members")
async def council_fast_members(request: Request, n: int = 8):
    mod = _council_module()
    if mod is None:
        return _unavailable(
            "council module not present on this backend build "
            "(arrives with the audit/fixes merge)")
    try:
        members = [_member_dict(m) for m in mod.roster_from_verified_lineup()]
        fast = [_member_dict(m) for m in mod.select_fast_members(
            mod.roster_from_verified_lineup(), n=max(1, min(n, 20)))]
    except Exception as e:  # noqa: BLE001
        return _unavailable(f"could not load council roster: {e}")
    return {"available": True, "members": fast, "count": len(fast),
            "total_lineup": len(members)}


@router.get("/council/last-benchmark")
async def council_last_benchmark(request: Request):
    mod = _council_module()
    if mod is None:
        return _unavailable(
            "council module not present on this backend build "
            "(arrives with the audit/fixes merge)")
    try:
        benchmark = mod.AICouncil.get_last_benchmark()
    except Exception as e:  # noqa: BLE001
        return _unavailable(f"could not load last benchmark: {e}")
    return {"available": True, "last_benchmark": benchmark or []}


@router.post("/council/benchmark")
async def council_benchmark(request: Request, body: dict | None = None):
    """Run the council benchmark + election (CAUTION: real LLM probes).

    Runs ``AICouncil.auto_evaluate_and_elect()``: benchmarks every
    candidate provider/model, elects the council, and stores the results
    so ``GET /api/council/last-benchmark`` returns them afterwards.
    Takes a while (live provider probes) — callers must wait for the
    response, not poll. Body is ignored; ``{}`` or no body both work.
    """
    mod = _council_module()
    if mod is None:
        return _unavailable(
            "council module not present on this backend build "
            "(arrives with the audit/fixes merge)")
    brain = _brain(request)
    if brain is None:
        return _unavailable(
            "no brain attached to this backend — council benchmark "
            "needs the live brain")
    try:
        council = mod.AICouncil(brain)
        results, elected = await council.auto_evaluate_and_elect()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=500, detail=f"council benchmark failed: {e}")
    results = [_result_dict(r) for r in (results or [])]
    elected_out = [_member_dict(m) for m in (elected or [])]
    return {
        "available": True,
        "ok": True,
        "results": results,
        "elected": elected_out,
        "count": len(elected_out),
        "last_benchmark": results,
    }


@router.post("/council")
async def council_deliberate(request: Request, body: dict | None = None):
    """Run a council deliberation (CAUTION: real LLM calls).

    Body: ``{"topic": "...", "context": "...", "full": false}``.
    ``full=true`` convenes the whole verified lineup instead of the fast
    (~8 member) council. Returns the consensus verdict, agreement score,
    member proposals and peer critiques.
    """
    mod = _council_module()
    if mod is None:
        return _unavailable(
            "council module not present on this backend build "
            "(arrives with the audit/fixes merge)")
    body = body or {}
    topic = str(body.get("topic") or "").strip()
    if not topic:
        raise HTTPException(status_code=400, detail="topic is required")
    context = str(body.get("context") or "")
    full = bool(body.get("full", False))
    brain = _brain(request)
    if brain is None:
        return _unavailable(
            "no brain attached to this backend — council deliberation "
            "needs the live brain")
    try:
        deliberation = await mod.AICouncil(brain).deliberate(
            topic, context=context, full=full)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=500, detail=f"council deliberation failed: {e}")
    proposals = getattr(deliberation, "proposals", None) or []
    critiques = getattr(deliberation, "peer_critiques", None) or []
    return {
        "available": True,
        "ok": True,
        "topic": getattr(deliberation, "topic", topic),
        "consensus_verdict": getattr(deliberation, "consensus_verdict", ""),
        "agreement_score": getattr(deliberation, "agreement_score", None),
        "active_members": getattr(deliberation, "active_members", []),
        "proposals": [_result_dict(p) for p in proposals],
        "peer_critiques": [dict(c) for c in critiques],
    }
