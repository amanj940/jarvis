"""Hunyuan3D-2GP Mini Turbo image->3D backend.

Moved out of plugins/media_generation.py (Phase 2). Owns the Hunyuan3D
shape-model singleton, its source/weights download, the retry loop over
seeds/marching-cubes levels, and the image-relief GLB fallback.
"""
from __future__ import annotations

import gc
import os
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

from ...core.task_progress import report as _progress_report
from ...core.vram_manager import (
    GPUResource,
    apply_vram_cap,
    flush_gpu as _flush_gpu,
    register_eviction,
    register_idle_unload,
)
from .common import _local_models_dir, _select_device, log

# -- 3D (Hunyuan3D-2GP Mini Turbo) config -----------------------------------
# The true quantized Hunyuan GGUF options (calcuis/hy3d-gguf) are
# ComfyUI/GGUF-node weights, not loadable by the native hy3dgen runtime without
# embedding a ComfyUI worker. For Jarvis' direct Python tool path, the smallest
# reliable no-access model is Tencent's 0.6B Mini Turbo shape model. It
# downloads only the shape + turbo VAE folders, not the full 25 GB repo.
_HY3DGP_SOURCE_COMMIT = "f2456e036a86a4b1d9f58e2379fe7ab0fe9b68b0"
_HY3DGP_SOURCE_ZIP = (
    "https://github.com/deepbeepmeep/Hunyuan3D-2GP/archive/"
    f"{_HY3DGP_SOURCE_COMMIT}.zip"
)
_HY3D_REPO = "tencent/Hunyuan3D-2mini"
_HY3D_SHAPE_SUBFOLDER = "hunyuan3d-dit-v2-mini-turbo"
_HY3D_VAE_SUBFOLDER = "hunyuan3d-vae-v2-mini-turbo"
_HY3D_KIND = "hunyuan3d-2gp-mini-turbo"
_HY3D_LABEL = "Hunyuan3D-2GP Mini Turbo"
_HY3D_STEPS = 5
_HY3D_GUIDANCE = 5.0
_HY3D_OCTREE_RES = 256
_HY3D_NUM_CHUNKS = 80000
_HY3D_IDLE_UNLOAD_S = 180.0
_HY3D_RETRY_SEEDS = (3407, 1234, 2027)
_HY3D_MC_LEVELS = (0.0, -1.0 / 512.0, 1.0 / 512.0)

_sf3d_model  = None
_sf3d_device: str | None = None
_hy3d_rembg = None      # cached Hunyuan3D background remover

# -- Image -> 3D (Hunyuan3D-2GP Mini Turbo) ---------------------------------

def _hy3d_models_root(cfg) -> Path:
    p = _local_models_dir(cfg) / "hunyuan3d"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _hy3d_source_dir(cfg) -> Path:
    return _local_models_dir(cfg) / f"hunyuan3d-2gp-{_HY3DGP_SOURCE_COMMIT[:8]}"


def _ensure_hy3dgp_source(cfg) -> Path:
    """Download the pinned Hunyuan3D-2GP source snapshot if absent."""
    dest = _hy3d_source_dir(cfg)
    marker = dest / "hy3dgen" / "shapegen" / "pipelines.py"
    if not marker.exists():
        models_root = _local_models_dir(cfg).resolve()
        if not str(dest.resolve(strict=False)).startswith(str(models_root)):
            raise RuntimeError(f"refusing to write Hunyuan3D source outside {models_root}")

        tmp_dir = _local_models_dir(cfg) / "_hunyuan3dgp_source_download"
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir)
        tmp_dir.mkdir(parents=True, exist_ok=True)
        zip_path = tmp_dir / "source.zip"

        log.info("Downloading Hunyuan3D-2GP source snapshot %s", _HY3DGP_SOURCE_COMMIT[:8])
        _progress_report("Downloading Hunyuan3D-2GP runtime source...")
        try:
            urllib.request.urlretrieve(_HY3DGP_SOURCE_ZIP, zip_path)
            with zipfile.ZipFile(zip_path) as zf:
                zf.extractall(tmp_dir)
            candidates = [
                p for p in tmp_dir.iterdir()
                if (p / "hy3dgen" / "shapegen" / "pipelines.py").exists()
            ]
            if not candidates:
                raise RuntimeError("downloaded archive did not contain hy3dgen")
            if dest.exists():
                shutil.rmtree(dest)
            shutil.move(str(candidates[0]), str(dest))
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    src = str(dest)
    if src not in sys.path:
        sys.path.insert(0, src)
    return dest


