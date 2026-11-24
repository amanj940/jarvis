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
