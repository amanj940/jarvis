"""TTS engines: Piper (local) / NVIDIA Riva (cloud) / Edge-TTS (cloud).

Moved out of server/routes.py (Phase 2). Nothing here knows about HTTP —
routes/voice.py picks the provider and streams the audio.
"""
from __future__ import annotations

import io
import logging
import os
import wave
from pathlib import Path

# Default Edge-TTS voice when the caller does not request one explicitly.
# Hamed Neural (Saudi Arabic) — JARVIS speaks Arabic by default.
# English override: set voice.edge_voice in config.yaml (e.g. en-GB-ThomasNeural)
# or pass voice= explicitly to POST /api/tts.
JARVIS_TTS_VOICE = "ar-SA-HamedNeural"
NVIDIA_WAVEGLOW_URL = (
    "https://catalog.ngc.nvidia.com/orgs/nvidia/teams/tlt-jarvis/"
    "models/speechsynthesis_waveglow?version=deployable_v1.0"
)

def is_arabic_text(text: str) -> bool:
    """True when *text* contains Arabic script.

    Used to route speech by language: the local Piper model is
    English-only, so Arabic text must never be handed to it — it goes
    to Edge-TTS (ar-SA-HamedNeural) instead.
    """
    return any("\u0600" <= ch <= "\u06ff" or "\u0750" <= ch <= "\u077f"
               or "\u08a0" <= ch <= "\u08ff" or "\ufb50" <= ch <= "\ufdff"
               or "\ufe70" <= ch <= "\ufeff" for ch in (text or ""))


def resolve_edge_voice(requested: str | None, cfg) -> str:
    """Edge voice for one synthesis: explicit request wins, otherwise the
    configured default, otherwise the Arabic default constant. The old
    code let a request-body default of en-GB-ThomasNeural silently win
    over config.yaml — that is why changing config.yaml alone never
    changed the spoken voice.
    """
    return (requested or "").strip() or (cfg.voice.edge_voice or "").strip() or JARVIS_TTS_VOICE


def _piper_available(cfg) -> bool:
    if not _should_try_piper(cfg):
        return False
    try:
        import piper.voice  # type: ignore  # noqa: F401
    except Exception:
        return False
    return Path(cfg.abs_path(cfg.voice.piper_model)).exists()

# --- Piper TTS (local, closest match to MCU JARVIS) ------------------------
_piper_voice = None
_piper_failed = False


def _should_try_piper(cfg, text: str | None = None) -> bool:
    provider = (cfg.voice.provider or "auto").lower().strip()
    if provider == "piper":
        return True  # explicit override: the user asked for Piper
    if provider != "auto" or not bool(getattr(cfg.voice, "piper_enabled", False)):
        return False
    if text is not None and is_arabic_text(text):
        # The Piper model is English-only — it cannot speak Arabic text.
        # Routing Arabic to Edge (ar-SA-HamedNeural) instead.
        return False
    return True


def _synthesize_with_piper(text: str, cfg) -> bytes:
    global _piper_voice, _piper_failed
    if _piper_failed:
        raise RuntimeError("piper init failed previously")
    if _piper_voice is None:
        try:
            from piper.voice import PiperVoice  # type: ignore
        except Exception as e:  # noqa: BLE001
            _piper_failed = True
            raise RuntimeError(f"piper-tts not installed: {e}")
        model_path = cfg.abs_path(cfg.voice.piper_model)
        if not Path(model_path).exists():
            _piper_failed = True
            raise RuntimeError(f"piper model not found: {model_path}")
        _piper_voice = PiperVoice.load(str(model_path))

    # piper-tts 1.4+ API: synthesize_wav writes a full WAV stream. Full
    # prosody controls — length, noise, phoneme-timing variability, volume.
    from piper.config import SynthesisConfig  # type: ignore
    syn_cfg = SynthesisConfig(
        speaker_id=cfg.voice.piper_speaker if _piper_voice.config.num_speakers > 1 else None,
        length_scale=cfg.voice.piper_length_scale,
        noise_scale=getattr(cfg.voice, "piper_noise_scale", None),
        noise_w_scale=getattr(cfg.voice, "piper_noise_w_scale", None),
        volume=getattr(cfg.voice, "piper_volume", 1.0),
        normalize_audio=True,
    )
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        _piper_voice.synthesize_wav(text, wf, syn_config=syn_cfg)
    return buf.getvalue()

def _edge_tts_available() -> bool:
    try:
        import edge_tts  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


def _riva_client_available() -> bool:
    try:
        import riva.client  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


def _riva_enabled(cfg) -> bool:
    provider = (cfg.voice.provider or "auto").lower().strip()
    return provider == "nvidia_riva" or bool(cfg.voice.riva_enabled)


def _should_try_riva(cfg, text: str | None = None) -> bool:
    provider = (cfg.voice.provider or "auto").lower().strip()
    if provider == "nvidia_riva":
        return True  # explicit override: the user asked for Riva
    if provider != "auto" or not bool(cfg.voice.riva_enabled):
        return False
    if text is not None and is_arabic_text(text):
        # Riva is configured with an English voice/language (en-US) —
        # Arabic text goes to Edge (ar-SA-HamedNeural) instead.
        return False
    return True


# ---------- NVIDIA Riva Cloud TTS ----------
# Uses NVIDIA's hosted API at grpc.nvcf.nvidia.com:443 (no Docker needed).
# Requires NVIDIA_API_KEY in .env (get free at build.nvidia.com).

