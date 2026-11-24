"""MCP + integrations + plugin-toggle routes — mocked, no network.

Covers ``jarvis/server/routes/mcp.py`` (list / status / test with a
fake MCP process), ``integrations.py`` (youtube / shopify / bounty
test ok + error paths, unknown type, secrets never echoed), and
``plugins.py`` (toggle off/on, persistence across a reload, unknown
plugin, state listing). Route handlers run through the in-process
``TestClient`` against the aggregated router, like test_intel.py.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarvis.config import Config  # noqa: E402


# ---------------------------------------------------------------- helpers

def _cfg(tmp_path: Path) -> Config:
    cfg = Config(project_root=tmp_path)
    return cfg


def _app(cfg, registry=None, mcp_manager=None):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from jarvis.server.routes import router

    app = FastAPI()
    app.state.cfg = cfg
    app.state.orchestrator = None
    app.state.registry = registry
    app.state.memory = None
    app.state.agents = None
    if mcp_manager is not None:
        app.state.mcp_manager = mcp_manager
    app.include_router(router, prefix="/api")
    return TestClient(app)


def _write_config_yaml(tmp_path: Path, servers: dict) -> Path:
    import yaml

    path = tmp_path / "config.yaml"
    path.write_text(yaml.safe_dump({"mcp_servers": servers}),
                    encoding="utf-8")
    return path


def _manager(tmp_path: Path, servers: dict):
    from jarvis.core.mcp import MCPServerManager

    _write_config_yaml(tmp_path, servers)
    return MCPServerManager(None, tmp_path / "config.yaml")


# ------------------------------------------------------------- fake MCP

class _FakeProcess:
    """Stands in for MCPProcess: handshake succeeds/fails on demand."""

    succeed = True
    tools = [{"name": "demo_tool", "description": "demo"}]

    def __init__(self, config):
        self.config = config
        self.tools = list(self.tools)
        self.connected = False
        self.last_error = None

    async def start(self) -> bool:
        if not self.succeed:
            self.last_error = "fake handshake refused"
            return False
        self.connected = True
        return True

    async def stop(self) -> None:
        self.connected = False


# ------------------------------------------------------------------- MCP

def test_mcp_list_reports_configured_servers(tmp_path):
    manager = _manager(tmp_path, {
        "github": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
                   "enabled": True, "description": "GitHub MCP"},
        "off": {"command": "nope", "args": [], "enabled": False},
    })
    with _app(_cfg(tmp_path), mcp_manager=manager) as client:
        r = client.get("/api/mcp/servers")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["count"] == 2
    by_name = {s["name"]: s for s in body["servers"]}
    assert by_name["github"]["command"] == "npx"
    assert by_name["github"]["enabled"] is True
    assert by_name["github"]["connected"] is False
    assert by_name["off"]["enabled"] is False
    # Env values are never part of a response.
    assert "env" not in by_name["github"]
    assert "token" not in json.dumps(body).lower()


def test_mcp_list_empty_when_nothing_configured(tmp_path):
    manager = _manager(tmp_path, {})
    with _app(_cfg(tmp_path), mcp_manager=manager) as client:
        r = client.get("/api/mcp/servers")
    assert r.json() == {"ok": True, "count": 0, "servers": []}


def test_mcp_status_unknown_server_404(tmp_path):
    manager = _manager(tmp_path, {})
    with _app(_cfg(tmp_path), mcp_manager=manager) as client:
        r = client.get("/api/mcp/servers/nope/status")
    assert r.status_code == 404
    assert r.json()["ok"] is False


def test_mcp_status_disabled_server_never_probes(tmp_path, monkeypatch):
    manager = _manager(tmp_path, {
        "off": {"command": "npx", "args": [], "enabled": False},
    })
    monkeypatch.setattr("jarvis.server.routes.mcp.MCPProcess", _FakeProcess)
    with _app(_cfg(tmp_path), mcp_manager=manager) as client:
        r = client.get("/api/mcp/servers/off/status")
    assert r.json()["reachable"] is False
    assert "disabled" in r.json()["error"]


def test_mcp_status_missing_command_is_unreachable(tmp_path, monkeypatch):
    manager = _manager(tmp_path, {
        "gone": {"command": "definitely-not-a-real-binary-xyz",
                 "args": [], "enabled": True},
    })
    monkeypatch.setattr("jarvis.server.routes.mcp.MCPProcess", _FakeProcess)
    with _app(_cfg(tmp_path), mcp_manager=manager) as client:
        r = client.get("/api/mcp/servers/gone/status")
    body = r.json()
    assert body["reachable"] is False
    assert "command not found" in body["error"]


def test_mcp_probe_success_and_failure(tmp_path, monkeypatch):
    from jarvis.server.routes import mcp as mcp_routes

    monkeypatch.setattr(mcp_routes, "MCPProcess", _FakeProcess)
    manager = _manager(tmp_path, {
        "demo": {"command": "python3", "args": [], "enabled": True},
    })
    # FakeProcess.start is async; shutil.which("python3") exists, so the
    # probe path is taken.
    _FakeProcess.succeed = True
    with _app(_cfg(tmp_path), mcp_manager=manager) as client:
        ok = client.post("/api/mcp/servers/demo/test")
        assert ok.json()["ok"] is True
        assert ok.json()["reachable"] is True
        assert ok.json()["tools"] == ["demo_tool"]
        assert ok.json()["duration_ms"] >= 0
        status = client.get("/api/mcp/servers/demo/status")
        assert status.json()["reachable"] is True
    _FakeProcess.succeed = False
    with _app(_cfg(tmp_path), mcp_manager=manager) as client:
        bad = client.post("/api/mcp/servers/demo/test")
    assert bad.json()["ok"] is False
    assert bad.json()["reachable"] is False
    assert "fake handshake refused" in bad.json()["error"]


def test_mcp_test_unknown_server_404(tmp_path):
    manager = _manager(tmp_path, {})
    with _app(_cfg(tmp_path), mcp_manager=manager) as client:
        r = client.post("/api/mcp/servers/nope/test")
    assert r.status_code == 404


# ---------------------------------------------------------- integrations

def test_integrations_list_flags_configured(tmp_path, monkeypatch):
    monkeypatch.setenv("YOUTUBE_CLIENT_ID", "cid")
    monkeypatch.setenv("YOUTUBE_CLIENT_SECRET", "csecret")
    monkeypatch.delenv("SHOPIFY_SHOP_DOMAIN", raising=False)
    monkeypatch.delenv("SHOPIFY_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("HACKERONE_USERNAME", raising=False)
    monkeypatch.delenv("HACKERONE_TOKEN", raising=False)
    with _app(_cfg(tmp_path)) as client:
        r = client.get("/api/integrations")
    assert r.status_code == 200
    by_type = {i["type"]: i for i in r.json()["integrations"]}
    assert by_type["youtube"]["configured"] is True
    assert by_type["shopify"]["configured"] is False
    assert by_type["bounty"]["configured"] is False
    assert "csecret" not in r.text


def test_integration_unknown_type_404(tmp_path):
    with _app(_cfg(tmp_path)) as client:
        r = client.post("/api/integrations/test/smoke-signals")
    assert r.status_code == 404
    assert r.json()["supported"] == ["youtube", "shopify", "bounty"]


def test_youtube_unconfigured_then_authorized(tmp_path, monkeypatch):
    cfg = _cfg(tmp_path)
    monkeypatch.delenv("YOUTUBE_CLIENT_ID", raising=False)
    monkeypatch.delenv("YOUTUBE_CLIENT_SECRET", raising=False)
    with _app(cfg) as client:
        r = client.post("/api/integrations/test/youtube")
    assert r.json()["ok"] is False
    assert "not configured" in r.json()["error"]

    # Configured but no token file → not authorized.
    monkeypatch.setenv("YOUTUBE_CLIENT_ID", "cid")
    monkeypatch.setenv("YOUTUBE_CLIENT_SECRET", "sekret")
    with _app(cfg) as client:
        r = client.post("/api/integrations/test/youtube")
    assert r.json()["ok"] is False
    assert "not authorized" in r.json()["error"]
    assert "sekret" not in r.text

    # Token file with a refresh token → ok.
    token_dir = tmp_path / "data"
    token_dir.mkdir(exist_ok=True)
    (token_dir / "youtube_token.json").write_text(json.dumps({
        "access_token": "at-123", "refresh_token": "rt-456",
        "expires_at": 9999999999}), encoding="utf-8")
    with _app(cfg) as client:
        r = client.post("/api/integrations/test/youtube")
    assert r.json()["ok"] is True
    assert r.json()["authorized"] is True
    assert "rt-456" not in r.text and "at-123" not in r.text


def test_shopify_probe_ok_and_401(tmp_path, monkeypatch):
    import jarvis.server.routes.integrations as integ

    cfg = _cfg(tmp_path)
    monkeypatch.setenv("SHOPIFY_SHOP_DOMAIN", "demo.myshopify.com")
    monkeypatch.setenv("SHOPIFY_ACCESS_TOKEN", "shpat-topsecret")

    def fake_ok(url, headers=None, auth=None, timeout=5.0):
        assert url == "https://demo.myshopify.com/admin/api/2024-01/shop.json"
        assert headers["X-Shopify-Access-Token"] == "shpat-topsecret"
        return 200, {"shop": {"name": "Demo Shop"}}

    monkeypatch.setattr(integ, "_http_get_json", fake_ok)
    with _app(cfg) as client:
        r = client.post("/api/integrations/test/shopify")
    assert r.json()["ok"] is True
    assert "Demo Shop" in r.json()["detail"]
    assert "shpat-topsecret" not in r.text

    monkeypatch.setattr(integ, "_http_get_json",
                        lambda *a, **k: (401, {"errors": "unauthorized"}))
    with _app(cfg) as client:
        r = client.post("/api/integrations/test/shopify")
    assert r.json()["ok"] is False
    assert "401" in r.json()["error"]


def test_shopify_unconfigured(tmp_path, monkeypatch):
    monkeypatch.delenv("SHOPIFY_SHOP_DOMAIN", raising=False)
    monkeypatch.delenv("SHOPIFY_ACCESS_TOKEN", raising=False)
    with _app(_cfg(tmp_path)) as client:
        r = client.post("/api/integrations/test/shopify")
    assert r.json()["ok"] is False
    assert r.json()["configured"] is False


def test_bounty_probe_ok_401_and_network_error(tmp_path, monkeypatch):
    import jarvis.server.routes.integrations as integ

    cfg = _cfg(tmp_path)
    monkeypatch.setenv("HACKERONE_USERNAME", "kani15")
    monkeypatch.setenv("HACKERONE_TOKEN", "h1-secret-token")

    seen = {}

    def fake_ok(url, headers=None, auth=None, timeout=5.0):
        seen["url"] = url
        seen["auth"] = auth
        assert url == "https://api.hackerone.com/v1/me"
        return 200, {"data": {"attributes": {"username": "kani15"}}}

    monkeypatch.setattr(integ, "_http_get_json", fake_ok)
    with _app(cfg) as client:
        r = client.post("/api/integrations/test/bounty")
    assert r.json()["ok"] is True
    assert "kani15" in r.json()["detail"]
    assert seen["auth"] == ("kani15", "h1-secret-token")
    assert "h1-secret-token" not in r.text

    monkeypatch.setattr(integ, "_http_get_json",
                        lambda *a, **k: (401, {}))
    with _app(cfg) as client:
        r = client.post("/api/integrations/test/bounty")
    assert r.json()["ok"] is False and "401" in r.json()["error"]

    def fake_down(*a, **k):
        raise OSError("boom")

    monkeypatch.setattr(integ, "_http_get_json", fake_down)
    with _app(cfg) as client:
        r = client.post("/api/integrations/test/bounty")
    assert r.json()["ok"] is False
    assert "network error" in r.json()["error"]
    assert "h1-secret-token" not in r.text


def test_bounty_unconfigured(tmp_path, monkeypatch):
    monkeypatch.delenv("HACKERONE_USERNAME", raising=False)
    monkeypatch.delenv("HACKERONE_TOKEN", raising=False)
    with _app(_cfg(tmp_path)) as client:
        r = client.post("/api/integrations/test/bounty")
    assert r.json()["ok"] is False
    assert r.json()["configured"] is False


# -------------------------------------------------------------- plugins

def _registry_with_intel(tmp_path):
    from jarvis.plugins.registry import PluginRegistry

    registry = PluginRegistry(_cfg(tmp_path))
    registry.load_all()
    return registry


def test_plugin_state_lists_plugins(tmp_path):
    registry = _registry_with_intel(tmp_path)
    assert registry.get("intel_globe_items") is not None
    with _app(_cfg(tmp_path), registry=registry) as client:
        r = client.get("/api/plugins/state")
    assert r.status_code == 200
    names = {p["name"] for p in r.json()["plugins"]}
    assert "intel" in names
    intel = [p for p in r.json()["plugins"] if p["name"] == "intel"][0]
    assert intel["enabled"] is True and intel["registered"] is True
    assert intel["tools"] >= 2


def test_plugin_toggle_off_on_with_persistence(tmp_path):
    from jarvis.server.routes.plugins import PluginToggleStore, apply_persisted_toggles

    cfg = _cfg(tmp_path)
    registry = _registry_with_intel(tmp_path)
    assert registry.get("intel_globe_items") is not None

    with _app(cfg, registry=registry) as client:
        off = client.post("/api/plugins/intel/toggle",
                          json={"enabled": False})
    assert off.status_code == 200
    body = off.json()
    assert body["ok"] is True and body["enabled"] is False
    assert body["persisted"] is True and body["applied_live"] is True
    assert registry.get("intel_globe_items") is None

    # Persistence across a reload: a fresh store sees the toggle, and a
    # fresh config merged through apply_persisted_toggles carries it.
    store = PluginToggleStore(tmp_path / "data" / "plugin_toggles.json")
    assert store.load() == {"intel": False}
    fresh_cfg = _cfg(tmp_path)
    applied = apply_persisted_toggles(fresh_cfg)
    assert applied == ["intel"]
    assert fresh_cfg.plugins["intel"].enabled is False

    # Toggle back on: tools come back, file updated.
    with _app(cfg, registry=registry) as client:
        on = client.post("/api/plugins/intel/toggle", json={"enabled": True})
    assert on.json()["ok"] is True and on.json()["enabled"] is True
    assert registry.get("intel_globe_items") is not None
    assert store.load() == {"intel": True}


def test_plugin_toggle_unknown_404_and_bad_body(tmp_path):
    registry = _registry_with_intel(tmp_path)
    with _app(_cfg(tmp_path), registry=registry) as client:
        r = client.post("/api/plugins/not-a-plugin/toggle",
                        json={"enabled": False})
        assert r.status_code == 404
        assert r.json()["ok"] is False
        bad = client.post("/api/plugins/intel/toggle", json={})
        assert bad.status_code == 422


def test_toggle_store_roundtrip_and_bad_json(tmp_path):
    from jarvis.server.routes.plugins import PluginToggleStore

    store = PluginToggleStore(tmp_path / "data" / "plugin_toggles.json")
    assert store.load() == {}
    store.set("video", False)
    store.set("geo", True)
    assert store.load() == {"video": False, "geo": True}
    # Corrupt file → empty state, never an exception.
    (tmp_path / "data" / "plugin_toggles.json").write_text(
        "{not json", encoding="utf-8")
    assert store.load() == {}


def test_toggle_state_file_holds_no_secrets(tmp_path):
    from jarvis.server.routes.plugins import PluginToggleStore

    store = PluginToggleStore(tmp_path / "data" / "plugin_toggles.json")
    store.set("intel", False)
    text = (tmp_path / "data" / "plugin_toggles.json").read_text()
    assert "intel" in text
    assert "token" not in text.lower() and "secret" not in text.lower()