def _ensure_hy3d_subfolder(cfg, subfolder: str) -> Path:
    """Download only one model subfolder into data/models/hunyuan3d."""
    repo_dir = _hy3d_models_root(cfg) / _HY3D_REPO
    target = repo_dir / subfolder
    config = target / "config.yaml"
    weights = target / "model.fp16.safetensors"
    if config.exists() and weights.exists():
        return target

    log.info("Downloading %s/%s to %s", _HY3D_REPO, subfolder, repo_dir)
    _progress_report(f"Downloading {_HY3D_LABEL} files: {subfolder}...")
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id=_HY3D_REPO,
            allow_patterns=[
                f"{subfolder}/config.yaml",
                f"{subfolder}/model.fp16.safetensors",
            ],
            local_dir=str(repo_dir),
            max_workers=4,
        )
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(
            f"Failed to download {_HY3D_LABEL} subfolder '{subfolder}': {e}\n"
            f"Manual download: https://huggingface.co/{_HY3D_REPO}/tree/main/{subfolder}\n"
            f"Place files under: {target}"
        ) from e

    if not (config.exists() and weights.exists()):
        raise RuntimeError(f"Incomplete {_HY3D_LABEL} download: {target}")
    return target


def _check_hy3d_runtime() -> None:
    import importlib.util

    missing: list[str] = []
    for module, pip_name in (
        ("einops", "einops"),
        ("mmgp", "mmgp==3.2.7"),
        ("pymeshlab", "pymeshlab"),
        ("rembg", "rembg"),
    ):
        if importlib.util.find_spec(module) is None:
            missing.append(pip_name)
    if missing:
        raise RuntimeError(
            f"{_HY3D_LABEL} dependencies missing: {', '.join(missing)}. "
            "Install them in this venv, then retry."
        )


def _select_hy3d_mc_algo() -> str:
    try:
        import diso  # noqa: F401
        return "dmc"
    except Exception:
        return "mc"


def _unload_sf3d() -> None:
    """Drop the Hunyuan3D shape weights and free VRAM."""
    global _sf3d_model, _sf3d_device, _hy3d_rembg
    if _sf3d_model is None:
        return
    log.info("Unloading %s to free VRAM...", _HY3D_LABEL)
    try:
        kind, model, _mc_algo = _sf3d_model
        try:
            model.to("cpu")
        except Exception:
            pass
        del model
        del _sf3d_model
    except Exception as e:
        log.warning("Error during 3D unload: %s", e)
    _sf3d_model = None
    _sf3d_device = None
    _hy3d_rembg = None
    _flush_gpu()
    gc.collect()


def _evict_sf3d_from_gpu() -> None:
    _unload_sf3d()


def _restore_sf3d_to_gpu() -> None:
    log.info("3D restore available (will lazy-load on next 3D request)")

def _load_hunyuan3d(cfg):
    """Load Hunyuan3D-2GP Mini Turbo as the local image->3D backend."""
    global _sf3d_model, _sf3d_device, _hy3d_rembg
    if _sf3d_model is not None:
        return _sf3d_model, _sf3d_device

    import torch

    device = _select_device()
    if device != "cuda":
        raise RuntimeError(f"{_HY3D_LABEL} needs CUDA for the current Hunyuan3D-2GP source.")

    _check_hy3d_runtime()
    apply_vram_cap()
    _flush_gpu()

    if device == "cuda":
        try:
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            torch.backends.cudnn.benchmark = True
            torch.set_float32_matmul_precision("high")
        except Exception:
            pass

    source_dir = _ensure_hy3dgp_source(cfg)
    os.environ["HY3DGEN_MODELS"] = str(_hy3d_models_root(cfg))
    _ensure_hy3d_subfolder(cfg, _HY3D_SHAPE_SUBFOLDER)
    _ensure_hy3d_subfolder(cfg, _HY3D_VAE_SUBFOLDER)

    try:
        from hy3dgen.rembg import BackgroundRemover  # type: ignore
        from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline  # type: ignore
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(
            f"Hunyuan3D-2GP source import failed from {source_dir}: {e}"
        ) from e

    log.info("Loading %s from %s/%s", _HY3D_LABEL, _HY3D_REPO, _HY3D_SHAPE_SUBFOLDER)
    _progress_report(f"Loading {_HY3D_LABEL} on {device}...")
    model = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        _HY3D_REPO,
        subfolder=_HY3D_SHAPE_SUBFOLDER,
        use_safetensors=True,
        device=device,
    )
    mc_algo = _select_hy3d_mc_algo()
    try:
        model.enable_flashvdm(mc_algo=mc_algo)
    except Exception as e:  # noqa: BLE001
        log.warning("FlashVDM setup with mc_algo=%s failed (%s); retrying with mc.", mc_algo, e)
        mc_algo = "mc"
        model.enable_flashvdm(mc_algo=mc_algo)

    _hy3d_rembg = BackgroundRemover()
    _sf3d_model = (_HY3D_KIND, model, mc_algo)
    _sf3d_device = device
    log.info(
        "Loaded %s on %s (steps=%d, octree=%d, chunks=%d, mc=%s).",
        _HY3D_LABEL, device, _HY3D_STEPS, _HY3D_OCTREE_RES, _HY3D_NUM_CHUNKS, mc_algo,
    )

    register_eviction(
        GPUResource.SF3D,
        evict_fn=_evict_sf3d_from_gpu,
        restore_fn=_restore_sf3d_to_gpu,
    )
    register_idle_unload(
        GPUResource.SF3D, _unload_sf3d,
        timeout_s=_HY3D_IDLE_UNLOAD_S, start_timer=False,
    )
    return _sf3d_model, _sf3d_device

