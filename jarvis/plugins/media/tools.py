"""Tool registrations for the media plugin (Phase 2).

``image_generate`` (FLUX), ``image_to_3d`` (provider interface) and
``text_to_3d`` (FLUX -> 3D chain). Tool names, descriptions, parameters
and the __JARVIS_MEDIA__ payload format are unchanged from
plugins/media_generation.py — only the implementations moved into
flux.py / providers.py.
"""
from __future__ import annotations

import asyncio
import gc
import json
import time
from pathlib import Path

from ...core.permissions import Permission
from ...core.vram_manager import (
    GPUResource,
    cancel_idle_unload,
    flush_gpu as _flush_gpu,
    gpu_exclusive_async,
    schedule_idle_unload,
)
from ..base import PluginInfo, tool
from . import flux as _flux
from .common import (
    MEDIA_PREFIX,
    _emit_media,
    _fit_size_to_aspect,
    _images_dir,
    _models_dir,
    _short_hash,
    log,
)
from .flux import _generate_flux2klein, _image_model_spec
from .providers import run_image_to_3d as _run_image_to_3d

def register(registry):
    cfg = registry.cfg

    @tool(
        name="image_generate",
        description=(
            "★ PREFERRED for any 'generate/create/make/draw/render/paint/design' "
            "image request. Runs FLUX.2-klein-4B locally and pushes the result "
            "to the Media Bay as an inline image card. NEVER suggest the user "
            "'go to a website for image generation' — this tool IS the service."
        ),
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "prompt":         {"type": "string"},
                "width":          {"type": "integer", "default": 1024},
                "height":         {"type": "integer", "default": 1024},
                "steps":          {"type": "integer",  "default": 0,
                                   "description": "0 or omitted uses the model default (4)."},
                "guidance_scale": {"type": "number",   "default": -1,
                                   "description": "-1 or omitted uses the model default (4.0)."},
                "seed":           {"type": "integer",  "description": "Optional reproducibility seed."},
                "init_image":     {"type": "string",   "description": "Optional path to an init image for img2img mode."},
                "strength":       {"type": "number",   "default": 0.65,
                                   "description": "img2img strength (0.0=keep original, 1.0=ignore original). Only used with init_image."},
            },
            "required": ["prompt"],
        },
        preview=lambda a: f"image_generate: {a.get('prompt','')[:80]}",
    )
    async def image_generate(
        prompt: str,
        width: int = 1024,
        height: int = 1024,
        steps: int | None = None,
        guidance_scale: float | None = None,
        seed: int | None = None,
        init_image: str | None = None,
        strength: float = 0.65,
    ) -> str:
        if not prompt.strip():
            return "empty prompt"

        selected_spec = _image_model_spec(cfg)
        if steps is None or int(steps) <= 0:
            steps = selected_spec.default_steps
        if guidance_scale is None or float(guidance_scale) < 0:
            guidance_scale = selected_spec.default_guidance

        # Resolve init_image path if it's an API URL.
        resolved_init = None
        if init_image:
            p_str = init_image.strip()
            if p_str.startswith("/api/files/"):
                rel = p_str[len("/api/files/"):]
                resolved_init = str(cfg.abs_path("data/" + rel))
            else:
                resolved_init = p_str

        if resolved_init:
            try:
                from PIL import Image as _PILImage, ImageOps as _PILImageOps
                init_path = Path(resolved_init)
                if init_path.exists():
                    with _PILImage.open(init_path) as probe:
                        src_w, src_h = _PILImageOps.exif_transpose(probe).size
                    new_width, new_height = _fit_size_to_aspect(src_w, src_h, width, height)
                    if (new_width, new_height) != (width, height):
                        log.info(
                            "img2img: preserving input aspect ratio %dx%d -> %dx%d",
                            src_w, src_h, new_width, new_height,
                        )
                    width, height = new_width, new_height
            except Exception as e:  # noqa: BLE001
                log.warning("img2img: could not read init image aspect ratio (%s)", e)

        loop = asyncio.get_running_loop()
        t0   = time.time()
        # The VRAM manager's exclusive lock evicts Whisper from GPU before
        # generation and restores it after. This prevents the two models
        # from competing for the same 16 GB of VRAM.
        ctx = await gpu_exclusive_async(GPUResource.FLUX)
        async with ctx:
            try:
                img = await loop.run_in_executor(
                    None,
                    lambda: _generate_flux2klein(
                        prompt,
                        cfg=cfg,
                        image_model=selected_spec.key,
                        width=width,
                        height=height,
                        steps=steps,
                        guidance_scale=guidance_scale,
                        seed=seed,
                        init_image=resolved_init,
                        strength=strength,
                    ),
                )
            except RuntimeError as e:
                _flush_gpu()
                return f"image gen failed: {e}"
            except Exception as e:  # noqa: BLE001
                log.exception("image gen unexpected error")
                _flush_gpu()
                return f"image gen error: {type(e).__name__}: {e}"
            dt = time.time() - t0

            out_dir = _images_dir(cfg)
            fname   = f"{selected_spec.key}-{int(time.time())}-{_short_hash(prompt)}.png"
            path    = out_dir / fname
            try:
                img.save(path)
            except Exception as e:  # noqa: BLE001
                log.exception("PIL save failed for %s", fname)
                _flush_gpu()
                return f"image save failed: {e}"
            finally:
                # Drop the PIL handle ASAP; large images keep ~12 MB each in RAM.
                try:
                    img.close()
                except Exception:
                    pass
                del img
                _flush_gpu()

            url = f"/api/files/generated/images/{fname}"
            log.info("image_generate OK (%.1fs) → %s", dt, path.name)
        return _emit_media(
            "image",
            [{
                "url":       url,
                "thumbnail": url,
                "title":     prompt[:80],
                "snippet":   f"{width}x{height} | {steps} steps | {dt:.1f}s | {selected_spec.label} ({_flux_device})",
                "source":    f"local | {selected_spec.label}",
            }],
            f"Generated: {prompt[:120]}",
        )

    @tool(
        name="image_to_3d",
        description=(
            "★ Convert ANY image (a generated image, an uploaded/attached photo, "
            "or a Media Bay image URL) into an interactive textured 3D GLB model using "
            "TRELLIS.2 FP8 (local, ungated public weights). Use this whenever the user says "
            "'turn this into 3D', 'make a 3D model of this', etc. The result "
            "renders inline in the Media Bay with an interactive 3D viewer."
        ),
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "image_path": {"type": "string"},
                "title":      {"type": "string", "default": ""},
            },
            "required": ["image_path"],
        },
        preview=lambda a: f"image_to_3d: {a.get('image_path','')}",
    )
    async def image_to_3d(image_path: str, title: str = "") -> str:
        p_str = image_path.strip()
        if p_str.startswith("/api/files/"):
            rel = p_str[len("/api/files/"):]
            p   = cfg.abs_path("data/" + rel)
        else:
            p = Path(p_str)
            if not p.is_absolute():
                p = cfg.abs_path(str(p))
        if not p.exists():
            return f"image not found: {p}"

        out_dir  = _models_dir(cfg)
        out_name = f"model-{int(time.time())}-{_short_hash(p.name)}.glb"
        out_path = out_dir / out_name

        loop = asyncio.get_running_loop()
        t0   = time.time()
        cancel_idle_unload(GPUResource.SF3D)
        ctx = await gpu_exclusive_async(GPUResource.SF3D)
        async with ctx:
            try:
                kind, _, _device = await loop.run_in_executor(None, lambda: _run_image_to_3d(cfg, p, out_path))
            except RuntimeError as e:
                _flush_gpu()
                return f"3D gen failed: {e}"
            except Exception as e:  # noqa: BLE001
                log.exception("3D gen unexpected error")
                _flush_gpu()
                return f"3D gen error: {type(e).__name__}: {e}"
            finally:
                _flush_gpu()
                gc.collect()
                schedule_idle_unload(GPUResource.SF3D, timeout_s=_HY3D_IDLE_UNLOAD_S)
        dt  = time.time() - t0
        url = f"/api/files/generated/models3d/{out_name}"
        log.info("image_to_3d OK (%.1fs, %s) → %s", dt, kind, out_path.name)
        return _emit_media(
            "model3d",
            [{
                "url":       url,
                "thumbnail": (f"/api/files/{p_str.replace('/api/files/','')}"
                              if p_str.startswith("/api/files/") else ""),
                "title":     title or f"3D from {p.name}",
                "snippet":   f"{kind} · {dt:.1f}s · {_device}",
                "source":    "local · " + kind,
            }],
            f"3D model generated ({kind}, {dt:.1f}s).",
        )

    @tool(
        name="text_to_3d",
        description=(
            "Generate a 3D model from a text prompt. Pipeline: image_generate "
            "(FLUX.2-klein) -> image_to_3d (TRELLIS.2 FP8 textured). Returns an inline "
            "3D viewer card in the Media Bay."
        ),
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "prompt": {"type": "string"},
                "steps":  {"type": "integer", "default": 4},
            },
            "required": ["prompt"],
        },
        preview=lambda a: f"text_to_3d: {a.get('prompt','')[:80]}",
    )
    async def text_to_3d(prompt: str, steps: int = 4) -> str:
        intermediate = await image_generate(prompt, steps=steps)
        if not intermediate.startswith(MEDIA_PREFIX):
            return intermediate
        try:
            payload = json.loads(intermediate[len(MEDIA_PREFIX):])
            img_url = payload["items"][0]["url"]
        except Exception:
            return "text_to_3d: could not parse intermediate image"
        return await image_to_3d(img_url, title=prompt[:80])

    registry.add_pending("media_generation")
    registry.register_plugin(PluginInfo(
        name="media_generation",
        description="Selectable local image generation + TRELLIS.2 FP8 textured 3D generation.",
        permissions_needed=[Permission.SAFE],
    ))
