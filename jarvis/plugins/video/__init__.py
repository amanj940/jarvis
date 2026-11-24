"""Video builder plugin (first slice — lightweight, draft-only).

Script -> scenes -> ffmpeg + Edge-TTS narration -> local draft mp4.
No GPU models, no model downloads, no publishing. See docs/video.md.
"""
from __future__ import annotations

from .assemble import RenderError, render_draft
from .script import Scene, plan_video, split_script
from .store import VideoStore
from .tools import register

__all__ = [
    "RenderError",
    "Scene",
    "VideoStore",
    "plan_video",
    "register",
    "render_draft",
    "split_script",
]
