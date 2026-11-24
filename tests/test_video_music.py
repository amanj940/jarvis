"""Unit tests for video slice 3 — background music with ducking.

No network, no keys, no real TTS. ffmpeg is mocked except for the one
real end-to-end test (skipped when ffmpeg is missing). The tests cover
the music config defaults, the ducking filter graph, the mix command
shape, and the render integration: no music configured means the
render pipeline is exactly as before, music on means one extra mix
pass, and a missing/broken music file only warns.
"""
from __future__ import annotations

import asyncio
import base64
import re
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarvis.plugins.video import assemble  # noqa: E402
from jarvis.plugins.video.store import VideoStore  # noqa: E402

# A 1x1 black PNG, base64 — no PIL needed to make a real image file.
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


class _FakeVoice:
    edge_voice = "ar-SA-HamedNeural"
    edge_rate = "-6%"
    edge_pitch = "+0Hz"


class _FakeMusic:
    def __init__(self, enabled=False, volume=None, path=None):
        self.enabled = enabled
        self.volume = volume
        self.path = path


class _FakeVideoCfg:
    def __init__(self, music=None):
        self.music = music


class _FakeCfg:
    """Config fake with an optional ``video.music`` section."""

    def __init__(self, root: Path, music=None):
        self._root = root
        self.plugins = {}
        self.voice = _FakeVoice()
        self.video = _FakeVideoCfg(music)

    def abs_path(self, p):
        return self._root / p


class _FakeCfgNoVideo:
    """Config fake with no ``video`` section at all (old configs)."""

    def __init__(self, root: Path):
        self._root = root
        self.plugins = {}
        self.voice = _FakeVoice()

    def abs_path(self, p):
        return self._root / p


def _project_with_scenes(tmp_path, arabic=False):
    store = VideoStore(tmp_path / "video.db")
    project = store.create_project("Demo", topic="space")
    if arabic:
        store.add_scene(project["id"], "Intro", "مرحبا بكم في جارفيس", 4.0)
        store.add_scene(project["id"], "Outro", "وداعا الآن", 3.0)
    else:
        store.add_scene(project["id"], "Intro", "Hello there, this is a test", 4.0)
        store.add_scene(project["id"], "Outro", "Goodbye for now", 3.0)
    return store, project


def _recording_fake_run_ffmpeg(calls):
    def fake_run_ffmpeg(args, timeout=600):
        calls.append(list(args))
        Path(args[-1]).parent.mkdir(parents=True, exist_ok=True)
        Path(args[-1]).write_bytes(b"fake-mp4")
    return fake_run_ffmpeg


async def _fake_narration(text, out_path, cfg, voice=None):
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(b"fake-mp3")
    return out


# ---- config defaults ----

def test_music_settings_defaults_no_video_section(tmp_path):
    enabled, volume, path = assemble._music_settings(_FakeCfgNoVideo(tmp_path))
    assert enabled is False
    assert volume == assemble.DEFAULT_MUSIC_VOLUME == 0.15
    assert path is None


def test_music_settings_defaults_music_absent(tmp_path):
    enabled, volume, path = assemble._music_settings(_FakeCfg(tmp_path))
    assert (enabled, volume, path) == (False, 0.15, None)


def test_music_settings_from_config(tmp_path):
    music = _FakeMusic(enabled=True, volume=0.3, path="data/music/bg.mp3")
    enabled, volume, path = assemble._music_settings(_FakeCfg(tmp_path, music))
    assert enabled is True
    assert volume == pytest.approx(0.3)
    assert path == "data/music/bg.mp3"


def test_music_settings_clamps_volume(tmp_path):
    music = _FakeMusic(enabled=True, volume=2.5, path="x.mp3")
    assert assemble._music_settings(_FakeCfg(tmp_path, music))[1] == 1.0
    music = _FakeMusic(enabled=True, volume=-0.5, path="x.mp3")
    assert assemble._music_settings(_FakeCfg(tmp_path, music))[1] == 0.0
    music = _FakeMusic(enabled=True, volume="loud", path="x.mp3")
    assert assemble._music_settings(
        _FakeCfg(tmp_path, music))[1] == assemble.DEFAULT_MUSIC_VOLUME


def test_music_settings_blank_path_is_none(tmp_path):
    music = _FakeMusic(enabled=True, volume=0.2, path="   ")
    enabled, volume, path = assemble._music_settings(_FakeCfg(tmp_path, music))
    assert enabled is True and path is None


# ---- ducking filter graph ----

def test_build_music_mix_filter_ducking():
    filt = assemble.build_music_mix_filter(0.3)
    # Narration split: one copy stays, one drives the sidechain.
    assert filt.startswith("[0:a]asplit=2[narr][side]")
    assert "[1:a]volume=0.300[m]" in filt
    # The music is compressed by the narration, not the other way round.
    assert "[m][side]sidechaincompress=" in filt
    assert "threshold=0.03" in filt
    assert "ratio=8.0" in filt
    assert "attack=50" in filt
    assert "release=500" in filt
    assert "[ducked]" in filt
    # Mix ends at the narration's length, no re-balancing of levels.
    assert filt.endswith("[narr][ducked]amix=inputs=2:duration=first:normalize=0[aout]")


