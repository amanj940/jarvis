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

Second slice (docs/video.md): optional 0.5s crossfades between scenes
(``xfade`` — one re-encode), an SRT sidecar plus a soft ``mov_text``
subtitle track (auto-on for Arabic narration), and a ``cover.jpg``
thumbnail taken from the middle of the first scene.
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

from .subtitles import contains_arabic, write_srt

log = logging.getLogger("jarvis.video")

DEFAULT_WIDTH = 1280
DEFAULT_HEIGHT = 720
# Dark HUD background used when a scene has no image.
BACKGROUND_COLOR = "0x0b1020"
# Fallback voice when the config carries none — the user speaks Arabic.
DEFAULT_VOICE = "ar-SA-HamedNeural"
# Crossfade between scenes (slice 2): default length, hard ceiling.
DEFAULT_TRANSITION_SECONDS = 0.5
MAX_TRANSITION_SECONDS = 2.0

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


def build_xfade_filter(
    durations: list[float], transition: float,
) -> tuple[str, str, str]:
    """Build the filter_complex for chaining crossfades over *durations*.

    Returns ``(filter_complex, video_out_label, audio_out_label)``.
    Each input is first normalised (30 fps, yuv420p, 44.1 kHz stereo,
    timestamps reset) because scene clips can come from a 1 fps still
    or a 30 fps colour source and from mp3 or silent audio. The video
    chain uses ``xfade`` and the audio chain ``acrossfade``; the offset
    of the i-th join is ``sum(durations[:i]) - i * transition`` because
    every earlier join already overlapped by one transition length.

    The transition is clamped to half the shortest scene so no scene
    is consumed entirely by its two fades.
    """
    n = len(durations)
    if n < 2:
        raise ValueError("xfade needs at least 2 clips")
    if transition <= 0:
        raise ValueError("transition must be > 0 for an xfade join")
    transition = min(float(transition), MAX_TRANSITION_SECONDS,
                     min(durations) * 0.5)
    parts: list[str] = []
    for i in range(n):
        parts.append(f"[{i}:v]fps=30,format=yuv420p,setpts=PTS-STARTPTS[v{i}]")
        parts.append(
            f"[{i}:a]aresample=44100,aformat=channel_layouts=stereo,"
            f"asetpts=PTS-STARTPTS[a{i}]"
        )
    v_prev, a_prev = "v0", "a0"
    offset = durations[0] - transition
    for i in range(1, n):
        v_out = f"vx{i}" if i < n - 1 else "vout"
        a_out = f"ax{i}" if i < n - 1 else "aout"
        parts.append(
            f"[{v_prev}][v{i}]xfade=transition=fade:duration={transition:.3f}"
            f":offset={offset:.3f}[{v_out}]"
        )
        parts.append(f"[{a_prev}][a{i}]acrossfade=d={transition:.3f}[{a_out}]")
        offset += durations[i] - transition
        v_prev, a_prev = v_out, a_out
    return ";".join(parts), "vout", "aout"


def effective_transition(
    durations: list[float], transition: float,
) -> float:
    """The transition length actually usable for *durations* (0 if none)."""
    if not durations or len(durations) < 2 or transition <= 0:
        return 0.0
    return min(float(transition), MAX_TRANSITION_SECONDS,
               min(durations) * 0.5)


def xfade_clips(
    clips: list[str | Path],
    durations: list[float],
    out_path: str | Path,
    transition: float = DEFAULT_TRANSITION_SECONDS,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
) -> Path:
    """Join clips with a crossfade between consecutive scenes.

    One re-encode (libx264 veryfast / AAC, same settings as the scene
    clips). Falls back to the stream-copy ``concat_clips`` when there is
    a single clip or the transition clamps to zero. Crossfades cost one
    extra encode pass but no extra RAM — ffmpeg still holds one 720p
    frame at a time, which is what the weak laptop needs.
    """
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    if len(clips) < 2:
        return concat_clips(clips, out)
    use = effective_transition(durations, transition)
    if use <= 0:
        return concat_clips(clips, out)
    filter_complex, v_out, a_out = build_xfade_filter(durations, use)
    cmd = ["ffmpeg", "-y"]
    for clip in clips:
        cmd += ["-i", str(clip)]
    cmd += [
        "-filter_complex", filter_complex,
        "-map", f"[{v_out}]", "-map", f"[{a_out}]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        str(out),
    ]
    _run_ffmpeg(cmd)
    return out


def mux_subtitles(
    video: str | Path, srt_path: str | Path, out_path: str | Path,
    language: str = "ara",
) -> Path:
    """Mux an SRT file into an mp4 as a soft ``mov_text`` subtitle track.

    Video and audio are stream-copied (no re-encode); only the subtitle
    stream is encoded. The track is tagged with *language* (``ara`` for
    Arabic narration, ``eng`` otherwise) so players offer it by name.
    """
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    _run_ffmpeg([
        "ffmpeg", "-y",
        "-i", str(video), "-i", str(srt_path),
        "-map", "0:v", "-map", "0:a", "-map", "1",
        "-c", "copy", "-c:s", "mov_text",
        "-metadata:s:s:0", f"language={language}",
        str(out),
    ])
    return out


