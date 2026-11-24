"""Unit tests for the video builder plugin — no network, no keys, no real
ffmpeg and no real TTS. ffmpeg and Edge-TTS are both mocked; the tests
cover scene splitting, the job store, the ffmpeg-missing refusal, and
plugin registration/discovery."""
from __future__ import annotations

import asyncio
import base64
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarvis.plugins.video import assemble  # noqa: E402
from jarvis.plugins.video.script import (  # noqa: E402
    estimate_duration_seconds, plan_video, split_script,
)
from jarvis.plugins.video.store import VideoStore  # noqa: E402

# A 1x1 black PNG, base64 — no PIL needed to make a real image file.
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


# ---- scene planning ----

def test_split_script_blank_lines():
    scenes = split_script("Hello world.\n\nSecond scene here.\n\nThird.")
    assert [s.title for s in scenes] == ["Hello world.", "Second scene here.", "Third."]
    assert scenes[0].narration == "Hello world."
    assert scenes[0].index == 0 and scenes[2].index == 2


def test_split_script_ignores_empty_lines():
    scenes = split_script("\n\n  First.  \n\n\nSecond.\n\n")
    assert len(scenes) == 2
    assert scenes[0].narration == "First."


def test_split_script_empty_raises():
    with pytest.raises(ValueError, match="empty"):
        split_script("   \n\n  ")


def test_estimate_duration_scales_with_words():
    short = estimate_duration_seconds("one two")
    long = estimate_duration_seconds(" ".join(["word"] * 150))
    assert short == 3.0  # clamped to the minimum
    assert long == pytest.approx(60.0)  # 150 words at 150 wpm, clamped to max
    assert estimate_duration_seconds("") == 3.0


def test_plan_video_topic_only_is_single_scene():
    plan = plan_video(topic="Cats in space")
    assert plan["topic"] == "Cats in space"
    assert len(plan["scenes"]) == 1
    assert plan["scenes"][0]["narration"] == "Cats in space"


def test_plan_video_explicit_scenes_win():
    plan = plan_video(topic="T", scenes=[
        {"title": "A", "narration": "hello world", "duration_seconds": 4},
        {"title": "B", "narration": "second scene text"},
    ])
    assert len(plan["scenes"]) == 2
    assert plan["scenes"][0]["duration_seconds"] == 4
    assert plan["scenes"][1]["duration_seconds"] > 0


def test_plan_video_needs_input():
    with pytest.raises(ValueError):
        plan_video()


def test_plan_video_arabic_narration():
    plan = plan_video(script="مرحبا بكم في جارفيس.\n\nهذا فيديو تجريبي خفيف.")
    assert len(plan["scenes"]) == 2
    assert "جارفيس" in plan["scenes"][0]["narration"]


# ---- job store ----

def test_store_create_list_and_scenes(tmp_path):
    store = VideoStore(tmp_path / "video.db")
    assert store.counts() == {"projects": 0, "scenes": 0}
    project = store.create_project("Demo", topic="space")
    assert project["status"] == "draft" and project["scenes"] == []
    scene = store.add_scene(project["id"], "Intro", "Hello there", 4.5)
    assert scene["idx"] == 0 and scene["duration_seconds"] == 4.5
    store.add_scene(project["id"], "Second", "More words here")
    fetched = store.get_project(project["id"])
    assert len(fetched["scenes"]) == 2
    assert fetched["scenes"][1]["idx"] == 1
    assert [p["scene_count"] for p in store.list_projects()] == [2]
    assert store.get_project(9999) is None


def test_store_rejects_bad_input(tmp_path):
    store = VideoStore(tmp_path / "video.db")
    with pytest.raises(ValueError):
        store.create_project("   ")
    project = store.create_project("Demo")
    with pytest.raises(ValueError):
        store.add_scene(project["id"], "X", "   ")
    with pytest.raises(ValueError):
        store.add_scene(9999, "X", "hello")
    with pytest.raises(ValueError):
        store.set_project_status(project["id"], "explode")


def test_store_status_flow(tmp_path):
    store = VideoStore(tmp_path / "video.db")
    project = store.create_project("Demo")
    updated = store.set_project_status(project["id"], "rendering")
    assert updated["status"] == "rendering"
    updated = store.set_project_status(project["id"], "done",
                                       output_path="data/video/1-Demo/draft.mp4")
    assert updated["status"] == "done"
    assert updated["output_path"].endswith("draft.mp4")


