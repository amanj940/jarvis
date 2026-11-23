"""Local model loading: Whisper (STT) + TTS engines.

Split out of jarvis/server/routes.py (Phase 2) so HTTP routing no longer
owns GPU model caches. All loads stay lazy — importing this package loads
no model.
"""
from __future__ import annotations

from .tts import (
    JARVIS_TTS_VOICE,
    edge_tts_available,
    piper_available,
    riva_client_available,
    riva_enabled,
    should_try_piper,
    should_try_riva,
    synthesize_with_piper,
    synthesize_with_riva,
)
from .whisper import (
    filter_whisper_hallucination,
    get_whisper_model,
    switch_whisper_to_cpu,
)

__all__ = [
    "JARVIS_TTS_VOICE",
    "edge_tts_available",
    "filter_whisper_hallucination",
    "get_whisper_model",
    "piper_available",
    "riva_client_available",
    "riva_enabled",
    "should_try_piper",
    "should_try_riva",
    "switch_whisper_to_cpu",
    "synthesize_with_piper",
    "synthesize_with_riva",
]