_RIVA_CLOUD_URI = "grpc.nvcf.nvidia.com:443"
_RIVA_FUNCTION_ID = "877104f7-e885-42b9-8de8-f6e4c6303969"  # magpie-tts-multilingual

_riva_auth = None
_riva_tts_service = None
_riva_resolved_voice: str | None = None
_riva_init_failed = False

_riva_log = logging.getLogger("jarvis.riva")


def _get_riva_service(cfg):
    """Return (auth, tts_service, voice_name) or raise on failure."""
    global _riva_auth, _riva_tts_service, _riva_resolved_voice, _riva_init_failed

    if _riva_init_failed:
        raise RuntimeError("Riva init previously failed; skipping until restart.")

    if _riva_tts_service is not None and _riva_resolved_voice:
        return _riva_auth, _riva_tts_service, _riva_resolved_voice

    try:
        import riva.client
    except ImportError as e:
        _riva_init_failed = True
        raise RuntimeError(
            "riva.client not installed. Run: pip install nvidia-riva-client"
        ) from e

    # Get NVIDIA API key
    api_key = os.environ.get("NVIDIA_API_KEY", "").strip()
    if not api_key:
        _riva_init_failed = True
        raise RuntimeError(
            "NVIDIA_API_KEY not set in .env. "
            "Get a free key at https://build.nvidia.com → Generate API Key"
        )

    # Check if user has a local Riva server configured
    server = cfg.voice.riva_server or ""
    if server and server != "localhost:50051" and "nvcf.nvidia.com" not in server:
        # User has a custom local Riva server — use it directly
        _riva_log.info("Connecting to local Riva TTS at %s …", server)
        try:
            auth = riva.client.Auth(uri=server)
        except Exception as e:
            _riva_init_failed = True
            raise RuntimeError(f"Local Riva connection failed ({server}): {e}") from e
    else:
        # Use NVIDIA cloud API
        _riva_log.info("Connecting to NVIDIA Riva Cloud TTS …")
        try:
            auth = riva.client.Auth(
                use_ssl=True,
                uri=_RIVA_CLOUD_URI,
                metadata_args=[
                    ["function-id", _RIVA_FUNCTION_ID],
                    ["authorization", f"Bearer {api_key}"],
                ],
            )
        except Exception as e:
            _riva_init_failed = True
            _riva_log.error("Riva cloud auth failed: %s", e)
            raise RuntimeError(f"Riva cloud connection failed: {e}") from e

    try:
        tts_service = riva.client.SpeechSynthesisService(auth)
    except Exception as e:
        _riva_init_failed = True
        raise RuntimeError(f"Riva TTS service init failed: {e}") from e

    # Try the configured voice first, then discover.
    voice = cfg.voice.riva_voice or "Magpie-Multilingual.EN-US.Leo"
    fallback_voices = [
        "Magpie-Multilingual.EN-US.Leo",
        "Magpie-Multilingual.EN-US.Male.Neutral",
        "Magpie-Multilingual.EN-US.Male.Calm",
        "English-US.Male-1",
    ]

    for try_voice in [voice] + [v for v in fallback_voices if v != voice]:
        try:
            _test_riva_synth(tts_service, try_voice, cfg)
            voice = try_voice
            _riva_log.info("Riva voice confirmed: %s", voice)
            break
        except Exception as e:
            _riva_log.warning("Voice '%s' failed: %s", try_voice, e)
    else:
        _riva_init_failed = True
        raise RuntimeError(
            f"No working Riva voice found. Tried: {[voice] + fallback_voices}. "
            f"Check NVIDIA_API_KEY and Riva service status."
        )

    _riva_auth = auth
    _riva_tts_service = tts_service
    _riva_resolved_voice = voice
    return auth, tts_service, voice


def _test_riva_synth(tts_service, voice: str, cfg) -> None:
    """Synthesize a tiny phrase to verify the voice works."""
    import riva.client
    tts_service.synthesize(
        "test",
        voice_name=voice,
        language_code=cfg.voice.riva_language_code or "en-US",
        encoding=riva.client.AudioEncoding.LINEAR_PCM,
        sample_rate_hz=cfg.voice.riva_sample_rate_hz or 44100,
    )


def _synthesize_with_riva(text: str, cfg) -> bytes:
    import riva.client

    _, tts_service, voice = _get_riva_service(cfg)
    sample_rate = cfg.voice.riva_sample_rate_hz or 44100
    lang = cfg.voice.riva_language_code or "en-US"

    resp = tts_service.synthesize(
        text,
        voice_name=voice,
        language_code=lang,
        encoding=riva.client.AudioEncoding.LINEAR_PCM,
        sample_rate_hz=sample_rate,
    )
    return _pcm16_to_wav(resp.audio, sample_rate_hz=sample_rate)


def _pcm16_to_wav(audio: bytes, sample_rate_hz: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate_hz)
        wf.writeframes(audio)
    return buf.getvalue()


# ============================ Iframable proxy ===============================
# Many sites set `X-Frame-Options: DENY` or CSP `frame-ancestors`. To embed
# them inside the Media Bay iframe we proxy the response and strip those


# Public aliases.
synthesize_with_piper = _synthesize_with_piper
synthesize_with_riva = _synthesize_with_riva
should_try_piper = _should_try_piper
should_try_riva = _should_try_riva
piper_available = _piper_available
edge_tts_available = _edge_tts_available
riva_client_available = _riva_client_available
riva_enabled = _riva_enabled
is_arabic_text = is_arabic_text
resolve_edge_voice = resolve_edge_voice
