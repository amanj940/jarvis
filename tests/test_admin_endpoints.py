"""Tests for the admin route modules (backend port from audit/fixes).

No network, no real keys. The real ``jarvis.core.key_manager``,
``jarvis.core.council`` and ``jarvis.core.providers_catalog`` modules do
not exist on ui-hud-upgrade yet (they arrive with the audit/fixes
merge), so tests inject stub modules into ``sys.modules`` — the route
handlers import those modules lazily, exactly like production code.
A separate set of tests asserts the honest 503 when a module is absent.
"""
from __future__ import annotations

import sys
import types
from dataclasses import dataclass
from types import SimpleNamespace

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

from jarvis.config import Config, PermissionsConfig
from jarvis.server.routes import admin_models, council_admin, keys_admin, swarm_admin

FULL_SECRET = "sk-live-test-key-0123456789abcdef"


# ---------------------------------------------------------------------------
# Stub modules (stand-ins for the audit/fixes modules)
# ---------------------------------------------------------------------------
def _mask_key(key: str) -> str:
    key = key.strip()
    if len(key) <= 8:
        return "••••••••"
    return key[:4] + "***" + key[-4:]


class FakeKeyManager:
    """Minimal mirror of the real KeyManager's public surface."""

    def __init__(self, initial_keys=None):
        self._pools: dict[str, list[dict]] = {}
        if initial_keys:
            for provider, keys in initial_keys.items():
                keys = [keys] if isinstance(keys, str) else list(keys)
                for k in keys:
                    self.add_key(provider, k)

    def add_key(self, provider, key):
        provider = provider.lower().strip()
        key = key.strip()
        if not key:
            return False
        pool = self._pools.setdefault(provider, [])
        if any(e["key"] == key for e in pool):
            return False
        pool.append({"key": key, "status": "active", "failures": 0,
                     "successes": 0, "last_error": None,
                     "cooldown_remaining": 0})
        return True

    def remove_key(self, provider, key):
        provider = provider.lower().strip()
        pool = self._pools.get(provider, [])
        for i, e in enumerate(pool):
            if e["key"] == key or _mask_key(e["key"]) == key:
                pool.pop(i)
                return True
        return False

    def get_masked_keys(self, provider):
        out = []
        for e in self._pools.get(provider.lower().strip(), []):
            d = dict(e)
            d["masked"] = _mask_key(e["key"])
            d.pop("key", None)
            out.append(d)
        return out

    def get_active_key(self, provider):
        pool = self._pools.get(provider.lower().strip(), [])
        for e in pool:
            if e["status"] == "active":
                return e["key"]
        return None

    def get_keys(self, provider):
        return [e["key"] for e in self._pools.get(provider.lower().strip(), [])]

    def mark_success(self, provider, key):
        for e in self._pools.get(provider.lower().strip(), []):
            if e["key"] == key:
                e["status"] = "active"
                e["successes"] += 1
                e["failures"] = 0

    def mark_invalid(self, provider, key, reason="Auth failed"):
        for e in self._pools.get(provider.lower().strip(), []):
            if e["key"] == key:
                e["status"] = "invalid"
                e["last_error"] = reason


@dataclass
class FakeMember:
    id: str
    name: str
    provider: str
    model: str
    role: str = "General council voice"
    specialty: str = "balanced view"


