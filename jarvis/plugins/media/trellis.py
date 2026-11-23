"""TRELLIS.2 FP8 textured image->3D backend (isolated worker).

Moved out of plugins/media_generation.py (Phase 2). Owns the isolated
Python 3.12 worker venv, its setup script invocation, and the subprocess
call that produces the textured GLB. No model is ever loaded in-process.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from ...core.task_progress import report as _progress_report
from .common import _local_models_dir, log

# -- 3D (TRELLIS.2 FP8 textured worker) config -------------------------------
_TRELLIS2_KIND = "trellis2-fp8-textured"
_TRELLIS2_LABEL = "TRELLIS.2 FP8 Textured"
_TRELLIS2_MODEL_REPO = "visualbruno/TRELLIS.2-4B-FP8"
_TRELLIS2_WORKER_TIMEOUT_S = int(os.getenv("JARVIS_TRELLIS2_TIMEOUT_S", "1200"))
_TRELLIS2_SETUP_TIMEOUT_S = int(os.getenv("JARVIS_TRELLIS2_SETUP_TIMEOUT_S", "2400"))
_TRELLIS2_DEFAULT_PIPELINE = os.getenv("JARVIS_TRELLIS2_PIPELINE", "512")
_TRELLIS2_DEFAULT_STEPS = int(os.getenv("JARVIS_TRELLIS2_STEPS", "8"))
_TRELLIS2_TEXTURE_STEPS = int(os.getenv("JARVIS_TRELLIS2_TEXTURE_STEPS", str(_TRELLIS2_DEFAULT_STEPS)))
_TRELLIS2_MAX_TOKENS = int(os.getenv("JARVIS_TRELLIS2_MAX_TOKENS", "49152"))
_TRELLIS2_TEXTURE_SIZE = int(os.getenv("JARVIS_TRELLIS2_TEXTURE_SIZE", "1024"))
_TRELLIS2_EXPORT_MODE = os.getenv("JARVIS_TRELLIS2_EXPORT_MODE", "texture").strip().lower()
_TRELLIS2_REMOVE_BACKGROUND = os.getenv("JARVIS_TRELLIS2_REMBG", "1").strip().lower() not in {"0", "false", "no"}

def _trellis2_worker_root(cfg) -> Path:
    p = _local_models_dir(cfg) / "trellis2-worker"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _trellis2_models_root(cfg) -> Path:
    p = _local_models_dir(cfg) / "trellis2"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _trellis2_source_dir(cfg) -> Path:
    return _trellis2_worker_root(cfg) / "src" / "ComfyUI-Trellis2"


def _trellis2_worker_python(cfg) -> Path:
    return _trellis2_worker_root(cfg) / "venv" / "Scripts" / "python.exe"


def _trellis2_worker_script() -> Path:
    return Path(__file__).resolve().parents[2] / "workers" / "trellis2_worker.py"


def _trellis2_setup_script(cfg) -> Path:
    return cfg.abs_path("scripts/setup_trellis2_worker.ps1")


def _ensure_trellis2_worker(cfg) -> tuple[Path, Path, Path]:
    """Ensure the isolated TRELLIS.2 Python 3.12 worker is installed."""
    py = _trellis2_worker_python(cfg)
    src = _trellis2_source_dir(cfg)
    script = _trellis2_worker_script()
    if py.exists() and (src / "trellis2" / "pipelines" / "trellis2_image_to_3d.py").exists():
        return py, src, script

    setup = _trellis2_setup_script(cfg)
    if not setup.exists():
        raise RuntimeError(f"{_TRELLIS2_LABEL} setup script missing: {setup}")

    log.info("Installing %s worker environment via %s", _TRELLIS2_LABEL, setup)
    _progress_report(f"Setting up {_TRELLIS2_LABEL} worker environment...")
    cmd = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(setup),
        "-ProjectRoot",
        str(cfg.project_root),
    ]
    proc = subprocess.run(
        cmd,
        cwd=str(cfg.project_root),
        capture_output=True,
        text=True,
        timeout=_TRELLIS2_SETUP_TIMEOUT_S,
    )
    if proc.returncode != 0:
        tail = "\n".join((proc.stdout + "\n" + proc.stderr).splitlines()[-60:])
        raise RuntimeError(f"{_TRELLIS2_LABEL} setup failed:\n{tail}")

    if not py.exists():
        raise RuntimeError(f"{_TRELLIS2_LABEL} setup completed but worker Python is missing: {py}")
    if not (src / "trellis2" / "pipelines" / "trellis2_image_to_3d.py").exists():
        raise RuntimeError(f"{_TRELLIS2_LABEL} setup completed but source is missing: {src}")
    return py, src, script

def _run_trellis2_image_to_3d(cfg, image_path: Path, out_path: Path) -> tuple[str, Path, str]:
    """Single image -> textured GLB via TRELLIS.2 FP8 in an isolated worker.

    Returns (kind, out_path, device).
    """

    py, src, script = _ensure_trellis2_worker(cfg)
    if not script.exists():
        raise RuntimeError(f"{_TRELLIS2_LABEL} worker script missing: {script}")

    pipeline = _TRELLIS2_DEFAULT_PIPELINE
    if pipeline not in {"512", "1024", "1024_cascade"}:
        pipeline = "1024_cascade"
    export_mode = _TRELLIS2_EXPORT_MODE if _TRELLIS2_EXPORT_MODE in {"texture", "vertex"} else "texture"

    cmd = [
        str(py),
        str(script),
        "--input",
        str(image_path),
        "--output",
        str(out_path),
        "--models-dir",
        str(_trellis2_models_root(cfg)),
        "--trellis-src",
        str(src),
        "--seed",
        os.getenv("JARVIS_TRELLIS2_SEED", "3407"),
        "--pipeline",
        pipeline,
        "--sparse-steps",
        str(_TRELLIS2_DEFAULT_STEPS),
        "--shape-steps",
        str(_TRELLIS2_DEFAULT_STEPS),
        "--texture-steps",
        str(_TRELLIS2_TEXTURE_STEPS),
        "--max-tokens",
        str(_TRELLIS2_MAX_TOKENS),
        "--texture-size",
        str(_TRELLIS2_TEXTURE_SIZE),
        "--export-mode",
        export_mode,
    ]
    if _TRELLIS2_REMOVE_BACKGROUND:
        cmd.append("--remove-background")

    log.info("Launching %s worker (%s, %d steps, texture=%s)", _TRELLIS2_LABEL, pipeline, _TRELLIS2_DEFAULT_STEPS, export_mode)
    _progress_report(f"{_TRELLIS2_LABEL}: generating textured GLB...")
    proc = subprocess.run(
        cmd,
        cwd=str(_trellis2_worker_root(cfg)),
        capture_output=True,
        text=True,
        timeout=_TRELLIS2_WORKER_TIMEOUT_S,
    )
    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    for line in combined.splitlines():
        if line.strip():
            log.info("trellis2: %s", line[:500])

    payload = None
    for line in reversed(proc.stdout.splitlines()):
        stripped = line.strip()
        if stripped.startswith("{") and stripped.endswith("}"):
            try:
                payload = json.loads(stripped)
                break
            except json.JSONDecodeError:
                pass

    if proc.returncode != 0 or not payload or not payload.get("ok"):
        err = payload.get("error") if isinstance(payload, dict) else None
        tail = "\n".join(combined.splitlines()[-60:])
        raise RuntimeError(f"{_TRELLIS2_LABEL} failed: {err or tail}")

    if not out_path.exists() or out_path.stat().st_size <= 0:
        raise RuntimeError(f"{_TRELLIS2_LABEL} returned no GLB at {out_path}")

    device = payload.get("device", "cuda-worker")
    texture_mode = payload.get("texture", "textured")
    return f"{_TRELLIS2_KIND}-{texture_mode}", out_path, device


# Public alias — the provider interface calls this.
run_trellis2_image_to_3d = _run_trellis2_image_to_3d
