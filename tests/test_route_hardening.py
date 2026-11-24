"""Route hardening tests (worker L) — no network, no keys, no live server.

Covers:
  * SSRF mitigation on /proxy + /reader (localhost / private / link-local /
    cloud-metadata blocked, public URL allowed with a mocked fetch,
    redirect-to-private blocked, oversized response rejected).
  * POST /cleanslate requires {"confirm": true, "confirmation": "CLEAN SLATE"}.
  * /persona + /mission persist to data/system_state.json and survive a
    simulated restart (fresh config object, same data dir).
  * POST /stt rejects uploads over 25 MB with 413 (Content-Length gate
    and chunked-read gate), without calling Whisper.
"""
from __future__ import annotations

import asyncio
import io
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, Request, UploadFile  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from jarvis.server.routes import system as system_routes  # noqa: E402

try:
    from jarvis.server.routes import voice as voice_routes  # noqa: E402
except Exception:  # noqa: BLE001 - heavy model deps may be absent in minimal envs
    voice_routes = None

PUBLIC_IP = "93.184.216.34"  # example.com (documentation range stand-in)


# ---------------------------------------------------------------- fakes
class _FakeCfg:
    """Minimal config stand-in: only what system/voice routes touch."""

    def __init__(self, root: Path):
        self._root = root
        self.A = SimpleNamespace(
            persona="You are JARVIS, a calm, precise, proactive local AI assistant.",
            name="JARVIS",
        )
        self.mission = SimpleNamespace(enabled=False, project_path="")
        self.voice = SimpleNamespace(stt_language="ar")

    def abs_path(self, rel):
        return self._root / rel


class _FakeOrch:
    def __init__(self):
        self.resets = 0
        self.voice_state = None

    def reset(self):
        self.resets += 1


class _FakeMemory:
    def __init__(self):
        self.paths = {}

    def set_path(self, key, value, kind):
        self.paths[key] = (value, kind)


def _make_system_client(tmp_path, monkeypatch):
    cfg = _FakeCfg(tmp_path)
    orch = _FakeOrch()
    memory = _FakeMemory()
    monkeypatch.setattr(
        system_routes, "_services",
        lambda req: (cfg, orch, None, memory, None),
    )
    app = FastAPI()
    app.include_router(system_routes.router)
    return TestClient(app, raise_server_exceptions=False), cfg, orch, memory


def _public_resolver(host, port):
    return [PUBLIC_IP]


# ---------------------------------------------------------------- SSRF: validate_public_url
@pytest.mark.parametrize("url", [
    "http://localhost/admin",
    "http://localhost:7341/api/health",
    "http://127.0.0.1/",
    "http://127.0.0.1:8000/x",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.0.9/",
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.170.2/v2/metadata",
    "http://100.100.100.200/",
    "http://metadata.google.internal/",
    "http://metadata/",
    "ftp://example.com/file",
    "http://user:pass@example.com/",
    "http://[::1]/",
    "http://[fd00:ec2::254]/",
])
def test_validate_blocks_private_and_metadata(url):
    with pytest.raises(system_routes._UnsafeURL):
        system_routes.validate_public_url(url, _resolve=_public_resolver)


def test_validate_blocks_dns_resolving_to_private():
    def _evil_resolver(host, port):
        return ["10.1.2.3"]

    with pytest.raises(system_routes._UnsafeURL):
        system_routes.validate_public_url(
            "http://evil.example.com/", _resolve=_evil_resolver)


def test_validate_allows_public_url():
    assert system_routes.validate_public_url(
        "https://example.com/page", _resolve=_public_resolver
    ) == "https://example.com/page"
    # scheme auto-prefix preserved from the original proxy behaviour
    assert system_routes.validate_public_url(
        "example.com/page", _resolve=_public_resolver
    ) == "https://example.com/page"


# ---------------------------------------------------------------- SSRF: /proxy + /reader
def test_proxy_blocks_localhost_without_fetching(tmp_path, monkeypatch):
    client, *_ = _make_system_client(tmp_path, monkeypatch)
    calls = []
    monkeypatch.setattr(system_routes, "_resolve_host", _public_resolver)

    async def _never_called(url, **kw):
        calls.append(url)
        raise AssertionError("fetch must not run for a blocked URL")

    monkeypatch.setattr(system_routes, "_fetch_public", _never_called)
    r = client.get("/proxy", params={"url": "http://127.0.0.1:7341/api/health"})
    assert r.status_code == 403
    assert r.json()["code"] == "ssrf_blocked"
    assert calls == []


