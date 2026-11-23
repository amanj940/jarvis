"""Whisper STT model loading + cache (moved out of server/routes.py, Phase 2).

Owns the cached faster-whisper model, the CUDA-runtime probe, the CPU
fallback, VRAM-manager eviction callbacks, and the YouTube-hallucination
filter. Nothing here knows about HTTP — routes/voice.py calls into it.
"""
from __future__ import annotations

import logging
import os
import re
from pathlib import Path

_stt_log = logging.getLogger("jarvis.stt")

# ── VRAM manager integration ────────────────────────────────────────────────
from ..core.vram_manager import (
    GPUResource,
    apply_vram_cap,
    flush_gpu as _vram_flush,
    register_eviction,
)
import threading
_whisper_lock = threading.Lock()  # prevent STT during GPU eviction


# Whisper's training set was dominated by YouTube subtitles. On near-silent
# or noisy clips the LM emits canned outros — "thank you for watching",
# "please subscribe", lone "thanks", "you", "." — even with VAD on. We
# pattern-match these and discard so they never reach the chat loop.
_HALLUCINATION_RE = re.compile(
    r"""^\s*
    (?:
      thanks?[\s,.!?]*(?:for\s+watching|for\s+listening)?[\s,.!?]*
      (?:everyone|guys|all)?[\s,.!?]*
    | thank\s+you[\s,.!?]*(?:for\s+watching|for\s+listening|so\s+much)?[\s,.!?]*
    | (?:please\s+)?(?:like\s*(?:and\s+)?)?subscribe[\s,.!?]*(?:to\s+my\s+channel)?[\s,.!?]*
    | bye(?:\s*bye)?[\s,.!?]*
    | goodbye[\s,.!?]*
    | (?:see|catch)\s+you\s+(?:later|next\s+time)[\s,.!?]*
    | you[\s,.!?]*
    | (?:oh|ohh+|uh|uhh+|um|umm+|hmm+|hm|ah|ahh+|aha|eh|ehh+|mm+|er|err+
        |huh|ugh|oof|whoa|oops|mhm|uh[\s-]*huh|oh\s+my)[\s,.!?…]*
    | [.!?,…\s♪♫]+
    )
    \s*$""",
    re.IGNORECASE | re.VERBOSE,
)


def _filter_whisper_hallucination(text: str) -> str:
    """Return empty string for transcripts that match the hallucination
    blocklist; otherwise return the input unchanged."""
    if not text:
        return ""
    stripped = text.strip()
    if len(stripped) <= 1:
        return ""
    if _HALLUCINATION_RE.match(stripped):
        _stt_log.info("STT: discarded hallucinated transcript: %r", stripped)
        return ""
    return text

# ── Live log streaming ───────────────────────────────────────────────────────
# A lightweight SSE log sink: last 300 records in memory, broadcast to all

_whisper_model = None
_whisper_device = None    # "cuda" | "cpu" | None


def _switch_whisper_to_cpu() -> None:
    global _whisper_model, _whisper_device
    _whisper_model = None
    _whisper_device = "cpu"


def _evict_whisper_from_gpu() -> None:
    """Eviction callback retained for API parity, but Whisper-turbo (~1.5 GB)
    + FLUX Q6_K (~6 GB) coexist comfortably on a 16 GB GPU. We therefore
    keep Whisper resident across image-gen runs so STT stays instant. Set
    EVICT_WHISPER_FOR_FLUX=1 in the env to restore the old behaviour on
    tighter cards.
    """
    if os.getenv("EVICT_WHISPER_FOR_FLUX", "0") != "1":
        return
    global _whisper_model, _whisper_device
    with _whisper_lock:
        if _whisper_model is not None:
            _stt_log.info("Evicting Whisper from GPU (VRAM manager request)")
            del _whisper_model
            _whisper_model = None
            _vram_flush()
            _stt_log.info("Whisper evicted — VRAM freed")


def _restore_whisper_to_gpu() -> None:
    """Called by the VRAM manager after another subsystem (FLUX) is done.
    Lazy-restores: the actual model load happens on next STT request."""
    global _whisper_model
    # Don't eagerly reload — let it lazy-load on next _get_whisper_model() call.
    # Just log that it's available to reload.
    _stt_log.info("Whisper restore available (will lazy-load on next STT request)")


