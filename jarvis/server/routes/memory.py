"""Memory read routes (Phase 2 split of jarvis/server/routes.py)."""
from __future__ import annotations

from fastapi import APIRouter, Request

from .common import _services

router = APIRouter()

@router.get("/memory/prefs")
async def get_prefs(request: Request):
    *_, memory, _ = _services(request)
    return {"prefs": memory.all_prefs()}


@router.get("/memory/notes")
async def get_notes(request: Request, project: str | None = None):
    *_, memory, _ = _services(request)
    return {"notes": memory.notes(project)}


@router.get("/memory/paths")
async def get_paths(request: Request):
    *_, memory, _ = _services(request)
    return {"paths": memory.list_paths()}


@router.get("/memory/tools")
async def get_known_tools(request: Request):
    *_, memory, _ = _services(request)
    return {"tools": memory.list_tools()}


@router.get("/memory/search")
async def search_memory(request: Request, q: str, limit: int = 20):
    *_, memory, _ = _services(request)
    return {"hits": memory.search(q, limit=limit)}


@router.get("/memory/conversation")
async def conversation(request: Request, limit: int = 100):
    *_, memory, _ = _services(request)
    return {"messages": memory.recent_messages(limit)}