def test_proxy_blocks_metadata_without_fetching(tmp_path, monkeypatch):
    client, *_ = _make_system_client(tmp_path, monkeypatch)
    monkeypatch.setattr(system_routes, "_resolve_host", _public_resolver)
    r = client.get("/proxy", params={"url": "http://169.254.169.254/latest/meta-data/"})
    assert r.status_code == 403
    assert r.json()["code"] == "ssrf_blocked"


def test_proxy_allows_public_url_with_mocked_fetch(tmp_path, monkeypatch):
    client, *_ = _make_system_client(tmp_path, monkeypatch)
    monkeypatch.setattr(system_routes, "_resolve_host", _public_resolver)

    async def _fake_fetch(url, **kw):
        return system_routes._FetchResult(
            "https://example.com/page", 200,
            {"content-type": "text/html; charset=utf-8"},
            b"<html><head><title>t</title></head><body>hi</body></html>",
        )

    monkeypatch.setattr(system_routes, "_fetch_public", _fake_fetch)
    r = client.get("/proxy", params={"url": "https://example.com/page"})
    assert r.status_code == 200
    assert '<base href="https://example.com/">' in r.text
    assert "hi" in r.text


def test_proxy_rejects_bad_scheme(tmp_path, monkeypatch):
    client, *_ = _make_system_client(tmp_path, monkeypatch)
    r = client.get("/proxy", params={"url": "ftp://example.com/file"})
    assert r.status_code in (400, 403)
    assert r.json()["code"] in ("bad_url", "ssrf_blocked")


def test_reader_blocks_private_url(tmp_path, monkeypatch):
    client, *_ = _make_system_client(tmp_path, monkeypatch)
    monkeypatch.setattr(system_routes, "_resolve_host", _public_resolver)
    r = client.get("/reader", params={"url": "http://10.0.0.5/secret"})
    assert r.status_code == 403
    assert r.json()["code"] == "ssrf_blocked"


def test_reader_allows_public_url_with_mocked_fetch(tmp_path, monkeypatch):
    client, *_ = _make_system_client(tmp_path, monkeypatch)
    monkeypatch.setattr(system_routes, "_resolve_host", _public_resolver)

    async def _fake_fetch(url, **kw):
        return system_routes._FetchResult(
            "https://example.com/article", 200,
            {"content-type": "text/html"},
            b"<html><head><title>Example Article</title></head>"
            b"<body><p>Some readable article text here.</p></body></html>",
        )

    monkeypatch.setattr(system_routes, "_fetch_public", _fake_fetch)
    r = client.get("/reader", params={"url": "https://example.com/article"})
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["url"] == "https://example.com/article"


# --- _fetch_public internals: redirect-to-private + size cap (fake httpx) --
class _FakeStreamResponse:
    def __init__(self, status, headers, body=b""):
        self.status_code = status
        self.headers = headers
        self._body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def aiter_bytes(self, chunk_size=65536):
        for i in range(0, len(self._body), chunk_size):
            yield self._body[i:i + chunk_size]


class _FakeAsyncClient:
    """httpx.AsyncClient stand-in returning one canned streamed response."""

    response = None  # set per-test: _FakeStreamResponse

    def __init__(self, *a, **kw):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def stream(self, method, url):
        return self.response


def test_fetch_public_blocks_redirect_to_private(tmp_path, monkeypatch):
    monkeypatch.setattr(system_routes, "_resolve_host", _public_resolver)
    _FakeAsyncClient.response = _FakeStreamResponse(
        302, {"location": "http://127.0.0.1:7341/api/health"})
    monkeypatch.setattr(system_routes.httpx, "AsyncClient", _FakeAsyncClient)
    with pytest.raises(system_routes._UnsafeURL):
        asyncio.run(system_routes._fetch_public("https://example.com/ok"))