def _whisper_cuda_runtime_ok() -> bool:
    """Probe whether the CUDA runtime DLLs cuFFT/cuBLAS/cuDNN that
    faster-whisper/ctranslate2 needs actually load on this box. Avoids the
    'load model on GPU then crash mid-transcribe' trap.

    Also opportunistically adds nvidia-* pip-wheel DLL dirs to the DLL
    search path so users who installed `nvidia-cublas-cu12`,
    `nvidia-cudnn-cu12`, `nvidia-cufft-cu12` don't have to mess with PATH.
    """
    if os.name != "nt":
        return True
    import ctypes
    import sys
    # Add bundled NVIDIA pip-wheel DLLs to the DLL search path.
    try:
        site_packages = Path(sys.executable).resolve().parent.parent / "Lib" / "site-packages"
        nvidia_root = site_packages / "nvidia"
        if nvidia_root.is_dir():
            for pkg in nvidia_root.iterdir():
                bin_dir = pkg / "bin"
                if bin_dir.is_dir():
                    try:
                        os.add_dll_directory(str(bin_dir))
                    except (OSError, AttributeError):
                        pass
    except Exception:  # noqa: BLE001
        pass

    candidates = ["cublas64_12.dll", "cublas64_11.dll", "cudnn64_9.dll",
                  "cudnn64_8.dll", "cufft64_11.dll", "cufft64_10.dll"]
    found = 0
    for dll in candidates:
        try:
            ctypes.WinDLL(dll)
            found += 1
        except OSError:
            pass
    return found >= 2


def _get_whisper_model():
    global _whisper_model, _whisper_device
    if _whisper_model is not None:
        return _whisper_model
    from faster_whisper import WhisperModel

    # Apply VRAM hard cap before loading any GPU model.
    apply_vram_cap()

    # Forced CPU mode (set after a runtime failure).
    if _whisper_device == "cpu":
        _stt_log.info("Loading Whisper 'small' on CPU (int8)…")
        _whisper_model = WhisperModel("small", device="cpu", compute_type="int8")
        _stt_log.info("Whisper small loaded on CPU.")
        return _whisper_model

    # First-time load: probe CUDA runtime before touching the GPU model.
    if _whisper_cuda_runtime_ok():
        try:
            # large-v3-turbo: same quality as large-v3, ~8× faster decoding,
            # ~1.5 GB VRAM (vs ~3 GB for large-v3). Lets Whisper stay loaded
            # alongside FLUX on a 16 GB card without thrash.
            _stt_log.info("Loading Whisper 'large-v3-turbo' on GPU (float16)…")
            _whisper_model = WhisperModel("large-v3-turbo", device="cuda", compute_type="float16")
            _whisper_device = "cuda"
            _stt_log.info("Whisper large-v3-turbo loaded on GPU.")
            # Register eviction callbacks with the VRAM manager so FLUX
            # can kick Whisper off GPU when it needs the memory.
            register_eviction(
                GPUResource.WHISPER,
                evict_fn=_evict_whisper_from_gpu,
                restore_fn=_restore_whisper_to_gpu,
            )
            return _whisper_model
        except Exception as e:  # noqa: BLE001
            _stt_log.warning("GPU model load failed (%s) — falling back to CPU.", e)
    else:
        _stt_log.warning(
            "CUDA runtime DLLs (cuBLAS/cuDNN/cuFFT) not loadable on this host. "
            "Whisper will run on CPU. Install the NVIDIA CUDA Toolkit (12.x) "
            "or the CUDA runtime libraries from NVIDIA to enable GPU STT."
        )

    _whisper_device = "cpu"
    _stt_log.info("Loading Whisper 'small' on CPU (int8)…")
    _whisper_model = WhisperModel("small", device="cpu", compute_type="int8")
    _stt_log.info("Whisper small loaded on CPU.")
    return _whisper_model


# Public aliases — the leading-underscore names above stay importable for
# backwards compatibility (server/routes/__init__.py re-exports them).
get_whisper_model = _get_whisper_model
switch_whisper_to_cpu = _switch_whisper_to_cpu
filter_whisper_hallucination = _filter_whisper_hallucination
whisper_lock = _whisper_lock
