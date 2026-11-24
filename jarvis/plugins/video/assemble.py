"""Draft video assembly — ffmpeg + the existing Edge-TTS narration path.

Design for a weak laptop (~7 GB RAM, laptop GPU):
  - NO model downloads, NO GPU work. Narration reuses the existing
    Edge-TTS voice (``cfg.voice.edge_voice`` — Arabic default) and the
    picture is one still image per scene, so ffmpeg only ever holds one
    720p frame plus one audio stream in memory.
  - Chunked: each scene renders to its own short clip first, then the
    clips are concatenated. A failed scene fails the job with a clear
    error instead of burning minutes on a full re-render.
  - Draft only: output is a local ``draft.mp4`` under ``data/video/``.
    Nothing is uploaded or published anywhere.

ffmpeg is REQUIRED and is NOT installed by Jarvis — see docs/video.md.
When it is missing, rendering refuses with the install command.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

log = logging.getLogger("jarvis.video")

DEFAULT_WIDTH = 1280
DEFAULT_HEIGHT = 720
# Dark HUD background used when a scene has no image.
BACKGROUND_COLOR = "0x0b1020"
# Fallback voice when the config carries none — the user speaks Arabic.
DEFAULT_VOICE = "ar-SA-HamedNeural"

FFMPEG_INSTALL_HINT = (
    "ffmpeg is required but was not found. Install it first, then retry: "
    "Windows: winget install Gyan.FFmpeg | "
    "macOS: brew install ffmpeg | "
    "Ubuntu/Debian: sudo apt install ffmpeg"
)


class RenderError(Exception):
    """A render step failed; message is safe to show to the user."""


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _voice_settings(cfg: Any) -> tuple[str, str, str]:
    """(voice, rate, pitch) from the config, with safe fallbacks."""
    voice_cfg = getattr(cfg, "voice", None)
    voice = (getattr(voice_cfg, "edge_voice", "") or "").strip() or DEFAULT_VOICE
    rate = (getattr(voice_cfg, "edge_rate", "") or "").strip() or "-6%"
    pitch = (getattr(voice_cfg, "edge_pitch", "") or "").strip() or "+0Hz"
    return voice, rate, pitch


async def synthesize_narration(
    text: str, out_path: str | Path, cfg: Any, voice: str | None = None,
) -> Path:
    """Speak *text* with Edge-TTS into an .mp3 file (async, network call).

    Raises RenderError when edge-tts is not installed or synthesis fails.
    """
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    use_voice, rate, pitch = _voice_settings(cfg)
    if voice:
        use_voice = voice
    try:
        import edge_tts
    except Exception as e:  # noqa: BLE001
        raise RenderError(
            "edge-tts is not installed (pip install edge-tts). "
            "Narration needs it — or render with narration skipped."
        ) from e
    communicate = edge_tts.Communicate(text, voice=use_voice, rate=rate, pitch=pitch)
    try:
        await communicate.save(str(out))
    except Exception as e:  # noqa: BLE001
        raise RenderError(f"Edge-TTS narration failed ({use_voice}): {e}") from e
    return out


def _audio_duration(path: str | Path) -> float | None:
    """Length of an audio file in seconds via ffprobe, or None if unknown."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    try:
        r = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        return float(r.stdout.strip())
    except Exception:  # noqa: BLE001
        return None


def _run_ffmpeg(args: list[str], timeout: int = 600) -> None:
    """Run ffmpeg; raise RenderError with the tail of stderr on failure."""
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise RenderError(f"ffmpeg timed out after {timeout}s") from e
    except FileNotFoundError as e:
        raise RenderError(FFMPEG_INSTALL_HINT) from e
    if r.returncode != 0:
        tail = (r.stderr or "").strip().splitlines()[-5:]
        raise RenderError("ffmpeg failed: " + " | ".join(tail))


def render_scene_clip(
    image: str | Path | None,
    audio: str | Path | None,
    duration: float,
    out_path: str | Path,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
) -> Path:
    """Render one scene to a short .mp4 clip (one still + one audio track)."""
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    duration = max(1.0, float(duration))
    scale = (
        f"[0:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p[v]"
    )
    if image:
        image = Path(image)
        if not image.exists():
            raise RenderError(f"scene image not found: {image}")
        cmd = ["ffmpeg", "-y", "-loop", "1", "-framerate", "1", "-i", str(image)]
    else:
        cmd = ["ffmpeg", "-y", "-f", "lavfi", "-i",
               f"color=c={BACKGROUND_COLOR}:s={width}x{height}:r=30"]
    if audio:
        audio = Path(audio)
        if not audio.exists():
            raise RenderError(f"scene audio not found: {audio}")
        cmd += ["-i", str(audio)]
        audio_map = "1:a"
    else:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
        audio_map = "1:a"
    cmd += [
        "-filter_complex", scale,
        "-map", "[v]", "-map", audio_map,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-t", str(duration), "-movflags", "+faststart",
        str(out),
    ]
    _run_ffmpeg(cmd)
    return out