def test_fetch_public_rejects_oversized_response(tmp_path, monkeypatch):
    monkeypatch.setattr(system_routes, "_resolve_host", _public_resolver)
    _FakeAsyncClient.response = _FakeStreamResponse(
        200, {"content-type": "text/html"}, body=b"x" * (system_routes._FETCH_MAX_BYTES + 1))
    monkeypatch.setattr(system_routes.httpx, "AsyncClient", _FakeAsyncClient)
    with pytest.raises(system_routes._ResponseTooLarge):
        asyncio.run(system_routes._fetch_public("https://example.com/big"))


def test_fetch_public_allows_small_response(tmp_path, monkeypatch):
    monkeypatch.setattr(system_routes, "_resolve_host", _public_resolver)
    _FakeAsyncClient.response = _FakeStreamResponse(
        200, {"content-type": "text/html"}, body=b"<html>ok</html>")
    monkeypatch.setattr(system_routes.httpx, "AsyncClient", _FakeAsyncClient)
    result = asyncio.run(system_routes._fetch_public("https://example.com/ok"))
    assert result.status_code == 200
    assert result.body == b"<html>ok</html>"


# ---------------------------------------------------------------- cleanslate
@pytest.mark.parametrize("body", [
    {},
    {"confirm": False, "confirmation": "CLEAN SLATE"},
    {"confirm": True},
    {"confirm": True, "confirmation": ""},
    {"confirm": True, "confirmation": "clean slate"},
    {"confirm": True, "confirmation": "DELETE EVERYTHING"},
])
def test_cleanslate_rejects_without_exact_confirm(tmp_path, monkeypatch, body):
    client, _, orch, _ = _make_system_client(tmp_path, monkeypatch)
    r = client.post("/cleanslate", json=body)
    assert r.status_code == 400
    assert r.json()["code"] == "confirmation_required"
    assert orch.resets == 0


def test_cleanslate_rejects_string_confirm(tmp_path, monkeypatch):
    # StrictBool: "yes" must not coerce to True (Pydantic plain bool would).
    client, _, orch, _ = _make_system_client(tmp_path, monkeypatch)
    r = client.post("/cleanslate",
                    json={"confirm": "yes", "confirmation": "CLEAN SLATE"})
    assert r.status_code == 422
    assert orch.resets == 0


def test_cleanslate_rejects_missing_body(tmp_path, monkeypatch):
    client, _, orch, _ = _make_system_client(tmp_path, monkeypatch)
    r = client.post("/cleanslate")
    assert r.status_code in (400, 422)
    assert orch.resets == 0


def test_cleanslate_works_with_exact_confirm(tmp_path, monkeypatch):
    client, _, orch, _ = _make_system_client(tmp_path, monkeypatch)
    r = client.post("/cleanslate",
                    json={"confirm": True, "confirmation": "CLEAN SLATE"})
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert orch.resets == 1


# ---------------------------------------------------------------- persona / mission persistence
def test_persona_persists_across_simulated_restart(tmp_path, monkeypatch):
    client, cfg, _, _ = _make_system_client(tmp_path, monkeypatch)
    assert client.get("/persona").json()["persona"].startswith("You are JARVIS")

    r = client.post("/persona", json={"persona": "Test persona L — restart-proof"})
    assert r.status_code == 200
    assert client.get("/persona").json()["persona"] == "Test persona L — restart-proof"

    state_file = tmp_path / "data" / "system_state.json"
    assert state_file.is_file()
    assert json.loads(state_file.read_text())["persona"] == "Test persona L — restart-proof"

    # Simulated restart: brand-new config object, same data dir.
    fresh_cfg = _FakeCfg(tmp_path)
    assert fresh_cfg.A.persona.startswith("You are JARVIS")
    monkeypatch.setattr(
        system_routes, "_services",
        lambda req: (fresh_cfg, _FakeOrch(), None, _FakeMemory(), None),
    )
    assert client.get("/persona").json()["persona"] == "Test persona L — restart-proof"


def test_persona_rejects_empty(tmp_path, monkeypatch):
    client, *_ = _make_system_client(tmp_path, monkeypatch)
    r = client.post("/persona", json={"persona": "   "})
    assert r.status_code == 400
    assert client.get("/persona").json()["persona"].startswith("You are JARVIS")