# ---- ffmpeg gate ----

class _FakeVoice:
    edge_voice = "ar-SA-HamedNeural"
    edge_rate = "-6%"
    edge_pitch = "+0Hz"


class _FakeCfg:
    def __init__(self, root: Path):
        self._root = root
        self.plugins = {}
        self.voice = _FakeVoice()

    def abs_path(self, p):
        return self._root / p


def _project_with_scenes(tmp_path):
    store = VideoStore(tmp_path / "video.db")
    project = store.create_project("Demo", topic="space")
    store.add_scene(project["id"], "Intro", "Hello there, this is a test", 4.0)
    store.add_scene(project["id"], "Outro", "Goodbye for now", 3.0)
    return store, project


def test_render_refuses_without_ffmpeg(tmp_path, monkeypatch):
    monkeypatch.setattr(assemble, "ffmpeg_available", lambda: False)
    store, project = _project_with_scenes(tmp_path)
    with pytest.raises(assemble.RenderError, match="ffmpeg"):
        asyncio.run(assemble.render_draft(project["id"], store, _FakeCfg(tmp_path)))
    assert store.get_project(project["id"])["status"] == "draft"


def test_render_refuses_empty_project(tmp_path, monkeypatch):
    monkeypatch.setattr(assemble, "ffmpeg_available", lambda: True)
    store = VideoStore(tmp_path / "video.db")
    project = store.create_project("Empty")
    with pytest.raises(assemble.RenderError, match="no scenes"):
        asyncio.run(assemble.render_draft(project["id"], store, _FakeCfg(tmp_path)))


def test_render_missing_image_fails_clearly(tmp_path, monkeypatch):
    monkeypatch.setattr(assemble, "ffmpeg_available", lambda: True)
    store = VideoStore(tmp_path / "video.db")
    project = store.create_project("Demo")
    store.add_scene(project["id"], "Pic", "Some narration", 3.0,
                    image_path=str(tmp_path / "nope.png"))
    with pytest.raises(assemble.RenderError, match="image not found"):
        asyncio.run(assemble.render_draft(project["id"], store, _FakeCfg(tmp_path)))


def test_render_with_mocked_ffmpeg_and_tts(tmp_path, monkeypatch):
    """Full happy path with ffmpeg + TTS faked: clips are 'made', concat runs."""
    monkeypatch.setattr(assemble, "ffmpeg_available", lambda: True)

    async def fake_narration(text, out_path, cfg, voice=None):
        out = Path(out_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"fake-mp3")
        return out

    monkeypatch.setattr(assemble, "synthesize_narration", fake_narration)
    monkeypatch.setattr(assemble, "_audio_duration", lambda p: None)

    def fake_run_ffmpeg(args, timeout=600):
        # The output file is always the last argument.
        Path(args[-1]).parent.mkdir(parents=True, exist_ok=True)
        Path(args[-1]).write_bytes(b"fake-mp4")

    monkeypatch.setattr(assemble, "_run_ffmpeg", fake_run_ffmpeg)

    store = VideoStore(tmp_path / "video.db")
    project = store.create_project("Demo", topic="space")
    img = tmp_path / "still.png"
    img.write_bytes(TINY_PNG)
    store.add_scene(project["id"], "Intro", "Hello there, this is a test", 4.0,
                    image_path=str(img))
    store.add_scene(project["id"], "Outro", "Goodbye for now", 3.0)

    result = asyncio.run(
        assemble.render_draft(project["id"], store, _FakeCfg(tmp_path)))
    assert result["ok"] is True
    assert result["scenes"] == 2 and result["silent_scenes"] == []
    assert result["resolution"] == "1280x720"
    assert Path(result["output"]).exists()
    assert Path(result["output"]).name == "draft.mp4"
    assert store.get_project(project["id"])["status"] == "done"
    # Intermediate per-scene clips are cleaned up; narration is kept.
    workdir = Path(result["output"]).parent
    assert not list(workdir.glob("scene_*.mp4"))
    assert list(workdir.glob("scene_*.mp3"))