def test_build_music_mix_filter_default_volume_and_clamp():
    assert "volume=0.150" in assemble.build_music_mix_filter()
    assert "volume=1.000" in assemble.build_music_mix_filter(5.0)
    assert "volume=0.000" in assemble.build_music_mix_filter(-1.0)


# ---- mix_music command ----

def test_mix_music_missing_file_raises(tmp_path, monkeypatch):
    def must_not_run(args, timeout=600):
        raise AssertionError("ffmpeg must not run for a missing music file")

    monkeypatch.setattr(assemble, "_run_ffmpeg", must_not_run)
    with pytest.raises(assemble.RenderError, match="music file not found"):
        assemble.mix_music(tmp_path / "draft.mp4", tmp_path / "nope.mp3",
                           tmp_path / "out.mp4")


def test_mix_music_command_shape(tmp_path, monkeypatch):
    music = tmp_path / "bg.mp3"
    music.write_bytes(b"fake-mp3")
    calls: list[list[str]] = []
    monkeypatch.setattr(assemble, "_run_ffmpeg",
                        _recording_fake_run_ffmpeg(calls))
    out = assemble.mix_music(tmp_path / "draft.mp4", music,
                             tmp_path / "mixed.mp4", music_volume=0.25)
    assert out.exists() and out.name == "mixed.mp4"
    assert len(calls) == 1
    cmd = calls[0]
    # Music input is looped to cover the whole video.
    assert "-stream_loop" in cmd and "-1" in cmd
    assert str(music) in cmd
    filt = cmd[cmd.index("-filter_complex") + 1]
    assert "sidechaincompress" in filt and "volume=0.250" in filt
    # Video copied, audio re-encoded, mix stops at the video's length.
    assert cmd[cmd.index("-map") + 1] == "0:v"
    assert "[aout]" in cmd
    assert "-c:v" in cmd and "copy" in cmd[cmd.index("-c:v") + 1]
    assert "-shortest" in cmd
    assert cmd[-1] == str(out)


# ---- render integration (mocked ffmpeg) ----

def _render_mocked(tmp_path, monkeypatch, cfg, arabic=False):
    monkeypatch.setattr(assemble, "ffmpeg_available", lambda: True)
    monkeypatch.setattr(assemble, "synthesize_narration", _fake_narration)
    monkeypatch.setattr(assemble, "_audio_duration", lambda p: None)
    calls: list[list[str]] = []
    monkeypatch.setattr(assemble, "_run_ffmpeg",
                        _recording_fake_run_ffmpeg(calls))
    store, project = _project_with_scenes(tmp_path, arabic=arabic)
    result = asyncio.run(
        assemble.render_draft(project["id"], store, cfg))
    return result, calls, store


def test_render_no_music_is_unchanged(tmp_path, monkeypatch):
    """Default config: no extra pass, no behaviour change at all."""
    result, calls, store = _render_mocked(
        tmp_path, monkeypatch, _FakeCfgNoVideo(tmp_path))
    assert result["ok"] is True
    assert result["music"] is False
    assert result["music_path"] == ""
    assert result["music_volume"] == assemble.DEFAULT_MUSIC_VOLUME
    joined = "\n".join(" ".join(c) for c in calls)
    assert "sidechaincompress" not in joined
    assert "stream_loop" not in joined
    assert "draft_music" not in joined
    assert store.get_project(result["project_id"])["status"] == "done"


def test_render_with_music_mixes_between_assembly_and_subtitles(
        tmp_path, monkeypatch):
    """Music on: one mix pass after the xfade, before the subtitle mux."""
    music = tmp_path / "bg.mp3"
    music.write_bytes(b"fake-mp3")
    cfg = _FakeCfg(tmp_path, _FakeMusic(enabled=True, volume=0.2,
                                        path=str(music)))
    result, calls, _ = _render_mocked(tmp_path, monkeypatch, cfg, arabic=True)
    assert result["ok"] is True
    assert result["music"] is True
    assert result["music_path"] == str(music)
    assert result["music_volume"] == pytest.approx(0.2)
    assert result["subtitles"] is True  # Arabic: subtitles still work
    joined = "\n".join(" ".join(c) for c in calls)
    assert "sidechaincompress" in joined
    mix_idx = next(i for i, c in enumerate(calls)
                   if "sidechaincompress" in " ".join(c))
    xfade_idx = next(i for i, c in enumerate(calls)
                     if "xfade=transition=fade" in " ".join(c))
    mux_idx = next(i for i, c in enumerate(calls)
                   if "mov_text" in " ".join(c))
    assert xfade_idx < mix_idx < mux_idx
    # The mixed file replaced the draft; no leftover temp file.
    workdir = Path(result["output"]).parent
    assert not list(workdir.glob("draft_music.mp4"))
    assert Path(result["output"]).exists()


