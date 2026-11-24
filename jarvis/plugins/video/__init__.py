"""Video builder plugin (first slice — lightweight, draft-only).

Script -> scenes -> ffmpeg + Edge-TTS narration -> local draft mp4.
No GPU models, no model downloads, no publishing. See docs/video.md.
"""
from __future__ import annotations

from .assemble import (
    RenderError,
    build_xfade_filter,
    effective_transition,
    extract_thumbnail,
    mux_subtitles,
    render_draft,
    xfade_clips,
)
from .script import Scene, plan_video, split_script
from .store import VideoStore
from .subtitles import build_srt, contains_arabic, format_srt_time, write_srt
from .tools import register

__all__ = [
    "RenderError",
    "Scene",
    "VideoStore",
    "build_srt",
    "build_xfade_filter",
    "contains_arabic",
    "effective_transition",
    "extract_thumbnail",
    "format_srt_time",
    "mux_subtitles",
    "plan_video",
    "register",
    "render_draft",
    "split_script",
    "write_srt",
    "xfade_clips",
]