def test_render_silent_when_narration_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(assemble, "ffmpeg_available", lambda: True)

    async def failing_narration(text, out_path, cfg, voice=None):
        raise assemble.RenderError("Edge-TTS narration failed: no internet")

    monkeypatch.setattr(assemble, "synthesize_narration", failing_narration)
    monkeypatch.setattr(assemble, "_audio_duration", lambda p: None)

    def fake_run_ffmpeg(args, timeout=600):
        Path(args[-1]).parent.mkdir(parents=True, exist_ok=True)
        Path(args[-1]).write_bytes(b"fake-mp4")

    monkeypatch.setattr(assemble, "_run_ffmpeg", fake_run_ffmpeg)

    store, project = _project_with_scenes(tmp_path)
    result = asyncio.run(
        assemble.render_draft(project["id"], store, _FakeCfg(tmp_path)))
    assert result["ok"] is True
    assert result["silent_scenes"] == ["Intro", "Outro"]
    assert "warning" in result
    assert store.get_project(project["id"])["status"] == "done"


# ---- plugin registration + tools ----

def _registered_registry(tmp_path):
    from jarvis.plugins.registry import PluginRegistry
    from jarvis.plugins.video.tools import register

    registry = PluginRegistry(_FakeCfg(tmp_path))
    register(registry)
    return registry


def test_plugin_registers_video_tools(tmp_path):
    registry = _registered_registry(tmp_path)
    for name in ("video_create_project", "video_add_scene",
                 "video_list_projects", "video_render_draft"):
        assert registry.get(name) is not None, name
    assert registry.get("video_list_projects").permission.name == "SAFE"
    assert registry.get("video_render_draft").permission.name == "CAUTION"
    assert registry.get("video_create_project").permission.name == "CAUTION"


def test_tools_create_add_list(tmp_path):
    registry = _registered_registry(tmp_path)
    created = json.loads(
        registry.get("video_create_project").handler(
            name="Demo", topic="space",
            script="First scene text.\n\nSecond scene text."))
    assert created["ok"] is True
    assert created["scenes_added"] == 2
    project_id = created["project"]["id"]
    added = json.loads(registry.get("video_add_scene").handler(
        project_id=project_id, narration="One more scene here"))
    assert added["ok"] is True and added["scene"]["idx"] == 2
    listed = json.loads(registry.get("video_list_projects").handler())
    assert len(listed["projects"]) == 1
    assert listed["projects"][0]["scene_count"] == 3


def test_tool_render_refuses_without_ffmpeg(tmp_path, monkeypatch):
    monkeypatch.setattr(assemble, "ffmpeg_available", lambda: False)
    registry = _registered_registry(tmp_path)
    created = json.loads(
        registry.get("video_create_project").handler(name="Demo"))
    result = json.loads(asyncio.run(
        registry.get("video_render_draft").invoke(
            {"project_id": created["project"]["id"]})))
    assert result["ok"] is False
    assert "ffmpeg" in result["error"]


def test_load_all_discovers_video(tmp_path):
    from jarvis.plugins.registry import PluginRegistry

    registry = PluginRegistry(_FakeCfg(tmp_path))
    registry.load_all()
    names = [p.name for p in registry.plugins()]
    assert "video" in names
    assert registry.get("video_render_draft") is not None


# ---- slice 2: subtitles, transitions, thumbnail ----

from jarvis.plugins.video.assemble import (  # noqa: E402
    build_xfade_filter,
    effective_transition,
)
from jarvis.plugins.video.subtitles import (  # noqa: E402
    build_srt,
    contains_arabic,
    format_srt_time,
)


def test_format_srt_time():
    assert format_srt_time(0) == "00:00:00,000"
    assert format_srt_time(61.5) == "00:01:01,500"
    assert format_srt_time(3661.234) == "01:01:01,234"
    assert format_srt_time(-3) == "00:00:00,000"


def test_contains_arabic():
    assert contains_arabic("مرحبا بكم في جارفيس")
    assert contains_arabic("hello مرحبا")
    assert not contains_arabic("hello world")
    assert not contains_arabic("")


def test_build_srt_arabic_timings():
    srt = build_srt([
        (0.0, 4.0, "مرحبا بكم في جارفيس"),
        (3.5, 6.5, "وداعا الآن"),
    ])
    assert srt.startswith("1\n00:00:00,000 --> 00:00:04,000\nمرحبا بكم في جارفيس\n")
    assert "2\n00:00:03,500 --> 00:00:06,500\nوداعا الآن" in srt


