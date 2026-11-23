"""FLUX.2-klein-4B local image generation (GGUF transformer).

Moved out of plugins/media_generation.py (Phase 2). Owns the FLUX pipeline
singleton, the image-model registry (list/select), GGUF download and the
generation loop with OOM hardening. Heavy imports stay lazy inside the
functions, as before.
"""
from __future__ import annotations

import gc
import inspect
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ...core.task_progress import report as _progress_report
from ...core.vram_manager import (
    GPUResource,
    apply_vram_cap,
    cancel_idle_unload,
    flush_gpu as _flush_gpu,
    register_eviction,
    register_idle_unload,
    schedule_idle_unload,
)
from .common import _local_models_dir, _select_device, log

# ── Model config ────────────────────────────────────────────────────────────
# GGUF file: unsloth Q6_K quantisation — ~3.3 GB, near-BF16 quality, fast.
_GGUF_REPO   = "unsloth/FLUX.2-klein-4B-GGUF"
_GGUF_FILE   = "flux-2-klein-4b-Q6_K.gguf"
_HF_BASE     = "black-forest-labs/FLUX.2-klein-4B"   # VAE / text-encoders / scheduler

# Pipeline tuning. The Q6_K transformer is only 3.4 GB, BUT the FLUX.2-klein
# text encoder is a ~4B-param LLM = ~8 GB in BF16. Pinning the *whole* pipe on
# CUDA at once (text_encoder 8 GB + transformer 3.4 GB + VAE + 1024² activations
# + CUDA ctx) blows past 16 GB. On Windows the NVIDIA driver then SILENTLY spills
# to system RAM over PCIe ("sysmem fallback") instead of OOMing — GPU sits at
# 100% but every denoise step is PCIe-bound (~255 s first step). So we MUST use
# model_cpu_offload: only the active module sits on GPU (encode → denoise → decode),
# peak VRAM ~8 GB, no spill, full GPU speed. Per-gen cost: one ~1-2 s text-encoder
# swap, vs 100× slowdown from spilling.
_FLUX_IDLE_UNLOAD_S: float = 0.0    # 0 = never unload (stays resident → every gen instant); finite = free VRAM after N s idle
_FLUX_USE_CPU_OFFLOAD = True        # REQUIRED: 8 GB text encoder over-commits 16 GB if fully resident → driver sysmem spill
_FLUX_PRELOAD_AT_STARTUP = False    # load on first image request, not at boot

@dataclass(frozen=True)
class ImageModelSpec:
    key: str
    label: str
    family: str
    base_repo: str
    artifact_repo: str
    artifact_file: str
    description: str
    default_steps: int
    default_guidance: float


_DEFAULT_IMAGE_MODEL = "flux2-klein"
_IMAGE_MODEL_ALIASES = {
    "flux": "flux2-klein",
    "flux2": "flux2-klein",
    "flux2-klein-4b": "flux2-klein",
    "flux.2-klein": "flux2-klein",
}
_IMAGE_MODELS: dict[str, ImageModelSpec] = {
    "flux2-klein": ImageModelSpec(
        key="flux2-klein",
        label="FLUX.2-klein-4B Q6_K",
        family="flux2",
        base_repo=_HF_BASE,
        artifact_repo=_GGUF_REPO,
        artifact_file=_GGUF_FILE,
        description="Fast local FLUX.2-klein generator, Q6_K GGUF transformer.",
        default_steps=4,
        default_guidance=4.0,
    ),
}

_flux_pipe   = None
_flux_device: str | None = None
_loaded_image_model: str | None = None

def _normalize_image_model_key(key: str | None) -> str:
    raw = (key or "").strip().lower()
    if not raw:
        raw = _DEFAULT_IMAGE_MODEL
    return _IMAGE_MODEL_ALIASES.get(raw, raw)


