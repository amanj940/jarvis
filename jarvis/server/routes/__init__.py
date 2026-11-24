"""REST routes, split by domain (Phase 2).

Was a single 1,434-line ``routes.py``; now::

    routes/system.py  — health, stats, logs, files, processes, tools,
                        plugins, agents, intents, proxy/reader, cleanslate,
                        mission, persona
    routes/voice.py   — STT (/stt) + TTS (/tts, /tts/status)
    routes/media.py   — image models, /analyze-image, /image-to-3d, /img2img
    routes/memory.py  — /memory/* reads
    routes/intel.py   — /intel/globe + /intel/summary (globe intel layer)
    routes/geo.py     — /geo/* (atlas: countries, cities, weather, geocode)
    routes/shopify_webhooks.py — /webhooks/shopify (Shopify HMAC webhooks)
    routes/youtube_oauth.py — /youtube/oauth/* (OAuth flow: status, start, callback; draft-only)

``router`` below aggregates all four sub-routers, so
``app.include_router(routes.router, prefix="/api")`` in server/app.py and
``from jarvis.server.routes import router`` (tests) keep working unchanged.
Model helpers used by app.py's preload are re-exported for compatibility.
"""
from __future__ import annotations

from fastapi import APIRouter

from ...models.tts import _should_try_piper, _synthesize_with_piper
from ...models.whisper import _get_whisper_model
from .geo import router as geo_router
from .media import router as media_router
from .memory import router as memory_router
from .intel import router as intel_router
from .system import install_log_handler, router as system_router
from .voice import router as voice_router
from .youtube_oauth import router as youtube_oauth_router
from .shopify_webhooks import router as shopify_webhooks_router

router = APIRouter()
router.include_router(system_router)
router.include_router(voice_router)
router.include_router(media_router)
router.include_router(memory_router)
router.include_router(intel_router)
router.include_router(geo_router)
router.include_router(youtube_oauth_router)
router.include_router(shopify_webhooks_router)

__all__ = [
    "router",
    "install_log_handler",
    "_get_whisper_model",
    "_should_try_piper",
    "_synthesize_with_piper",
]
