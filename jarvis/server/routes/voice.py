"""Voice routes: STT (Whisper) + TTS (Piper / Riva / Edge).

Split out of jarvis/server/routes.py (Phase 2). Model loading lives in
jarvis/models/ (whisper.py, tts.py); this module only wires HTTP to it.
"""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from ...models.tts import (
    JARVIS_TTS_VOICE,
    NVIDIA_WAVEGLOW_URL,
    _edge_tts_available,
    _piper_available,
    _riva_client_available,
    _riva_enabled,
    _should_try_piper,
    _should_try_riva,
    _synthesize_with_piper,
    _synthesize_with_riva,
    is_arabic_text,
    resolve_edge_voice,
)
from ...core.voice_state import VoiceState
from ...models.whisper import (
    _filter_whisper_hallucination,
    _get_whisper_model,
    _switch_whisper_to_cpu,
    _whisper_lock,
    build_transcribe_kwargs,
    get_stt_language,
)
from ...core.vram_manager import flush_gpu as _vram_flush
from .common import _services

router = APIRouter()
_stt_log = logging.getLogger("jarvis.stt")

@router.post("/stt")
async def speech_to_text(request: Request, audio: UploadFile = File(...), language: str | None = None):
    """Receive audio from browser MediaRecorder, transcribe with Whisper.

    Language: ``?language=`` override, else ``voice.stt_language``
    (Phase 4 default ``"ar"`` — see jarvis/models/whisper.py
    ``build_transcribe_kwargs``). No hardcoded ``language="en"`` remains.
    """
    cfg, orch, *_ = _services(request)
    vs = getattr(orch, "voice_state", None)
    if vs is not None:
        vs.begin_listening("stt request")
    import asyncio
    data = await audio.read()
    if not data:
        return JSONResponse({"text": "", "error": "empty audio"}, status_code=400)

    _stt_log.info("STT: received %d bytes", len(data))

    tmp = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
    tmp.write(data)
    tmp.close()

    # Tightened decode kwargs that suppress Whisper's well-known YouTube-style
    # hallucinations ("thank you", "thanks for watching", "subscribe", "."):
    #   * vad_filter — Silero VAD trims silence segments before decoding.
    #   * no_speech_threshold raised — segments with high no-speech probability
    #     are dropped instead of being decoded into junk.
    #   * log_prob_threshold + compression_ratio_threshold cull low-confidence
    #     repetitive output.
    #   * temperature=0 — deterministic greedy decode, no sampled fallback.
    #   * initial_prompt biases the LM away from the YouTube-style outro
    #     phrases and toward technical assistant vocabulary.
    # Phase 4: language + initial prompt come from config (voice.stt_language,
    # default "ar") via build_transcribe_kwargs; ?language= overrides per call.
    _WHISPER_KW: dict = build_transcribe_kwargs(cfg, language=language)

    def _post_process(text: str) -> str:
        """Drop common Whisper hallucinations on near-silent audio."""
        return _filter_whisper_hallucination(text)

    def _run_whisper(path: str) -> str:
        with _whisper_lock:  # Prevent STT during GPU eviction
            model = _get_whisper_model()
            try:
                segments, _ = model.transcribe(path, **_WHISPER_KW)
                return _post_process(" ".join(seg.text.strip() for seg in segments).strip())
            except (OSError, RuntimeError) as e:
                # Common failure: CUDA runtime DLL not loadable (cufft64_11.dll,
                # cudnn, etc.). The model loaded earlier but transcription needs
                # additional DLLs that aren't on PATH. Drop the cached GPU model
                # and rebuild on CPU once; retry transcription.
                msg = str(e)
                if "out of memory" in msg.lower():
                    _stt_log.warning("STT: CUDA OOM — switching to CPU for this run. Detail: %s", e)
                    _vram_flush()
                    _switch_whisper_to_cpu()
                    model = _get_whisper_model()
                    segments, _ = model.transcribe(path, **_WHISPER_KW)
                    return _post_process(" ".join(seg.text.strip() for seg in segments).strip())
                if any(s in msg.lower() for s in ("winerror 193", "cufft", "cudnn", "cublas", "not a valid win32", "could not load")):
                    _stt_log.warning("STT: GPU transcription DLL failure — switching to CPU permanently. Detail: %s", e)
                    _switch_whisper_to_cpu()
                    model = _get_whisper_model()
                    segments, _ = model.transcribe(path, **_WHISPER_KW)
                    return _post_process(" ".join(seg.text.strip() for seg in segments).strip())
                raise

    try:
        loop = asyncio.get_event_loop()
        text = await loop.run_in_executor(None, _run_whisper, tmp.name)
        _stt_log.info("STT: transcript = '%s'", text)
        if vs is not None:
            vs.begin_thinking("transcript ready")
        return {"text": text, "language": _WHISPER_KW.get("language")}
    except Exception as e:
        _stt_log.error("STT: Whisper failed: %s", e)
        return JSONResponse({"text": "", "error": f"Whisper error: {e}"}, status_code=500)
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