def _image_model_spec(cfg, requested: str | None = None) -> ImageModelSpec:
    configured = getattr(getattr(cfg, "image_model", None), "selected", None)
    key = _normalize_image_model_key(requested or configured)
    spec = _IMAGE_MODELS.get(key)
    if spec is None:
        log.warning("Unknown image model '%s'; falling back to %s", key, _DEFAULT_IMAGE_MODEL)
        spec = _IMAGE_MODELS[_DEFAULT_IMAGE_MODEL]
    return spec


def list_image_models(cfg) -> dict[str, Any]:
    selected = _image_model_spec(cfg).key
    models = []
    for spec in _IMAGE_MODELS.values():
        artifact_path = _local_models_dir(cfg) / spec.artifact_file
        models.append({
            "key": spec.key,
            "label": spec.label,
            "family": spec.family,
            "description": spec.description,
            "repo": spec.artifact_repo,
            "file": spec.artifact_file,
            "base_repo": spec.base_repo,
            "local_path": str(artifact_path),
            "downloaded": artifact_path.exists(),
            "loaded": _loaded_image_model == spec.key and _flux_pipe is not None,
            "default_steps": spec.default_steps,
            "default_guidance": spec.default_guidance,
        })
    return {"selected": selected, "models": models}


def select_image_model(cfg, key: str) -> dict[str, Any]:
    normalized = _normalize_image_model_key(key)
    if normalized not in _IMAGE_MODELS:
        raise ValueError(f"unknown image model: {key}")
    spec = _IMAGE_MODELS[normalized]
    image_cfg = getattr(cfg, "image_model", None)
    old_key = _image_model_spec(cfg).key
    if image_cfg is not None:
        image_cfg.selected = spec.key
    if old_key != spec.key and _flux_pipe is not None:
        _unload_flux_pipeline()
    state = list_image_models(cfg)
    return {"selected": spec.key, "model": next(m for m in state["models"] if m["key"] == spec.key)}

# ── GGUF download ────────────────────────────────────────────────────────────

def _ensure_gguf(cfg, spec: ImageModelSpec | None = None) -> str:
    """Return local path to a GGUF file, downloading from HF if absent."""
    spec = spec or _IMAGE_MODELS[_DEFAULT_IMAGE_MODEL]
    dest = _local_models_dir(cfg) / spec.artifact_file
    if dest.exists():
        log.info("%s found at %s (%.1f GB)", spec.label, dest, dest.stat().st_size / 1e9)
        return str(dest)

    log.info(
        "%s not found locally; downloading from %s/%s ...",
        spec.label, spec.artifact_repo, spec.artifact_file,
    )
    _progress_report(
        f"Downloading {spec.label} ({spec.artifact_file}) from Hugging Face..."
    )
    try:
        from huggingface_hub import hf_hub_download
        path = hf_hub_download(
            repo_id=spec.artifact_repo,
            filename=spec.artifact_file,
            local_dir=str(_local_models_dir(cfg)),
            local_dir_use_symlinks=False,
        )
        log.info("%s downloaded to %s", spec.label, path)
        return path
    except Exception as e:
        raise RuntimeError(
            f"Failed to download {spec.label}: {e}\n"
            f"Manual download: https://huggingface.co/{spec.artifact_repo}/blob/main/{spec.artifact_file}\n"
            f"Place at: {dest}"
        ) from e

# ── Pipeline loader ──────────────────────────────────────────────────────────

