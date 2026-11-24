"""Tool registrations for the video builder plugin.

Reads are SAFE; anything that writes local state is CAUTION. Rendering is
local-only and draft-only: it writes an mp4 under ``data/video/`` and never
uploads, publishes, or schedules anything. There is deliberately NO tool
that publishes a video anywhere.
"""
from __future__ import annotations

import asyncio
import json

from ...core.permissions import Permission
from ..base import PluginInfo, tool
from .assemble import RenderError, render_draft
from .script import estimate_duration_seconds, plan_video
from .store import VideoStore


def _store(cfg) -> VideoStore:
    return VideoStore(cfg.abs_path("data/video.db"))


def _json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


def register(registry):
    cfg = registry.cfg
    toggle = cfg.plugins.get("video")
    if toggle is not None and not toggle.enabled:
        return
    registry.services["video_store"] = _store(cfg)

    @tool(
        name="video_create_project",
        description=(
            "Create a draft video project (local only). Give a name and "
            "optionally a topic and/or a plain-text script — blank lines "
            "split the script into scenes. Nothing is rendered yet."
        ),
        permission=Permission.CAUTION,
        parameters={"type": "object", "properties": {
            "name": {"type": "string"},
            "topic": {"type": "string"},
            "script": {"type": "string"},
        }, "required": ["name"]},
    )
    def video_create_project(name: str, topic: str | None = None,
                             script: str | None = None) -> str:
        store = _store(cfg)
        project = store.create_project(name, topic or "")
        added = 0
        if script and script.strip():
            plan = plan_video(topic=topic, script=script)
            for scene in plan["scenes"]:
                store.add_scene(project["id"], scene["title"],
                                scene["narration"],
                                scene["duration_seconds"],
                                scene.get("image") or "")
                added += 1
        project = store.get_project(project["id"])
        return _json({"ok": True, "project": project, "scenes_added": added})

    @tool(
        name="video_add_scene",
        description=(
            "Add one scene to a draft video project: narration text, "
            "optional duration in seconds (estimated from the words when "
            "omitted) and optional local still-image path for the scene."
        ),
        permission=Permission.CAUTION,
        parameters={"type": "object", "properties": {
            "project_id": {"type": "integer"},
            "title": {"type": "string"},
            "narration": {"type": "string"},
            "duration_seconds": {"type": "number"},
            "image": {"type": "string"},
        }, "required": ["project_id", "narration"]},
    )
    def video_add_scene(project_id: int, narration: str, title: str | None = None,
                        duration_seconds: float | None = None,
                        image: str | None = None) -> str:
        store = _store(cfg)
        duration = float(duration_seconds) if duration_seconds else \
            estimate_duration_seconds(narration)
        scene = store.add_scene(project_id, title or "", narration,
                                duration, image or "")
        return _json({"ok": True, "scene": scene})

    @tool(
        name="video_list_projects",
        description="List draft video projects with their render status and scene counts.",
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "limit": {"type": "integer", "default": 20},
        }},
    )
    def video_list_projects(limit: int = 20) -> str:
        store = _store(cfg)
        return _json({"ok": True, "projects": store.list_projects(limit)})

    @tool(
        name="video_render_draft",
        description=(
            "Render a draft video locally with ffmpeg (720p): one still "
            "image per scene plus Edge-TTS narration (Arabic default). "
            "Output is a local draft.mp4 under data/video/ — nothing is "
            "uploaded or published. Requires ffmpeg installed. "
            "Second slice: a 0.5s crossfade between scenes (set "
            "transitions=false to disable, transition_seconds to change "
            "it), subtitles as an SRT sidecar + soft track in the mp4 "
            "(auto-on for Arabic narration; subtitles=false to disable), "
            "and a cover.jpg thumbnail from the first scene."
        ),
        permission=Permission.CAUTION,
        parameters={"type": "object", "properties": {
            "project_id": {"type": "integer"},
            "voice": {"type": "string"},
            "subtitles": {"type": "boolean",
                          "description": "Force subtitles on/off; omitted "
                                         "means auto (on for Arabic)."},
            "transitions": {"type": "boolean", "default": True,
                            "description": "Crossfade between scenes."},
            "transition_seconds": {"type": "number", "default": 0.5,
                                   "description": "Crossfade length in "
                                                  "seconds (max 2, clamped "
                                                  "to half the shortest "
                                                  "scene)."},
        }, "required": ["project_id"]},
    )
    async def video_render_draft(project_id: int,
                                 voice: str | None = None,
                                 subtitles: bool | None = None,
                                 transitions: bool = True,
                                 transition_seconds: float = 0.5) -> str:
        store = _store(cfg)
        try:
            result = await render_draft(
                int(project_id), store, cfg, voice=voice,
                subtitles=subtitles, transitions=transitions,
                transition_seconds=transition_seconds)
        except RenderError as e:
            return _json({"ok": False, "project_id": int(project_id),
                          "error": str(e)})
        return _json(result)

    registry.add_pending("video")
    registry.register_plugin(PluginInfo(
        name="video",
        description="Lightweight draft video builder: script -> scenes -> "
                    "ffmpeg + Edge-TTS narration, local mp4 only (needs ffmpeg).",
        permissions_needed=[Permission.SAFE, Permission.CAUTION],
    ))
