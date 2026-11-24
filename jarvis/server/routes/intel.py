"""Intelligence-layer routes: geo-tagged items for the Earth globe.

Read-only. ``GET /intel/globe`` returns the plotted items (opportunity
leads + bounty programs/findings that have a location) with unlocated
counts; ``GET /intel/summary`` returns the counts without coordinates.
Both read the local SQLite stores live, so the globe always reflects
the newest leads and findings. No writes, no network, no keys.
"""
from __future__ import annotations

from fastapi import APIRouter, Request

from ...plugins.intel.store import IntelStore
from .common import _services

router = APIRouter()


@router.get("/intel/globe")
async def intel_globe(request: Request, limit: int = 200):
    cfg, *_ = _services(request)
    return IntelStore(cfg).globe_items(limit=limit)


@router.get("/intel/summary")
async def intel_summary(request: Request):
    cfg, *_ = _services(request)
    return IntelStore(cfg).summary()