def _make_stub_modules():
    km_mod = types.ModuleType("jarvis.core.key_manager")
    km_mod.KeyManager = FakeKeyManager
    km_mod.mask_key = _mask_key

    council_mod = types.ModuleType("jarvis.core.council")
    members = [FakeMember(id="groq:llama-3", name="groq/llama-3",
                          provider="groq", model="llama-3"),
               FakeMember(id="gemini:flash", name="gemini/flash",
                          provider="gemini", model="flash")]

    class FakeCouncil:
        _dynamic_roster = list(members)
        _last_benchmark = [{"model": "groq/llama-3", "score": 9.1}]

        def __init__(self, brain):
            self.brain = brain

        def get_available_members(self):
            return list(members)

        @classmethod
        def get_last_benchmark(cls):
            return cls._last_benchmark

    council_mod.AICouncil = FakeCouncil
    council_mod.COUNCIL_ROSTER = {m.id: m for m in members}
    council_mod.roster_from_verified_lineup = lambda *a, **k: list(members)
    council_mod.select_fast_members = lambda ms, n=8: list(ms)[:n]
    council_mod._avg_latency_for = lambda p, m: 120.5

    catalog_mod = types.ModuleType("jarvis.core.providers_catalog")
    specs = [
        SimpleNamespace(id="groq", display_name="Groq",
                        default_base_url="https://api.groq.com/openai/v1",
                        protocol="openai_compatible", free_tier=True,
                        local=False, credential_env="GROQ_API_KEY"),
        SimpleNamespace(id="omniroute", display_name="9Router Proxy",
                        default_base_url="http://localhost:20128/v1",
                        protocol="openai_compatible", free_tier=True,
                        local=True, credential_env=None),
    ]
    catalog_mod.list_providers = lambda: list(specs)
    catalog_mod.get_provider_spec = lambda pid: next(
        (s for s in specs if s.id == pid), None)
    catalog_mod.get_cloud_providers = lambda: [s for s in specs if not s.local]
    catalog_mod.get_free_tier_providers = lambda: [s for s in specs if s.free_tier]
    return {"jarvis.core.key_manager": km_mod,
            "jarvis.core.council": council_mod,
            "jarvis.core.providers_catalog": catalog_mod}


@pytest.fixture()
def stub_modules(monkeypatch):
    mods = _make_stub_modules()
    for name, mod in mods.items():
        monkeypatch.setitem(sys.modules, name, mod)
    return mods


