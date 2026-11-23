"""Local image + 3D generation plugin.

Phase 2 split of the old ``plugins/media_generation.py`` (1,464 lines)::

    media/common.py     — paths, hashing, __JARVIS_MEDIA__ envelope
    media/flux.py       — FLUX.2-klein-4B image generation + model registry
    media/hunyuan3d.py  — Hunyuan3D-2GP Mini Turbo image->3D backend
    media/trellis.py    — TRELLIS.2 FP8 textured image->3D worker backend
    media/providers.py  — ONE Image3DProvider interface + env-var resolver
    media/tools.py      — image_generate / image_to_3d / text_to_3d tools

The plugin name stays ``media_generation`` (PluginInfo + pending-registration
key) so config, /api/plugins output and the registry are unchanged.
All heavy imports + model loads are still lazy, on first use.
"""
from __future__ import annotations

from .flux import (
    _FLUX_PRELOAD_AT_STARTUP,
    _load_flux_pipeline,
    list_image_models,
    select_image_model,
)
from .providers import Image3DProvider, resolve_3d_provider, run_image_to_3d
from .tools import register

__all__ = [
    "Image3DProvider",
    "_FLUX_PRELOAD_AT_STARTUP",
    "_load_flux_pipeline",
    "list_image_models",
    "register",
    "resolve_3d_provider",
    "run_image_to_3d",
    "select_image_model",
]