def test_mission_persists_across_simulated_restart(tmp_path, monkeypatch):
    client, cfg, _, memory = _make_system_client(tmp_path, monkeypatch)
    assert client.get("/mission").json() == {"enabled": False, "project_path": ""}

    target = tmp_path / "project"
    target.mkdir()
    r = client.post("/mission", json={"path": str(target)})
    assert r.status_code == 200
    assert client.get("/mission").json() == {"enabled": True, "project_path": str(target)}
    assert memory.paths["mission"][0] == str(target)

    fresh_cfg = _FakeCfg(tmp_path)
    monkeypatch.setattr(
        system_routes, "_services",
        lambda req: (fresh_cfg, _FakeOrch(), None, _FakeMemory(), None),
    )
    assert client.get("/mission").json() == {"enabled": True, "project_path": str(target)}


def test_mission_rejects_missing_path(tmp_path, monkeypatch):
    client, *_ = _make_system_client(tmp_path, monkeypatch)
    r = client.post("/mission", json={"path": str(tmp_path / "no-such-dir")})
    assert r.status_code == 400
    assert client.get("/mission").json()["enabled"] is False


# ---------------------------------------------------------------- STT size cap
pytestmark_stt = pytest.mark.skipif(
    voice_routes is None, reason="voice routes module unavailable in this env")


def _make_voice_client(tmp_path, monkeypatch):
    cfg = _FakeCfg(tmp_path)
    orch = _FakeOrch()
    monkeypatch.setattr(
        voice_routes, "_services", lambda req: (cfg, orch, None, None, None))
    monkeypatch.setattr(voice_routes, "build_transcribe_kwargs",
                        lambda cfg, language=None: {"language": "ar"})
    monkeypatch.setattr(voice_routes, "_filter_whisper_hallucination",
                        lambda text: text)
    app = FastAPI()
    app.include_router(voice_routes.router)
    return TestClient(app, raise_server_exceptions=False), cfg, orch


class _FakeWhisperModel:
    def __init__(self):
        self.calls = 0

    def transcribe(self, path, **kwargs):
        self.calls += 1
        return ([SimpleNamespace(text="hello world")], None)


@pytest.mark.skipif(voice_routes is None, reason="voice routes unavailable")
def test_stt_small_upload_transcribes(tmp_path, monkeypatch):
    client, _, _ = _make_voice_client(tmp_path, monkeypatch)
    model = _FakeWhisperModel()
    monkeypatch.setattr(voice_routes, "_get_whisper_model", lambda: model)
    r = client.post("/stt", files={"audio": ("clip.webm", b"fake-audio-bytes",
                                             "audio/webm")})
    assert r.status_code == 200
    assert r.json()["text"] == "hello world"
    assert model.calls == 1


@pytest.mark.skipif(voice_routes is None, reason="voice routes unavailable")
def test_stt_oversized_upload_rejected_413_without_whisper(tmp_path, monkeypatch):
    client, _, _ = _make_voice_client(tmp_path, monkeypatch)
    model = _FakeWhisperModel()
    monkeypatch.setattr(voice_routes, "_get_whisper_model", lambda: model)
    big = b"x" * (voice_routes.MAX_STT_BYTES + 1)
    r = client.post("/stt", files={"audio": ("clip.webm", big, "audio/webm")})
    assert r.status_code == 413
    assert r.json()["code"] == "payload_too_large"
    assert model.calls == 0  # Whisper never ran on the oversized upload


@pytest.mark.skipif(voice_routes is None, reason="voice routes unavailable")
def test_stt_chunked_read_gate_without_content_length(tmp_path, monkeypatch):
    """Direct call, no Content-Length header: the chunked-read gate fires."""
    cfg = _FakeCfg(tmp_path)
    orch = _FakeOrch()
    monkeypatch.setattr(
        voice_routes, "_services", lambda req: (cfg, orch, None, None, None))
    monkeypatch.setattr(voice_routes, "build_transcribe_kwargs",
                        lambda cfg, language=None: {"language": "ar"})
    model = _FakeWhisperModel()
    monkeypatch.setattr(voice_routes, "_get_whisper_model", lambda: model)

    big = b"x" * (voice_routes.MAX_STT_BYTES + 1)
    upload = UploadFile(filename="clip.webm", file=io.BytesIO(big))
    request = Request({"type": "http", "method": "POST", "headers": []})
    response = asyncio.run(
        voice_routes.speech_to_text(request, audio=upload))
    assert response.status_code == 413
    assert model.calls == 0