@pytest.fixture()
def absent_modules(monkeypatch):
    """Ensure the audit/fixes modules are NOT importable."""
    for name in ("jarvis.core.key_manager", "jarvis.core.council",
                 "jarvis.core.providers_catalog"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    return None


# ---------------------------------------------------------------------------
# App harness
# ---------------------------------------------------------------------------
class FakeBrain:
    def __init__(self, key_manager=None, tiers=None):
        self.key_manager = key_manager
        self._tiers = tiers

    def get_cascade_tiers(self):
        if self._tiers is None:
            raise AttributeError("no get_cascade_tiers")
        return self._tiers


@dataclass
class FakeTier:
    name: str
    provider: str
    endpoint: str
    model: str
    is_local: bool = False
    timeout: float = 14.0
    ttft_timeout: float = 5.0


class FakeTaskStore:
    def __init__(self, tasks=None):
        self._tasks = tasks or []

    def list_tasks(self, status=None, kind=None):
        out = [t for t in self._tasks
               if (kind is None or t.get("kind") == kind)
               and (status is None or t.get("status") == status)]
        return out


def make_client(cfg=None, brain=None, task_store=None):
    cfg = cfg or Config()
    app = FastAPI()
    app.state.cfg = cfg
    app.state.orchestrator = SimpleNamespace(brain=brain)
    app.state.registry = None
    app.state.memory = None
    app.state.agents = None
    app.state.task_store = task_store
    app.include_router(admin_models.router, prefix="/api")
    app.include_router(keys_admin.router, prefix="/api")
    app.include_router(council_admin.router, prefix="/api")
    app.include_router(swarm_admin.router, prefix="/api")
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Models / cascade
# ---------------------------------------------------------------------------
def test_cascade_from_brain(stub_modules):
    km = FakeKeyManager({"groq": [FULL_SECRET]})
    tiers = [FakeTier("Tier 0 (Primary)", "groq",
                      "https://api.groq.com/openai/v1", "llama-3"),
             FakeTier("Tier 3 (9Router Aggregate)", "omniroute",
                      "http://localhost:20128/v1", "groq/openai/gpt-oss-120b",
                      is_local=True)]
    client = make_client(brain=FakeBrain(key_manager=km, tiers=tiers))
    r = client.get("/api/models/cascade")
    assert r.status_code == 200
    data = r.json()
    assert data["source"] == "brain"
    assert len(data["tiers"]) == 2
    assert data["tiers"][0]["provider"] == "groq"
    assert data["tiers"][0]["keys_available"] == 1
    assert data["tiers"][0]["keys_total"] == 1
    assert FULL_SECRET not in r.text


def test_cascade_fallback_without_brain_method(stub_modules):
    brain = SimpleNamespace()  # no get_cascade_tiers, no key_manager
    client = make_client(brain=brain)
    r = client.get("/api/models/cascade")
    assert r.status_code == 200
    data = r.json()
    assert data["source"] == "config-fallback"
    assert data["tiers"][0]["name"] == "Tier 0 (Primary)"
    assert data["tiers"][0]["model"] == "gemma4:31b-cloud"
    assert any(t["provider"] == "omniroute" for t in data["tiers"])


def test_models_list_with_catalog(stub_modules):
    client = make_client(brain=FakeBrain())
    r = client.get("/api/models")
    assert r.status_code == 200
    data = r.json()
    assert data["providers_available"] is True
    assert {p["id"] for p in data["providers"]} == {"groq", "omniroute"}
    assert data["current"]["model"] == "gemma4:31b-cloud"


def test_models_list_without_catalog(absent_modules):
    client = make_client(brain=FakeBrain())
    r = client.get("/api/models")
    assert r.status_code == 200
    data = r.json()
    assert data["providers_available"] is False
    assert data["providers"] == []
    assert data["current"]["model"] == "gemma4:31b-cloud"


# ---------------------------------------------------------------------------
# Verified models / council
# ---------------------------------------------------------------------------
def test_models_verified_with_council(stub_modules):
    client = make_client(brain=FakeBrain())
    r = client.get("/api/models/verified")
    assert r.status_code == 200
    data = r.json()
    assert data["available"] is True
    assert data["count"] == 2
    assert data["verified"][0]["avg_latency_ms"] == 120.5
    assert data["last_benchmark"][0]["model"] == "groq/llama-3"


def test_models_verified_without_council(absent_modules):
    client = make_client(brain=FakeBrain())
    r = client.get("/api/models/verified")
    assert r.status_code == 503
    assert r.json()["available"] is False


def test_council_members_with_stub(stub_modules):
    client = make_client(brain=FakeBrain())
    r = client.get("/api/council/members")
    assert r.status_code == 200
    data = r.json()
    assert data["source"] == "available-members"
    assert data["count"] == 2


def test_council_members_without_module(absent_modules):
    client = make_client(brain=FakeBrain())
    r = client.get("/api/council/members")
    assert r.status_code == 503


def test_council_benchmark_and_fast(stub_modules):
    client = make_client(brain=FakeBrain())
    assert client.get("/api/council/last-benchmark").json()["last_benchmark"]
    r = client.get("/api/council/fast-members?n=1")
    assert r.json()["count"] == 1
    r = client.get("/api/council/roster")
    assert len(r.json()["static_roster"]) == 2


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
def test_config_get_scrubs_secrets():
    client = make_client()
    r = client.get("/api/config")
    assert r.status_code == 200
    data = r.json()
    assert data["config"]["model"]["model"] == "gemma4:31b-cloud"
    assert data["_meta"]["permissions_mode"] == "confirm"
    assert FULL_SECRET not in r.text


def test_config_post_writes_yaml(tmp_path):
    cfg = Config(project_root=tmp_path)
    client = make_client(cfg=cfg)
    r = client.post("/api/config", json={
        "updates": {"model": {"temperature": 0.7}}})
    assert r.status_code == 200, r.text
    assert r.json()["requires_restart"] is True
    on_disk = yaml.safe_load((tmp_path / "config.yaml").read_text())
    assert on_disk["model"]["temperature"] == 0.7


def test_config_post_forbidden_section(tmp_path):
    cfg = Config(project_root=tmp_path)
    client = make_client(cfg=cfg)
    r = client.post("/api/config", json={
        "updates": {"permissions": {"mode": "confirm"}}})
    assert r.status_code == 400


def test_config_post_rejects_secrets(tmp_path):
    cfg = Config(project_root=tmp_path)
    client = make_client(cfg=cfg)
    r = client.post("/api/config", json={
        "updates": {"model": {"api_key": "sk-secret-123"}}})
    assert r.status_code == 400


def test_config_post_requires_confirm_mode(tmp_path):
    cfg = Config(project_root=tmp_path,
                 permissions=PermissionsConfig(mode="bypass"))
    client = make_client(cfg=cfg)
    r = client.post("/api/config", json={
        "updates": {"model": {"temperature": 0.5}}})
    assert r.status_code == 403
    assert not (tmp_path / "config.yaml").exists()


def test_config_post_invalid_value(tmp_path):
    cfg = Config(project_root=tmp_path)
    client = make_client(cfg=cfg)
    r = client.post("/api/config", json={
        "updates": {"model": {"temperature": "not-a-number"}}})
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Keys
# ---------------------------------------------------------------------------
def test_keys_list_masked_only(stub_modules):
    km = FakeKeyManager({"groq": [FULL_SECRET]})
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.get("/api/keys")
    assert r.status_code == 200
    assert FULL_SECRET not in r.text
    assert r.json()["providers"]["groq"][0]["masked"] == _mask_key(FULL_SECRET)
    assert r.json()["has_active_key"]["groq"] is True


def test_keys_list_without_module(absent_modules):
    client = make_client(brain=FakeBrain())
    r = client.get("/api/keys")
    assert r.status_code == 503


def test_keys_add_and_duplicate(stub_modules):
    km = FakeKeyManager()
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/add",
                    json={"provider": "groq", "key": FULL_SECRET})
    assert r.status_code == 200, r.text
    assert FULL_SECRET not in r.text
    r = client.post("/api/keys/add",
                    json={"provider": "groq", "key": FULL_SECRET})
    assert r.status_code == 409