def concat_clips(clips: list[str | Path], out_path: str | Path) -> Path:
    """Concatenate same-codec clips into one mp4 (stream copy, no re-encode)."""
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    if not clips:
        raise RenderError("nothing to concatenate — no scene clips were rendered")
    list_file = out.parent / "concat.txt"
    lines = []
    for clip in clips:
        p = str(Path(clip)).replace("'", "'\\''")
        lines.append(f"file '{p}'")
    list_file.write_text("\n".join(lines), encoding="utf-8")
    try:
        _run_ffmpeg(["ffmpeg", "-y", "-f", "concat", "-safe", "0",
                     "-i", str(list_file), "-c", "copy", str(out)])
    finally:
        list_file.unlink(missing_ok=True)
    return out


def _slug(name: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_-]+", "_", (name or "video").strip()).strip("_")
    return slug or "video"


async def render_draft(
    project_id: int,
    store,
    cfg: Any,
    voice: str | None = None,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
) -> dict:
    """Render a whole project to a draft mp4, scene by scene.

    Returns a result dict; raises RenderError on failure (project status
    is set to ``failed`` with the error recorded). Narration that fails
    for a scene does NOT fail the job — that scene renders silent and is
    listed in ``silent_scenes`` so the user knows.
    """
    if not ffmpeg_available():
        raise RenderError(FFMPEG_INSTALL_HINT)
    project = store.get_project(int(project_id))
    if project is None:
        raise RenderError(f"project not found: {project_id}")
    scenes = project.get("scenes") or []
    if not scenes:
        raise RenderError(
            f"project {project_id} has no scenes — add scenes first "
            "(video_add_scene) or plan from a script"
        )
    workdir = Path(cfg.abs_path(f"data/video/{project_id}-{_slug(project['name'])}"))
    workdir.mkdir(parents=True, exist_ok=True)
    store.set_project_status(int(project_id), "rendering")
    clips: list[Path] = []
    silent_scenes: list[str] = []
    total = 0.0
    try:
        for scene in scenes:
            title = scene.get("title") or f"Scene {scene.get('idx', 0) + 1}"
            narration = (scene.get("narration") or "").strip()
            planned = float(scene.get("duration_seconds") or 5.0)
            audio_path: Path | None = None
            if narration:
                audio_path = workdir / f"scene_{scene.get('idx', 0):02d}.mp3"
                try:
                    await synthesize_narration(
                        narration, audio_path, cfg, voice=voice)
                    store.set_scene_audio(scene["id"], str(audio_path))
                except RenderError as e:
                    log.warning("scene %r narration failed, rendering silent: %s",
                                title, e)
                    silent_scenes.append(title)
                    audio_path = None
            if audio_path is not None:
                audio_len = await asyncio.to_thread(_audio_duration, audio_path)
                duration = max(planned, audio_len or 0.0)
            else:
                duration = planned
            clip = workdir / f"scene_{scene.get('idx', 0):02d}.mp4"
            await asyncio.to_thread(
                render_scene_clip,
                scene.get("image_path") or None,
                audio_path,
                duration,
                clip,
                width,
                height,
            )
            store.set_scene_status(scene["id"], "done")
            clips.append(clip)
            total += duration
        output = workdir / "draft.mp4"
        await asyncio.to_thread(concat_clips, clips, output)
        for clip in clips:  # keep the final mp4 + narration; drop intermediates
            clip.unlink(missing_ok=True)
        result = {
            "ok": True,
            "project_id": int(project_id),
            "project": project["name"],
            "output": str(output),
            "output_path": str(output),
            "duration_seconds": round(total, 1),
            "scenes": len(scenes),
            "silent_scenes": silent_scenes,
            "resolution": f"{width}x{height}",
            "note": "DRAFT only — local file, nothing was uploaded or published.",
        }
        if silent_scenes:
            result["warning"] = (
                "Narration failed for: " + ", ".join(silent_scenes) +
                " — those scenes are silent. Check internet / edge-tts and re-render."
            )
        store.set_project_status(int(project_id), "done", output_path=str(output))
        return result
    except RenderError:
        store.set_project_status(int(project_id), "failed",
                                 error="render failed — see result")
        raise
    except Exception as e:  # noqa: BLE001
        store.set_project_status(int(project_id), "failed", error=str(e))
        raise RenderError(f"render failed: {e}") from e
