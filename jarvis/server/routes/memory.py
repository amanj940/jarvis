"""Memory read routes (Phase 2 split of jarvis/server/routes.py)."""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

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


class GoalBody(BaseModel):
    project: str
    title: str
    notes: str = ""


@router.get("/memory/goals")
async def get_goals(request: Request, project: str | None = None, status: str | None = None):
    """Project goals (Phase 4) — per-project notes/fixes already existed;
    goals are the third leg of project memory."""
    *_, memory, _ = _services(request)
    return {"goals": memory.goals(project, status)}


@router.post("/memory/goals")
async def create_goal(request: Request, body: GoalBody):
    *_, memory, _ = _services(request)
    try:
        goal_id = memory.add_goal(body.project, body.title, body.notes)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    goals = memory.goals(body.project)
    return next((g for g in goals if g["id"] == goal_id), {"id": goal_id})


@router.post("/memory/goals/{goal_id}/complete")
async def complete_goal(request: Request, goal_id: int, done: bool = True):
    *_, memory, _ = _services(request)
    goal = memory.complete_goal(goal_id, done)
    if goal is None:
        return JSONResponse({"error": f"no goal {goal_id}"}, status_code=404)
    return goal


@router.get("/memory/fixes")
async def get_fixes(request: Request, signature: str = ""):
    *_, memory, _ = _services(request)
    fix = memory.lookup_fix(signature) if signature else None
    return {"fix": fix}