def test_keys_probe_membership(stub_modules):
    km = FakeKeyManager({"groq": [FULL_SECRET]})
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/probe", json={
        "provider": "groq", "masked": _mask_key(FULL_SECRET)})
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "active"
    assert data["live_checked"] is False
    assert FULL_SECRET not in r.text
    r = client.post("/api/keys/probe", json={
        "provider": "groq", "masked": "nope***0000"})
    assert r.status_code == 404


def test_keys_delete_by_masked(stub_modules):
    km = FakeKeyManager({"groq": [FULL_SECRET]})
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.delete(f"/api/keys/{_mask_key(FULL_SECRET)}",
                      params={"provider": "groq"})
    assert r.status_code == 200
    assert client.get("/api/keys?provider=groq").json()["providers"] == {}
    r = client.delete(f"/api/keys/{_mask_key(FULL_SECRET)}",
                      params={"provider": "groq"})
    assert r.status_code == 404


def test_keys_bulk_import(stub_modules):
    km = FakeKeyManager({"groq": [FULL_SECRET]})
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/bulk-import", json={
        "provider": "groq",
        "keys": [FULL_SECRET, "sk-other-key-abcdef1234567890", "  "]})
    assert r.status_code == 200
    data = r.json()
    assert data["added"] == 1
    assert data["duplicates"] == 1
    assert data["total_in_pool"] == 2
    assert FULL_SECRET not in r.text


def test_keys_write_requires_confirm_mode(stub_modules):
    km = FakeKeyManager()
    cfg = Config(permissions=PermissionsConfig(mode="bypass"))
    client = make_client(cfg=cfg, brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/add",
                    json={"provider": "groq", "key": FULL_SECRET})
    assert r.status_code == 403
    assert km.get_keys("groq") == []


# ---------------------------------------------------------------------------
# Swarm
# ---------------------------------------------------------------------------
def test_swarm_status_and_tasks():
    store = FakeTaskStore([
        {"id": 1, "kind": "swarm", "status": "pending", "title": "fan-out"},
        {"id": 2, "kind": "reminder", "status": "pending", "title": "x"},
    ])
    client = make_client(brain=FakeBrain(), task_store=store)
    r = client.get("/api/swarm/status")
    assert r.status_code == 200
    data = r.json()
    assert data["available"] is True  # real jarvis.core.swarm exists
    assert data["swarm_tasks_total"] == 1
    assert data["swarm_tasks_pending"] == 1
    r = client.get("/api/swarm/tasks")
    assert r.json()["count"] == 1
    r = client.get("/api/swarm/tasks?status=done")
    assert r.json()["count"] == 0


def test_swarm_tasks_without_store():
    client = make_client(brain=FakeBrain(), task_store=None)
    r = client.get("/api/swarm/tasks")
    assert r.status_code == 503