def _load_flux_pipeline(cfg, spec: ImageModelSpec | None = None):
    """Lazy-load FLUX.2-klein-4B with GGUF transformer.

    Strategy:
      1. Load Flux2Transformer2DModel from the local Q6_K GGUF.
      2. Load remaining components (VAE, T5, CLIP, scheduler) from HF hub
         using Flux2KleinPipeline.from_pretrained().
      3. Inject the GGUF transformer into the assembled pipeline.
      4. Move the full pipe to CUDA. Q6_K (~3.3 GB) + VAE/text encoders
         (~3 GB) = ~6 GB peak active — fits a 16 GB card with Whisper-turbo
         loaded alongside. CPU-offload is a fallback only.
      5. VAE slicing + tiling enabled for safety at high resolutions.

    Falls back to pure HF load if GGUF loading fails (e.g. no gguf package).
    """
    global _flux_pipe, _flux_device, _loaded_image_model

    spec = spec or _IMAGE_MODELS[_DEFAULT_IMAGE_MODEL]
    if _flux_pipe is not None and _loaded_image_model == spec.key:
        return _flux_pipe
    if _flux_pipe is not None:
        _unload_flux_pipeline()

    try:
        import torch
        from diffusers import Flux2KleinPipeline, Flux2Transformer2DModel
    except ImportError as e:
        raise RuntimeError(
            "diffusers ≥ 0.38 + torch required.\n"
            "  pip install torch diffusers transformers accelerate sentencepiece "
            "safetensors huggingface-hub gguf"
        ) from e

    device = _select_device()
    dtype  = torch.bfloat16   # FLUX.2-klein is trained in BF16; float16 risks NaNs

    gguf_path = _ensure_gguf(cfg, spec)

    # ── 1. GGUF transformer ────────────────────────────────────────────────
    log.info("Loading Flux2Transformer2DModel from GGUF: %s", Path(gguf_path).name)
    try:
        try:
            from diffusers import GGUFQuantizationConfig
            _gguf_cfg = GGUFQuantizationConfig(compute_dtype=dtype)
        except ImportError:
            from diffusers.quantizers.gguf import GGUFQuantizer as GGUFQuantizationConfig  # older diffusers
            _gguf_cfg = GGUFQuantizationConfig(compute_dtype=dtype)
        transformer = Flux2Transformer2DModel.from_single_file(
            gguf_path,
            quantization_config=_gguf_cfg,
            config=spec.base_repo,      # arch config; default maps to gated FLUX.2-dev
            subfolder="transformer",
            torch_dtype=dtype,
        )
        log.info("GGUF transformer loaded (GGUFQuantizationConfig).")
    except Exception as gguf_err:
        log.warning(
            "GGUF quantizer path failed (%s). "
            "Trying plain from_single_file (no quantizer)…", gguf_err
        )
        try:
            transformer = Flux2Transformer2DModel.from_single_file(
                gguf_path,
                config=spec.base_repo,      # arch config; default maps to gated FLUX.2-dev
                subfolder="transformer",
                torch_dtype=dtype,
            )
            log.info("GGUF transformer loaded (plain from_single_file).")
        except Exception as e2:
            log.warning(
                "from_single_file also failed (%s). "
                "Falling back to HF hub transformer.", e2
            )
            transformer = None   # will use pipeline's own transformer

    # ── 2. Full pipeline (VAE + text encoders + scheduler) ────────────────
    log.info("Loading Flux2KleinPipeline components from %s …", spec.base_repo)
    if transformer is not None:
        pipe = Flux2KleinPipeline.from_pretrained(
            spec.base_repo,
            transformer=transformer,
            torch_dtype=dtype,
        )
    else:
        pipe = Flux2KleinPipeline.from_pretrained(
            spec.base_repo,
            torch_dtype=dtype,
        )

    pipe.set_progress_bar_config(disable=True)

    # Guard: a parameter still on the `meta` device means its weights never
    # materialised (usually a failed transformer load). Moving such a pipe to
    # CUDA — or to CPU-offload — throws the cryptic "Cannot copy out of meta
    # tensor; no data!". Detect it here and fail loud + actionable instead.
    _meta_mods = []
    for _name in ("transformer", "vae", "text_encoder", "text_encoder_2"):
        _comp = getattr(pipe, _name, None)
        if _comp is None or not hasattr(_comp, "parameters"):
            continue
        if any(p.device.type == "meta" for p in _comp.parameters()):
            _meta_mods.append(_name)
    if _meta_mods:
        raise RuntimeError(
            "FLUX load incomplete — components with empty (meta) weights: "
            f"{', '.join(_meta_mods)}. The GGUF transformer load likely failed; "
            f"verify the GGUF file and that config repo '{spec.base_repo}' is "
            "reachable (the diffusers default 'black-forest-labs/FLUX.2-dev' is gated)."
        )

    # ── 3. Memory management ───────────────────────────────────────────────
    # Apply VRAM hard cap before first GPU allocation.
    apply_vram_cap()

    if device == "cuda":
        if _FLUX_USE_CPU_OFFLOAD:
            pipe.enable_model_cpu_offload()
            log.info("model_cpu_offload active — only active module on GPU, peak ~8 GB, no sysmem spill.")
        else:
            try:
                pipe.to("cuda")
                log.info("FLUX pipeline resident on CUDA — Q6_K, no offload.")
            except (RuntimeError, MemoryError) as e:
                log.warning(
                    "Direct CUDA load failed (%s); enabling CPU-offload fallback.", e
                )
                pipe.enable_model_cpu_offload()
        # Safety nets so 1024+ resolutions can't blow VRAM on a tight day.
        if hasattr(pipe, "vae") and pipe.vae is not None:
            for fn in ("enable_slicing", "enable_tiling"):
                try:
                    getattr(pipe.vae, fn)()
                except Exception:
                    pass
    else:
        pipe = pipe.to("cpu")

    _flux_pipe   = pipe
    _flux_device = device
    _loaded_image_model = spec.key

    # Register the unload callback. We schedule the timer only after the
    # first successful generation finishes — registering with auto-schedule
    # races with long gens (would fire mid-inference).
    register_idle_unload(
        GPUResource.FLUX,
        _unload_flux_pipeline,
        timeout_s=_FLUX_IDLE_UNLOAD_S,
        start_timer=False,
    )

    log.info("FLUX.2-klein-4B pipeline ready on %s.", device)
    return pipe

