"""Admin routes for the AI council (read-only).

The council module (``jarvis.core.council``) lives on audit/fixes and
may not exist on this backend build yet. Handlers import it lazily and
answer 503 with an honest ``{"available": false, "reason": ...}`` when
it is absent, instead of crashing the app.

No writes, no network, no keys.
"""
from __future__ import annotations

import importlib
from dataclasses import asdict, is_dataclass
from typing import Any

from fastapi import APIRouter, Request
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