def _export_image_relief_glb(img, out_path: Path) -> None:
    """Last-resort GLB: a shallow textured relief, so any image is renderable."""
    import numpy as np
    import trimesh
    from PIL import ImageOps
    from trimesh.visual.texture import TextureVisuals

    tex = img.convert("RGBA")
    max_tex = 1024
    if max(tex.size) > max_tex:
        tex.thumbnail((max_tex, max_tex))

    tex_w, tex_h = tex.size
    aspect = tex_w / max(tex_h, 1)
    grid_w = 96 if aspect >= 1 else max(32, int(96 * aspect))
    grid_h = 96 if aspect < 1 else max(32, int(96 / aspect))

    grey = ImageOps.grayscale(tex).resize((grid_w, grid_h))
    alpha = tex.getchannel("A").resize((grid_w, grid_h))
    height = np.asarray(grey, dtype=np.float32) / 255.0
    mask = np.asarray(alpha, dtype=np.float32) / 255.0

    width = 1.4 if aspect >= 1 else 1.4 * aspect
    height_world = 1.4 / aspect if aspect >= 1 else 1.4
    relief = ((height - 0.5) * 0.10 + mask * 0.035).astype(np.float32)

    vertices = []
    uvs = []
    for y in range(grid_h):
        fy = y / (grid_h - 1)
        for x in range(grid_w):
            fx = x / (grid_w - 1)
            vertices.append([
                (fx - 0.5) * width,
                (0.5 - fy) * height_world,
                float(relief[y, x]),
            ])
            uvs.append([fx, 1.0 - fy])

    faces = []
    for y in range(grid_h - 1):
        for x in range(grid_w - 1):
            a = y * grid_w + x
            b = a + 1
            c = a + grid_w
            d = c + 1
            faces.append([a, c, b])
            faces.append([b, c, d])

    mesh = trimesh.Trimesh(
        vertices=np.asarray(vertices, dtype=np.float32),
        faces=np.asarray(faces, dtype=np.int64),
        process=False,
    )
    mesh.visual = TextureVisuals(uv=np.asarray(uvs, dtype=np.float32), image=tex)
    mesh.metadata["extras"] = {
        "model": "image-relief-fallback",
        "reason": "Hunyuan3D returned no extractable surface",
    }
    mesh.export(str(out_path))

def _apply_projected_image_texture(mesh, img) -> None:
    """Embed a lightweight projected texture from the source image."""
    import numpy as np
    from trimesh.visual.texture import SimpleMaterial, TextureVisuals

    tex = img.convert("RGBA")
    max_tex = 1024
    if max(tex.size) > max_tex:
        tex.thumbnail((max_tex, max_tex))

    vertices = np.asarray(mesh.vertices, dtype=np.float32)
    if vertices.size == 0:
        return

    bounds = np.asarray(mesh.bounds, dtype=np.float32)
    span = np.maximum(bounds[1] - bounds[0], 1e-6)
    u = (vertices[:, 0] - bounds[0, 0]) / span[0]
    v = 1.0 - ((vertices[:, 1] - bounds[0, 1]) / span[1])
    uv = np.column_stack([np.clip(u, 0.0, 1.0), np.clip(v, 0.0, 1.0)]).astype(np.float32)

    # TextureVisuals gives model-viewer a real embedded image texture, while
    # the UV projection keeps this pass cheap enough for the fast local path.
    mesh.visual = TextureVisuals(
        uv=uv,
        image=tex,
        material=SimpleMaterial(image=tex),
    )