def test_build_srt_skips_empty_and_stretches_short():
    srt = build_srt([
        (0.0, 2.0, "  "),
        (2.0, 2.0, "Real line"),
        (5.0, 9.0, "Last"),
    ])
    assert "Real line" in srt and "Last" in srt
    # Empty entry skipped, numbering stays sequential; zero-length stretched.
    assert srt.startswith("1\n00:00:02,000 --> 00:00:02,500\nReal line\n")
    assert "\n2\n00:00:05,000 --> 00:00:09,000\nLast" in srt


def test_build_xfade_filter_offsets():
    filt, v_out, a_out = build_xfade_filter([4.0, 3.0, 5.0], 0.5)
    assert v_out == "vout" and a_out == "aout"
    # First join at 4.0 - 0.5; second at (4.0 + 3.0 - 0.5) - 0.5 = 6.0.
    assert "xfade=transition=fade:duration=0.500:offset=3.500" in filt
    assert "xfade=transition=fade:duration=0.500:offset=6.000" in filt
    assert filt.count("acrossfade=d=0.500") == 2
    assert filt.count("fps=30") == 3  # every input normalised


def test_build_xfade_filter_clamps_transition():
    filt, _, _ = build_xfade_filter([2.0, 2.0], 2.0)
    # 2.0s requested but half the shortest scene is 1.0s.
    assert "duration=1.000:offset=1.000" in filt
    assert effective_transition([2.0, 2.0], 2.0) == 1.0
    assert effective_transition([4.0, 3.0], 0.5) == 0.5
    assert effective_transition([4.0], 0.5) == 0.0
    assert effective_transition([4.0, 3.0], 0) == 0.0
    with pytest.raises(ValueError):
        build_xfade_filter([4.0], 0.5)


def _arabic_project(tmp_path):
    store = VideoStore(tmp_path / "video.db")
    project = store.create_project("Demo", topic="space")
    img = tmp_path / "still.png"
    img.write_bytes(TINY_PNG)
    store.add_scene(project["id"], "Intro", "مرحبا بكم في جارفيس", 4.0,
                    image_path=str(img))
    store.add_scene(project["id"], "Outro", "وداعا الآن", 3.0)
    return store, project


def _recording_fake_run_ffmpeg(calls):
    def fake_run_ffmpeg(args, timeout=600):
        calls.append(list(args))
        Path(args[-1]).parent.mkdir(parents=True, exist_ok=True)
        Path(args[-1]).write_bytes(b"fake-mp4")
    return fake_run_ffmpeg


def test_render_with_subtitles_and_transitions_mocked(tmp_path, monkeypatch):
    """Arabic script: subtitles auto-on, xfade on, SRT + mov_text + cover."""
    monkeypatch.setattr(assemble, "ffmpeg_available", lambda: True)

    async def fake_narration(text, out_path, cfg, voice=None):
        out = Path(out_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"fake-mp3")
        return out

    monkeypatch.setattr(assemble, "synthesize_narration", fake_narration)
    monkeypatch.setattr(assemble, "_audio_duration", lambda p: None)
    calls: list[list[str]] = []
    monkeypatch.setattr(assemble, "_run_ffmpeg",
                        _recording_fake_run_ffmpeg(calls))

    store, project = _arabic_project(tmp_path)
    result = asyncio.run(
        assemble.render_draft(project["id"], store, _FakeCfg(tmp_path)))

    assert result["ok"] is True
    assert result["subtitles"] is True
    assert result["transitions"] is True
    assert result["transition_seconds"] == 0.5
    # 4.0 + 3.0 - 0.5 crossfade.
    assert result["duration_seconds"] == 6.5
    # SRT sidecar: second cue starts at 3.5 (pulled earlier by the fade).
    srt_path = Path(result["subtitle_path"])
    assert srt_path.name == "draft.srt" and srt_path.exists()
    srt = srt_path.read_text(encoding="utf-8")
    assert "00:00:00,000 --> 00:00:04,000" in srt
    assert "00:00:03,500 --> 00:00:06,500" in srt
    assert "مرحبا بكم في جارفيس" in srt
    # The xfade filter and the mov_text mux both ran.
    joined = "\n".join(" ".join(c) for c in calls)
    assert "xfade=transition=fade" in joined
    assert "mov_text" in joined
    # Thumbnail from the middle of the first scene.
    assert Path(result["thumbnail_path"]).name == "cover.jpg"
    assert Path(result["thumbnail_path"]).exists()
    assert store.get_project(project["id"])["status"] == "done"