def extract_thumbnail(
    video: str | Path, out_path: str | Path, timestamp: float,
) -> Path:
    """Grab one frame from *video* at *timestamp* seconds as a JPEG cover."""
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    _run_ffmpeg([
        "ffmpeg", "-y",
        "-ss", f"{max(0.0, float(timestamp)):.3f}",
        "-i", str(video),
        "-frames:v", "1", "-q:v", "2",
        str(out),
    ])
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
    subtitles: bool | None = None,
    transitions: bool = True,
    transition_seconds: float = DEFAULT_TRANSITION_SECONDS,
) -> dict:
    """Render a whole project to a draft mp4, scene by scene.

    Returns a result dict; raises RenderError on failure (project status
    is set to ``failed`` with the error recorded). Narration that fails
    for a scene does NOT fail the job — that scene renders silent and is
    listed in ``silent_scenes`` so the user knows.

    Slice 2 options:
      - ``subtitles`` — True/False to force subtitles on/off; None
        (default) auto-enables them when any narration is Arabic.
        Produces ``draft.srt`` next to the video plus a soft ``mov_text``
        track muxed into the mp4.
      - ``transitions`` — 0.5s crossfade between scenes (default on);
        ``transition_seconds`` sets its length (clamped to half the
        shortest scene). Off = the old fast stream-copy concat.
      - A ``cover.jpg`` thumbnail (middle of the first scene) is always
        extracted next to the video; a thumbnail failure only warns.
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
    durations: list[float] = []
    narrations: list[str] = []
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
            durations.append(duration)
            narrations.append(narration)
            total += duration
        output = workdir / "draft.mp4"
        use_transition = (
            effective_transition(durations, transition_seconds)
            if transitions else 0.0
        )
        if use_transition > 0:
            await asyncio.to_thread(
                xfade_clips, clips, durations, output,
                use_transition, width, height,
            )
        else:
            await asyncio.to_thread(concat_clips, clips, output)
        final_total = total - use_transition * max(0, len(clips) - 1)
        for clip in clips:  # keep the final mp4 + narration; drop intermediates
            clip.unlink(missing_ok=True)

        # ---- slice 2: subtitles (sidecar .srt + soft mov_text track) ----
        want_subs = (
            subtitles if subtitles is not None
            else any(contains_arabic(t) for t in narrations)
        )
        subtitle_path = ""
        if want_subs:
            # Timings follow the FINAL timeline: each crossfade pulls
            # every later scene earlier by one transition length.
            timings = []
            start = 0.0
            for i, (dur, text) in enumerate(zip(durations, narrations)):
                timings.append((start, start + dur, text))
                start += dur - (use_transition if i < len(durations) - 1
                                else 0.0)
            srt_path = workdir / "draft.srt"
            write_srt(srt_path, timings)
            subtitle_path = str(srt_path)
            language = ("ara" if any(contains_arabic(t) for t in narrations)
                        else "eng")
            try:
                tmp_muxed = workdir / "draft_sub.mp4"
                await asyncio.to_thread(
                    mux_subtitles, output, srt_path, tmp_muxed, language)
                tmp_muxed.replace(output)
            except RenderError as e:
                log.warning("subtitle mux failed, keeping video without "
                            "subtitle track: %s", e)
                subtitle_path = str(srt_path)

        # ---- slice 2: thumbnail (middle of the first scene) ----
        thumbnail_path = ""
        thumb_warning = ""
        try:
            thumb = workdir / "cover.jpg"
            await asyncio.to_thread(
                extract_thumbnail, output, thumb, durations[0] / 2)
            thumbnail_path = str(thumb)
        except RenderError as e:
            log.warning("thumbnail extraction failed: %s", e)
            thumb_warning = f"Thumbnail failed ({e}); video is unaffected."

        result = {
            "ok": True,
            "project_id": int(project_id),
            "project": project["name"],
            "output": str(output),
            "output_path": str(output),
            "duration_seconds": round(final_total, 1),
            "scenes": len(scenes),
            "silent_scenes": silent_scenes,
            "resolution": f"{width}x{height}",
            "subtitles": bool(want_subs),
            "subtitle_path": subtitle_path,
            "transitions": bool(use_transition > 0),
            "transition_seconds": round(use_transition, 3),
            "thumbnail": thumbnail_path,
            "thumbnail_path": thumbnail_path,
            "note": "DRAFT only — local file, nothing was uploaded or published.",
        }
        if silent_scenes:
            result["warning"] = (
                "Narration failed for: " + ", ".join(silent_scenes) +
                " — those scenes are silent. Check internet / edge-tts and re-render."
            )
        if thumb_warning:
            result["warning"] = (
                (result.get("warning", "") + " " + thumb_warning).strip()
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