def _run_hunyuan_image_to_3d(cfg, image_path: Path, out_path: Path) -> tuple[str, Path]:
    """Single image -> GLB via Hunyuan3D-2GP Mini Turbo."""
    import contextlib
    import io
    import torch
    from PIL import Image

    (kind, model, mc_algo), device = _load_hunyuan3d(cfg)

    with Image.open(image_path) as src:
        raw_img = src.convert("RGB")

    img = raw_img
    try:
        if _hy3d_rembg is not None:
            img = _hy3d_rembg(raw_img)
    except Exception as e:  # noqa: BLE001
        log.warning("%s background removal skipped (%s); using raw image.", _HY3D_LABEL, e)

    image_variants = [("rembg", img)]
    if img is not raw_img:
        image_variants.append(("raw", raw_img))
    mesh_algos = [mc_algo] if mc_algo == "mc" else [mc_algo, "mc"]
    attempts: list[str] = []

    def _sample_latents(input_img, seed: int):
        generator = torch.Generator(device=device).manual_seed(seed)
        return model(
            image=input_img,
            num_inference_steps=_HY3D_STEPS,
            guidance_scale=_HY3D_GUIDANCE,
            generator=generator,
            octree_resolution=_HY3D_OCTREE_RES,
            num_chunks=_HY3D_NUM_CHUNKS,
            output_type="latent",
            mc_algo=None,
            enable_pbar=False,
        )

    _progress_report(f"{_HY3D_LABEL}: generating mesh...")
    mesh = None
    used = {"variant": "", "seed": 0, "mc_algo": mc_algo, "mc_level": 0.0}
    with torch.inference_mode():
        for variant_name, input_img in image_variants:
            for seed in _HY3D_RETRY_SEEDS:
                _progress_report(
                    f"{_HY3D_LABEL}: sampling {variant_name} seed {seed}..."
                )
                latents = _sample_latents(input_img, seed)
                for level in _HY3D_MC_LEVELS:
                    for algo in mesh_algos:
                        try:
                            export_stderr = io.StringIO()
                            with contextlib.redirect_stderr(export_stderr):
                                meshes = model._export(
                                    latents,
                                    output_type="trimesh",
                                    box_v=1.01,
                                    mc_level=level,
                                    num_chunks=_HY3D_NUM_CHUNKS,
                                    octree_resolution=_HY3D_OCTREE_RES,
                                    mc_algo=algo,
                                    enable_pbar=False,
                                )
                            mesh = meshes[0] if meshes else None
                            if mesh is None and export_stderr.getvalue():
                                log.debug(
                                    "%s no-surface export detail: %s",
                                    _HY3D_LABEL,
                                    export_stderr.getvalue().splitlines()[-1],
                                )
                        except Exception as e:  # noqa: BLE001
                            attempts.append(f"{variant_name}/seed={seed}/{algo}/{level:g}: {e}")
                            mesh = None
                        if mesh is not None:
                            used = {
                                "variant": variant_name,
                                "seed": seed,
                                "mc_algo": algo,
                                "mc_level": level,
                            }
                            break
                    if mesh is not None:
                        break
                if mesh is not None:
                    break
                attempts.append(f"{variant_name}/seed={seed}: no extractable surface")
            if mesh is not None:
                break

    if mesh is None:
        log.warning(
            "%s returned no mesh after retries; exporting image relief fallback. Attempts: %s",
            _HY3D_LABEL,
            " | ".join(attempts[-8:]),
        )
        _export_image_relief_glb(raw_img, out_path)
        return f"{kind}-relief-fallback", out_path

    try:
        mesh.metadata["extras"] = {
            "model": f"{_HY3D_REPO}/{_HY3D_SHAPE_SUBFOLDER}",
            "steps": _HY3D_STEPS,
            "guidance_scale": _HY3D_GUIDANCE,
            "octree_resolution": _HY3D_OCTREE_RES,
            "num_chunks": _HY3D_NUM_CHUNKS,
            "mc_algo": used["mc_algo"],
            "mc_level": used["mc_level"],
            "seed": used["seed"],
            "input_variant": used["variant"],
        }
    except Exception:
        pass
    if os.getenv("JARVIS_HY3D_PROJECT_TEXTURE", "0").strip().lower() in {"1", "true", "yes"}:
        try:
            texture_img = img if used["variant"] == "rembg" else raw_img
            _apply_projected_image_texture(mesh, texture_img)
            mesh.metadata.setdefault("extras", {})["texture"] = "projected-source-image"
        except Exception as e:  # noqa: BLE001
            log.warning("Projected texture skipped for %s: %s", out_path.name, e)
    mesh.export(str(out_path))
    return kind, out_path


# Public alias — the provider interface calls this.
run_hunyuan_image_to_3d = _run_hunyuan_image_to_3d