def _load_image_pipeline(cfg, model_key: str | None = None):
    spec = _image_model_spec(cfg, model_key)
    return _load_flux_pipeline(cfg, spec), spec

# ── Image generation ─────────────────────────────────────────────────────────

def _unload_flux_pipeline() -> None:
    """Completely unload the FLUX pipeline, freeing all VRAM."""
    global _flux_pipe, _flux_device, _loaded_image_model
    if _flux_pipe is None:
        return
    log.info("Unloading FLUX.2-klein-4B pipeline to free VRAM…")
    try:
        # Move all components to CPU first, then delete
        try:
            _flux_pipe.to("cpu")
        except Exception:
            pass
        del _flux_pipe
    except Exception as e:
        log.warning("Error during FLUX unload: %s", e)
    _flux_pipe = None
    _loaded_image_model = None
    _flush_gpu()
    gc.collect()
    log.info("FLUX pipeline unloaded.")

def _generate_flux2klein(
    prompt: str,
    *,
    cfg,
    image_model: str | None = None,
    width: int,
    height: int,
    steps: int,
    guidance_scale: float,
    seed: int | None,
    init_image: str | None = None,
    strength: float = 0.65,
) -> "Any":
    """Single FLUX.2-klein generation.

    Hardened against OOM:
      - Runs inside gpu_exclusive(GPUResource.FLUX) which evicts Whisper
        from GPU before we start and restores it when we finish.
      - wrap in `torch.inference_mode()` so autograd buffers never allocate
      - force `empty_cache()` + GC before AND after the call
      - On OOM: flush everything, retry once, then fail gracefully
    """
    import torch

    # Cancel any pending idle-unload since we're about to use the pipeline.
    cancel_idle_unload(GPUResource.FLUX)

    pipe, spec = _load_image_pipeline(cfg, image_model)

    # Pre-clean — any leftover allocations from a previous gen.
    _flush_gpu()

    generator = None
    if seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(int(seed))

    _step_times: list[float] = []
    _t_start = time.time()

    def _on_step(pipe, step_idx, timestep, callback_kwargs):
        _step_times.append(time.time())
        elapsed = _step_times[-1] - _t_start
        eta = (elapsed / (step_idx + 1)) * (steps - step_idx - 1) if step_idx > 0 else "?"
        eta_str = f"{eta:.1f}s" if isinstance(eta, float) else eta
        log.info(
            "%s step %d/%d — elapsed %.1fs, ETA %s",
            spec.label, step_idx + 1, steps, elapsed, eta_str,
        )
        pct = int(((step_idx + 1) / steps) * 100)
        _progress_report(
            f"{spec.label}: step {step_idx + 1}/{steps} ({pct}%) - "
            f"{elapsed:.1f}s elapsed, ETA {eta_str}"
        )
        return callback_kwargs

    log.info(
        "Generating %dx%d image · %d steps · guidance %.1f%s · prompt: %s",
        width, height, steps, guidance_scale,
        f" · img2img strength={strength}" if init_image else "",
        prompt[:80],
    )
    _progress_report(f"{spec.label}: generating {width}x{height} image - {steps} steps - {prompt[:60]}...")

    # Load init image for img2img mode if provided.
    pil_init = None
    if init_image:
        from PIL import Image as _PILImage, ImageOps as _PILImageOps
        init_path = Path(init_image)
        if init_path.exists():
            with _PILImage.open(init_path) as src:
                pil_init = _PILImageOps.exif_transpose(src).convert("RGB").resize((width, height))
            log.info("img2img: using init image %s (resized to %dx%d)", init_path.name, width, height)
        else:
            log.warning("img2img: init_image not found at %s, falling back to txt2img", init_image)

    def _do_generate():
        with torch.inference_mode():
            call_kwargs: dict[str, Any] = dict(
                prompt=prompt,
                height=height,
                width=width,
                num_inference_steps=steps,
                guidance_scale=guidance_scale,
                generator=generator,
                callback_on_step_end=_on_step,
                callback_on_step_end_tensor_inputs=[],
            )
            if pil_init is not None:
                call_kwargs["image"] = pil_init
                if "strength" in inspect.signature(pipe.__call__).parameters:
                    call_kwargs["strength"] = strength
                else:
                    log.info("%s does not support img2img strength; using image conditioning only.", type(pipe).__name__)
            out = pipe(**call_kwargs)
        image = out.images[0]
        # Defensively pin a CPU-side copy so the original tensor can be GC'd.
        image.load()  # PIL.Image: forces decode of any lazy data
        # Explicitly delete the output to free intermediate tensors
        del out
        return image

    try:
        try:
            image = _do_generate()
        except (torch.cuda.OutOfMemoryError, RuntimeError) as oom_err:
            if "out of memory" in str(oom_err).lower() or isinstance(oom_err, torch.cuda.OutOfMemoryError):
                log.warning("CUDA OOM during generation — flushing and retrying…")
                _flush_gpu()
                gc.collect()
                # On retry failure, unload pipeline entirely and reload fresh
                try:
                    image = _do_generate()
                except (torch.cuda.OutOfMemoryError, RuntimeError):
                    log.warning("Second OOM — unloading pipeline and retrying with fresh load…")
                    _unload_flux_pipeline()
                    pipe, _ = _load_image_pipeline(cfg, spec.key)
                    image = _do_generate()
            else:
                raise
        return image
    finally:
        # Post-clean — drop intermediates regardless of success/failure.
        _flush_gpu()
        gc.collect()
        # Re-arm idle-unload only when a finite timeout is configured.
        # _FLUX_IDLE_UNLOAD_S = 0 means "keep pipeline loaded forever".
        if _FLUX_IDLE_UNLOAD_S > 0:
            schedule_idle_unload(GPUResource.FLUX, timeout_s=_FLUX_IDLE_UNLOAD_S)