def test_render_transitions_off_uses_concat(tmp_path, monkeypatch):
    monkeypatch.setattr(assemble, "ffmpeg_available", lambda: True)

    async def fake_narration(text, out_path, cfg, voice=None):
        out = Path(out_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"fake-mp3")
        return out

    monkeypatch.setattr(assemble, "synthesize_narration", fake_narration)
    monkeypatch.setattr(assemble, "_audio_duration", lambda p: None)
    calls: list[list[str]] = []
    monkeypatch.setattr(assemble, "_run_ffmpeg",
                        _recording_fake_run_ffmpeg(calls))

    store, project = _project_with_scenes(tmp_path)
    result = asyncio.run(assemble.render_draft(
        project["id"], store, _FakeCfg(tmp_path), transitions=False))

    assert result["ok"] is True
    assert result["transitions"] is False
    assert result["duration_seconds"] == 7.0  # 4.0 + 3.0, no fade overlap
    assert result["subtitles"] is False  # English narration: auto-off
    assert result["subtitle_path"] == ""
    joined = "\n".join(" ".join(c) for c in calls)
    assert "xfade" not in joined and "mov_text" not in joined
    assert "concat" in joined  # the old stream-copy path
    assert Path(result["thumbnail_path"]).exists()


def test_render_subtitles_off_no_srt(tmp_path, monkeypatch):
    monkeypatch.setattr(assemble, "ffmpeg_available", lambda: True)

    async def fake_narration(text, out_path, cfg, voice=None):
        out = Path(out_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"fake-mp3")
        return out

    monkeypatch.setattr(assemble, "synthesize_narration", fake_narration)
    monkeypatch.setattr(assemble, "_audio_duration", lambda p: None)
    calls: list[list[str]] = []
    monkeypatch.setattr(assemble, "_run_ffmpeg",
                        _recording_fake_run_ffmpeg(calls))

    store, project = _arabic_project(tmp_path)
    result = asyncio.run(assemble.render_draft(
        project["id"], store, _FakeCfg(tmp_path), subtitles=False))

    assert result["ok"] is True
    assert result["subtitles"] is False
    assert result["subtitle_path"] == ""
    assert not list(Path(result["output"]).parent.glob("*.srt"))
    joined = "\n".join(" ".join(c) for c in calls)
    assert "mov_text" not in joined
    assert "xfade" in joined  # transitions still on by default


@pytest.mark.skipif(not assemble.ffmpeg_available(),
                    reason="ffmpeg not installed")
def test_render_real_e2e_slice2(tmp_path, monkeypatch):
    """Real ffmpeg end-to-end: 2 silent scenes, xfade + SRT + cover.jpg.

    Narration is forced to fail (no network in tests) so the scenes
    render silent; the SRT is still built from the narration text.
    """
    import subprocess

    async def failing_narration(text, out_path, cfg, voice=None):
        raise assemble.RenderError("Edge-TTS narration failed: no internet")

    monkeypatch.setattr(assemble, "synthesize_narration", failing_narration)

    store = VideoStore(tmp_path / "video.db")
    project = store.create_project("Demo", topic="space")
    img = tmp_path / "still.png"
    img.write_bytes(TINY_PNG)
    store.add_scene(project["id"], "Intro", "مرحبا بكم في جارفيس", 2.0,
                    image_path=str(img))
    store.add_scene(project["id"], "Outro", "وداعا الآن", 2.0)

    result = asyncio.run(
        assemble.render_draft(project["id"], store, _FakeCfg(tmp_path)))

    assert result["ok"] is True
    assert result["silent_scenes"] == ["Intro", "Outro"]
    assert result["subtitles"] is True and result["transitions"] is True
    assert result["duration_seconds"] == pytest.approx(3.5, abs=0.3)
    out = Path(result["output"])
    assert out.exists() and out.stat().st_size > 0
    srt = Path(result["subtitle_path"])
    assert srt.exists()
    assert "مرحبا بكم في جارفيس" in srt.read_text(encoding="utf-8")
    cover = Path(result["thumbnail_path"])
    assert cover.exists() and cover.read_bytes()[:2] == b"\xff\xd8"
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,codec_name", "-of", "csv=p=0", str(out)],
        capture_output=True, text=True, timeout=30)
    assert "subtitle" in probe.stdout and "mov_text" in probe.stdout
