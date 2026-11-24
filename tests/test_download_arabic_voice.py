"""Unit tests for scripts/download_arabic_voice.py.

Everything is mocked: no network, no real model files. The downloader
is loaded from its file path (``scripts/`` is not a package), and
``urllib.request.urlopen`` is replaced with a fake that serves
in-memory payloads.

Covered:
- skip-if-present (no network call when valid files exist)
- --force re-downloads existing files
- downloads land with the right content, atomically (no partial file
  on failure)
- Content-Length mismatch / undersized model / invalid JSON config /
  network errors are all reported, not silently accepted
- importing the script downloads nothing
- the printed config lines point Piper at the Arabic model and never
  touch the Edge default voice
"""

import importlib.util
import io
import json
import urllib.error
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "scripts" / "download_arabic_voice.py"


def _load_script():
    spec = importlib.util.spec_from_file_location(
        "download_arabic_voice", SCRIPT_PATH
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


dav = _load_script()

VALID_CONFIG = json.dumps(
    {
        "audio": {"sample_rate": 22050},
        "espeak": {"voice": "ar"},
        "language": {"code": "ar"},
    }
).encode("utf-8")
MODEL_PAYLOAD = b"O" * (dav.MIN_MODEL_SIZE + 123)


class _FakeResponse:
    """Minimal urllib response: read() + headers.get('Content-Length')."""

    def __init__(self, payload: bytes, content_length=None):
        self._buf = io.BytesIO(payload)
        length = (
            len(payload) if content_length is None else content_length
        )
        self.headers = {"Content-Length": str(length)}

    def read(self, size=-1):
        return self._buf.read(size)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _fake_urlopen_factory(payloads, calls):
    def _fake_urlopen(request, timeout=None):
        url = request.full_url if hasattr(request, "full_url") else str(request)
        calls.append(url)
        return _FakeResponse(payloads[url])

    return _fake_urlopen


def _valid_files(tmp_path):
    """Write already-valid model + config files; return their paths."""
    model = tmp_path / dav.MODEL_FILENAME
    config = tmp_path / dav.CONFIG_FILENAME
    model.write_bytes(MODEL_PAYLOAD)
    config.write_bytes(VALID_CONFIG)
    return model, config


def test_import_downloads_nothing(monkeypatch):
    """Importing the script must not touch the network."""
    calls = []

    def _boom(*args, **kwargs):
        calls.append(args)
        raise AssertionError("network used at import time")

    monkeypatch.setattr("urllib.request.urlopen", _boom)
    module = _load_script()
    assert module.VOICE_ID == "ar_JO-kareem-medium"
    assert calls == []


def test_skips_valid_files_already_present(monkeypatch, tmp_path):
    _valid_files(tmp_path)
    calls = []
    monkeypatch.setattr(
        "urllib.request.urlopen", _fake_urlopen_factory({}, calls)
    )
    results = dav.ensure_voice(tmp_path)
    assert results["model"]["status"] == "skipped"
    assert results["config"]["status"] == "skipped"
    assert calls == []  # no network at all


def test_downloads_missing_files(monkeypatch, tmp_path):
    calls = []
    payloads = {dav.MODEL_URL: MODEL_PAYLOAD, dav.CONFIG_URL: VALID_CONFIG}
    monkeypatch.setattr(
        "urllib.request.urlopen", _fake_urlopen_factory(payloads, calls)
    )
    results = dav.ensure_voice(tmp_path)
    assert results["model"]["status"] == "downloaded"
    assert results["config"]["status"] == "downloaded"
    assert (tmp_path / dav.MODEL_FILENAME).read_bytes() == MODEL_PAYLOAD
    assert (tmp_path / dav.CONFIG_FILENAME).read_bytes() == VALID_CONFIG
    assert set(calls) == {dav.MODEL_URL, dav.CONFIG_URL}


def test_force_redownloads_existing_files(monkeypatch, tmp_path):
    _valid_files(tmp_path)
    calls = []
    payloads = {dav.MODEL_URL: MODEL_PAYLOAD, dav.CONFIG_URL: VALID_CONFIG}
    monkeypatch.setattr(
        "urllib.request.urlopen", _fake_urlopen_factory(payloads, calls)
    )
    results = dav.ensure_voice(tmp_path, force=True)
    assert results["model"]["status"] == "downloaded"
    assert results["config"]["status"] == "downloaded"
    assert len(calls) == 2


def test_size_mismatch_removes_partial_file(monkeypatch, tmp_path):
    """Server says N bytes but sends fewer: fail, leave nothing."""
    calls = []

    def _short(request, timeout=None):
        calls.append(request.full_url)
        # Header promises the full payload; body is cut short.
        return _FakeResponse(MODEL_PAYLOAD[:100], len(MODEL_PAYLOAD))

    monkeypatch.setattr("urllib.request.urlopen", _short)
    with pytest.raises(dav.DownloadError, match="size mismatch"):
        dav._download(dav.MODEL_URL, tmp_path / dav.MODEL_FILENAME)
    assert not (tmp_path / dav.MODEL_FILENAME).exists()
    assert list(tmp_path.iterdir()) == []  # no temp file left behind


def test_tiny_model_is_rejected(monkeypatch, tmp_path):
    payloads = {dav.MODEL_URL: b"tiny", dav.CONFIG_URL: VALID_CONFIG}
    monkeypatch.setattr(
        "urllib.request.urlopen",
        _fake_urlopen_factory(payloads, []),
    )
    results = dav.ensure_voice(tmp_path)
    assert results["model"]["status"] == "failed"
    assert "smaller than any real Piper model" in results["model"]["error"]
    assert not (tmp_path / dav.MODEL_FILENAME).exists()
    # The config is independent and still downloads fine.
    assert results["config"]["status"] == "downloaded"


def test_invalid_json_config_is_rejected(monkeypatch, tmp_path):
    payloads = {dav.MODEL_URL: MODEL_PAYLOAD, dav.CONFIG_URL: b"not json"}
    monkeypatch.setattr(
        "urllib.request.urlopen",
        _fake_urlopen_factory(payloads, []),
    )
    results = dav.ensure_voice(tmp_path)
    assert results["model"]["status"] == "downloaded"
    assert results["config"]["status"] == "failed"
    assert "not a valid Piper voice config" in results["config"]["error"]
    assert not (tmp_path / dav.CONFIG_FILENAME).exists()


def test_network_error_is_reported_not_silent(monkeypatch, tmp_path):
    def _down(request, timeout=None):
        raise urllib.error.URLError("no route to host")

    monkeypatch.setattr("urllib.request.urlopen", _down)
    results = dav.ensure_voice(tmp_path)
    assert results["model"]["status"] == "failed"
    assert results["config"]["status"] == "failed"
    assert "no route to host" in results["model"]["error"]
    assert list(tmp_path.iterdir()) == []


def test_config_lines_point_at_arabic_model():
    lines = dav.config_lines(dav.default_voices_dir())
    assert "provider: piper" in lines
    assert "piper_model: data/voices/ar_JO-kareem-medium.onnx" in lines
    # The Edge default voice is never changed by this script.
    assert "edge_voice" not in lines
    assert "HamedNeural" not in lines


def test_main_help_exits_zero(capsys):
    with pytest.raises(SystemExit) as exc:
        dav.main(["--help"])
    assert exc.value.code == 0
    assert "ar_JO-kareem-medium" in capsys.readouterr().out


def test_main_downloads_and_prints_config(monkeypatch, tmp_path, capsys):
    payloads = {dav.MODEL_URL: MODEL_PAYLOAD, dav.CONFIG_URL: VALID_CONFIG}
    monkeypatch.setattr(
        "urllib.request.urlopen",
        _fake_urlopen_factory(payloads, []),
    )
    assert dav.main(["--voices-dir", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    # With a custom --voices-dir the printed path is that directory.
    assert f"piper_model: {tmp_path}/ar_JO-kareem-medium.onnx" in out
    assert (tmp_path / dav.MODEL_FILENAME).exists()


def test_main_returns_nonzero_on_failure(monkeypatch, tmp_path):
    def _down(request, timeout=None):
        raise urllib.error.URLError("offline")

    monkeypatch.setattr("urllib.request.urlopen", _down)
    assert dav.main(["--voices-dir", str(tmp_path), "--quiet"]) == 1