# Cached Whisper model (loaded once, reused). When GPU runtime is broken

class TTSBody(BaseModel):
    text: str
    # None = no explicit request: the configured default wins
    # (cfg.voice.edge_voice, ar-SA-HamedNeural). A request-body default
    # here used to silently override config.yaml on every call.
    voice: str | None = None

@router.get("/tts/status")
async def tts_status(request: Request):
    cfg, *_ = _services(request)
    edge_available = _edge_tts_available()
    riva_client_available = _riva_client_available()
    riva_ready = _riva_enabled(cfg) and riva_client_available
    piper_ready = _piper_available(cfg)

    if piper_ready:
        provider, label, voice, lang = "piper", "JARVIS (Piper, community model)", "jarvis", "en-GB"
    elif riva_ready:
        provider, label, voice, lang = "nvidia-riva", "NVIDIA Riva / Jarvis TTS", cfg.voice.riva_voice, cfg.voice.riva_language_code
    else:
        provider = "edge-tts"
        voice = cfg.voice.edge_voice or JARVIS_TTS_VOICE
        # Label + lang follow the configured voice, so the HUD top bar
        # shows the voice that will actually speak (Hamed for Arabic).
        lang = "-".join(voice.split("-")[:2]) if "-" in voice else "ar-SA"
        label = (
            "Hamed Neural (Arabic)" if voice.startswith("ar-SA-Hamed")
            else f"{voice} (Edge-TTS)"
        )

    vs = getattr(getattr(request.app.state, "orchestrator", None), "voice_state", None)
    return {
        "available": edge_available or riva_ready or piper_ready,
        "voice_state": vs.value if vs is not None else "idle",
        "stt_language": get_stt_language(cfg),
        "provider": provider,
        "requested_provider": cfg.voice.provider,
        "voice": voice,
        "label": label,
        "lang": lang,
        "providers": {
            "piper": {
                "enabled":  bool(getattr(cfg.voice, "piper_enabled", False)),
                "available": piper_ready,
                "model":    str(cfg.abs_path(cfg.voice.piper_model)),
                "note":     "English-only model (en_GB-jarvis). Arabic text skips Piper and uses Edge (ar-SA-HamedNeural). Install: pip install piper-tts. Model: huggingface.co/jgkawell/jarvis (en_GB-jarvis-medium.onnx).",
            },
            "edge_tts": {
                "available": edge_available,
                "voice": cfg.voice.edge_voice,
                "rate":  cfg.voice.edge_rate,
                "pitch": cfg.voice.edge_pitch,
                "label": "Hamed Neural (Arabic)" if (cfg.voice.edge_voice or "").startswith("ar-SA-Hamed") else cfg.voice.edge_voice,
            },
            "nvidia_riva": {
                "enabled": _riva_enabled(cfg),
                "client_available": riva_client_available,
                "server": cfg.voice.riva_server,
                "voice": cfg.voice.riva_voice,
                "language_code": cfg.voice.riva_language_code,
                "sample_rate_hz": cfg.voice.riva_sample_rate_hz,
                "waveglow_model_url": getattr(cfg.voice, "nvidia_waveglow_model_url", NVIDIA_WAVEGLOW_URL),
                "note": "WaveGlow is a Riva/Jarvis vocoder component; it requires a running Riva TTS server.",
            },
        },
    }