def test_render_music_missing_file_warns_but_finishes(tmp_path, monkeypatch):
    cfg = _FakeCfg(tmp_path, _FakeMusic(
        enabled=True, volume=0.2, path=str(tmp_path / "nope.mp3")))
    result, calls, store = _render_mocked(tmp_path, monkeypatch, cfg)
    assert result["ok"] is True
    assert result["music"] is False
    assert "Music" in result.get("warning", "")
    joined = "\n".join(" ".join(c) for c in calls)
    assert "sidechaincompress" not in joined
    assert store.get_project(result["project_id"])["status"] == "done"


def test_render_music_enabled_without_path_warns(tmp_path, monkeypatch):
    cfg = _FakeCfg(tmp_path, _FakeMusic(enabled=True, volume=0.2, path=None))
    result, calls, _ = _render_mocked(tmp_path, monkeypatch, cfg)
    assert result["ok"] is True
    assert result["music"] is False
    assert "Music" in result.get("warning", "")
    joined = "\n".join(" ".join(c) for c in calls)
    assert "sidechaincompress" not in joined


def test_render_music_mix_failure_warns_but_finishes(tmp_path, monkeypatch):
    music = tmp_path / "bg.mp3"
    music.write_bytes(b"fake-mp3")
    cfg = _FakeCfg(tmp_path, _FakeMusic(enabled=True, volume=0.2,
                                        path=str(music)))
    monkeypatch.setattr(assemble, "ffmpeg_available", lambda: True)
    monkeypatch.setattr(assemble, "synthesize_narration", _fake_narration)
    monkeypatch.setattr(assemble, "_audio_duration", lambda p: None)
    calls: list[list[str]] = []
    monkeypatch.setattr(assemble, "_run_ffmpeg",
                        _recording_fake_run_ffmpeg(calls))

    def failing_mix(*args, **kwargs):
        raise assemble.RenderError("ffmpeg failed: corrupt music file")

    monkeypatch.setattr(assemble, "mix_music", failing_mix)
    store, project = _project_with_scenes(tmp_path)
    result = asyncio.run(
        assemble.render_draft(project["id"], store, cfg))
    assert result["ok"] is True
    assert result["music"] is False
    assert "Music" in result.get("warning", "")
    assert store.get_project(project["id"])["status"] == "done"


# ---- real ffmpeg end-to-end with music ----

@pytest.mark.skipif(not assemble.ffmpeg_available(),
                    reason="ffmpeg not installed")
def test_render_real_e2e_with_music(tmp_path, monkeypatch):
    """Real ffmpeg: 2 silent scenes + a sine-tone music track.

    Narration is forced to fail (no network in tests) so the scenes
    render silent; the music must still be audible in the final mix.
    """
    music = tmp_path / "bg.mp3"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=10",
         "-c:a", "libmp3lame", "-q:a", "4", str(music)],
        check=True, capture_output=True, timeout=60)

    async def failing_narration(text, out_path, cfg, voice=None):
        raise assemble.RenderError("Edge-TTS narration failed: no internet")

    monkeypatch.setattr(assemble, "synthesize_narration", failing_narration)
    cfg = _FakeCfg(tmp_path, _FakeMusic(enabled=True, volume=0.3,
                                        path=str(music)))
    store = VideoStore(tmp_path / "video.db")
    project = store.create_project("Demo", topic="space")
    img = tmp_path / "still.png"
    img.write_bytes(TINY_PNG)
    store.add_scene(project["id"], "Intro", "مرحبا بكم في جارفيس", 2.0,
                    image_path=str(img))
    store.add_scene(project["id"], "Outro", "وداعا الآن", 2.0)

    result = asyncio.run(
        assemble.render_draft(project["id"], store, cfg))

    assert result["ok"] is True
    assert result["music"] is True
    assert result["silent_scenes"] == ["Intro", "Outro"]
    assert result["duration_seconds"] == pytest.approx(3.5, abs=0.3)
    out = Path(result["output"])
    assert out.exists() and out.stat().st_size > 0
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,codec_name", "-of", "csv=p=0", str(out)],
        capture_output=True, text=True, timeout=30)
    assert "video" in probe.stdout and "h264" in probe.stdout
    assert "audio" in probe.stdout and "aac" in probe.stdout
    # The music must actually be audible in the mix (not silence).
    vol = subprocess.run(
        ["ffmpeg", "-i", str(out), "-af", "volumedetect",
         "-f", "null", "-"],
        capture_output=True, text=True, timeout=60)
    m = re.search(r"mean_volume:\s*(-?[0-9.]+|-\s*inf)", vol.stderr)
    assert m is not None, vol.stderr[-500:]
    assert m.group(1).strip() != "-inf"
    assert float(m.group(1)) > -60.0
