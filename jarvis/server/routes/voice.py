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
)
from ...models.whisper import (
    _filter_whisper_hallucination,
    _get_whisper_model,
    _switch_whisper_to_cpu,
    _whisper_lock,
)
from ...core.vram_manager import flush_gpu as _vram_flush
from .common import _services

router = APIRouter()
_stt_log = logging.getLogger("jarvis.stt")

@router.post("/stt")
async def speech_to_text(audio: UploadFile = File(...)):
    """Receive audio from browser MediaRecorder, transcribe with Whisper."""
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
    _WHISPER_KW: dict = dict(
        language="en",
        beam_size=1,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400, "threshold": 0.45},
        condition_on_previous_text=False,
        no_speech_threshold=0.7,
        log_prob_threshold=-1.0,
        compression_ratio_threshold=2.4,
        temperature=0.0,
        initial_prompt=(
            "JARVIS command. Search, generate image, open page, run code, "
            "show news, list videos, open the file."
        ),
    )

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
        return {"text": text}
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
    voice: str = JARVIS_TTS_VOICE

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
        label = "Microsoft Ryan Neural (British male)"
        voice = cfg.voice.edge_voice
        lang = "en-GB"

    return {
        "available": edge_available or riva_ready or piper_ready,
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
                "note":     "Install: pip install piper-tts. Model: huggingface.co/jgkawell/jarvis (en_GB-jarvis-medium.onnx).",
            },
            "edge_tts": {
                "available": edge_available,
                "voice": cfg.voice.edge_voice,
                "rate":  cfg.voice.edge_rate,
                "pitch": cfg.voice.edge_pitch,
                "label": "Microsoft Ryan Neural",
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

@router.post("/tts")
async def tts(request: Request, body: TTSBody):
    cfg, *_ = _services(request)
    text = (body.text or "").strip()
    if not text:
        return JSONResponse({"ok": False, "error": "empty text"}, status_code=400)
    text = text[:1800]
    tts_log = logging.getLogger("jarvis.tts")

    # 1. Piper — community JARVIS model (closest to MCU voice).
    if _should_try_piper(cfg):
        try:
            audio = _synthesize_with_piper(text, cfg)
            return Response(audio, media_type="audio/wav", headers={"X-JARVIS-TTS": "piper"})
        except Exception as e:  # noqa: BLE001
            tts_log.warning("Piper TTS failed (%s) — falling back", e)

    # 2. Riva (NVIDIA cloud)
    if _should_try_riva(cfg):
        try:
            audio = _synthesize_with_riva(text, cfg)
            return Response(audio, media_type="audio/wav", headers={"X-JARVIS-TTS": "riva"})
        except Exception as e:  # noqa: BLE001
            tts_log.warning("Riva TTS failed (%s) — falling back to edge-tts", e)

    # 3. Edge TTS (Microsoft Ryan / Thomas Neural)
    voice = body.voice or cfg.voice.edge_voice or "en-GB-ThomasNeural"
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