@router.get("/voice/state")
async def voice_state(request: Request):
    """Current unified voice state (Phase 4 state machine)."""
    cfg, orch, *_ = _services(request)
    vs = getattr(orch, "voice_state", None)
    return {"state": vs.value if vs is not None else "idle",
            "history": vs.history()[-10:] if vs is not None else [],
            "stt_language": get_stt_language(cfg)}


class VoiceStateBody(BaseModel):
    state: str
    reason: str = ""


@router.post("/voice/state")
async def set_voice_state(request: Request, body: VoiceStateBody):
    """Let the frontend report its side of voice state (e.g. TTS playback
    started/ended in the browser) so backend and frontend agree on one
    state. Illegal transitions are rejected with 409, not forced.
    """
    cfg, orch, *_ = _services(request)
    vs = getattr(orch, "voice_state", None)
    if vs is None:
        return JSONResponse({"ok": False, "error": "no voice state machine"}, status_code=503)
    try:
        target = VoiceState(body.state)
    except ValueError:
        return JSONResponse({"ok": False, "error": f"unknown voice state: {body.state}"}, status_code=400)
    if not vs.transition(target, body.reason or "frontend report"):
        return JSONResponse({"ok": False, "error": f"illegal transition to {target.value}",
                             "state": vs.value}, status_code=409)
    return {"ok": True, "state": vs.value}


@router.post("/voice/interrupt")
async def voice_interrupt(request: Request):
    """Barge-in: user spoke / cancelled while JARVIS was speaking or
    thinking. Moves the state machine to interrupted -> listening.
    Cancelling the in-flight LLM turn itself is the WS layer's job
    (``{"type": "cancel"}`` / a new chat); this endpoint only fixes state.
    """
    cfg, orch, *_ = _services(request)
    vs = getattr(orch, "voice_state", None)
    if vs is None:
        return JSONResponse({"ok": False, "error": "no voice state machine"}, status_code=503)
    interrupted = vs.barge_in("api interrupt")
    return {"ok": True, "interrupted": interrupted, "state": vs.value}


@router.post("/tts")
async def tts(request: Request, body: TTSBody):
    cfg, orch, *_ = _services(request)
    vs = getattr(orch, "voice_state", None)
    if vs is not None:
        vs.begin_speaking("tts request")
    text = (body.text or "").strip()
    if not text:
        return JSONResponse({"ok": False, "error": "empty text"}, status_code=400)
    text = text[:1800]
    tts_log = logging.getLogger("jarvis.tts")

    # 1. Piper — community JARVIS model (closest to MCU voice).
    # English-only: skipped for Arabic text in auto mode (see
    # jarvis/models/tts.py is_arabic_text) so Arabic is never spoken
    # in an English voice. An explicit provider=piper still tries it.
    if _should_try_piper(cfg, text):
        try:
            audio = _synthesize_with_piper(text, cfg)
            return Response(audio, media_type="audio/wav", headers={"X-JARVIS-TTS": "piper"})
        except Exception as e:  # noqa: BLE001
            tts_log.warning("Piper TTS failed (%s) — falling back", e)

    # 2. Riva (NVIDIA cloud) — likewise skipped for Arabic text in
    # auto mode: it is configured with an English voice (en-US).
    if _should_try_riva(cfg, text):
        try:
            audio = _synthesize_with_riva(text, cfg)
            return Response(audio, media_type="audio/wav", headers={"X-JARVIS-TTS": "riva"})
        except Exception as e:  # noqa: BLE001
            tts_log.warning("Riva TTS failed (%s) — falling back to edge-tts", e)

    # 3. Edge TTS — default voice is ar-SA-HamedNeural (config wins;
    # an explicit per-request voice= still overrides it).
    voice = resolve_edge_voice(body.voice, cfg)
    rate  = cfg.voice.edge_rate  or "-6%"
    pitch = cfg.voice.edge_pitch or "+0Hz"
    try:
        import edge_tts
    except Exception as e:  # noqa: BLE001
        return JSONResponse(
            {"ok": False, "error": f"edge-tts unavailable: {e}"},
            status_code=503,
        )

    async def stream_audio():
        communicate = edge_tts.Communicate(text, voice=voice, rate=rate, pitch=pitch)
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                yield chunk["data"]

    return StreamingResponse(
        stream_audio(),
        media_type="audio/mpeg",
        headers={"X-JARVIS-TTS": "edge"},
    )
