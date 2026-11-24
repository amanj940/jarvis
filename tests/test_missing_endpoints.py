"""Tests for the previously-missing admin endpoints (worker I).

Covers the five new POSTs plus the bulk-import payload-shape fix:

- ``POST /api/models`` — set the active model (config.yaml write)
- ``POST /api/keys/remove`` — remove one key by full / masked / key id
- ``POST /api/keys/bulk-import`` — string blob / ``text`` / list-of-dicts
  payloads (the UI's bulk-paste box used to 422 against ``list[str]``)
- ``POST /api/council/benchmark`` — run benchmark + election
- ``POST /api/council`` — run a deliberation
- ``POST /api/swarm/run`` — fan a task list out through the runner

No network, no real keys, no real LLM calls: the council / swarm /
catalog modules are stubbed in ``sys.modules`` and the KeyManager is a
fake. Follows the harness pattern of ``tests/test_admin_endpoints.py``.
"""
from __future__ import annotations

import sys
import types
from dataclasses import dataclass, field
from types import SimpleNamespace

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

from jarvis.config import Config, PermissionsConfig
from jarvis.server.routes import admin_models, council_admin, keys_admin, swarm_admin

FULL_SECRET = "sk-live-test-key-0123456789abcdef"
OTHER_SECRET = "sk-other-key-abcdef1234567890"


def _mask_key(key: str) -> str:
    key = key.strip()
    if len(key) <= 8:
        return "••••••••"
    return key[:4] + "***" + key[-4:]


# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------
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
        for e in self._pools.get(provider.lower().strip(), []):
            if e["status"] == "active":
                return e["key"]
        return None

    def get_keys(self, provider):
        return [e["key"] for e in self._pools.get(provider.lower().strip(), [])]


@dataclass
class FakeMember:
    id: str
    name: str
    provider: str
    model: str
    role: str = "General council voice"
    specialty: str = "balanced view"


@dataclass
class FakeProposal:
    member_id: str
    member_name: str
    icon: str
    model: str
    content: str
    confidence: float = 0.95


def _make_stub_council():
    mod = types.ModuleType("jarvis.core.council")

    class FakeCouncil:
        _dynamic_roster: list = []
        _last_benchmark: list = []

        def __init__(self, brain):
            self.brain = brain

        @classmethod
        def set_dynamic_roster(cls, members, benchmark_data=None):
            cls._dynamic_roster = list(members)
            if benchmark_data is not None:
                cls._last_benchmark = list(benchmark_data)

        @classmethod
        def get_last_benchmark(cls):
            return list(cls._last_benchmark)

        async def auto_evaluate_and_elect(self):
            results = [{"model": "groq/llama-3", "score": 9.1,
                        "latency_ms": 120.5}]
            elected = [FakeMember(id="groq:llama-3", name="groq/llama-3",
                                  provider="groq", model="llama-3")]
            type(self).set_dynamic_roster(elected, results)
            return results, elected

        async def deliberate(self, topic, *, context="", full=False):
            return SimpleNamespace(
                topic=topic,
                consensus_verdict="Do X first, then Y.",
                agreement_score=0.94,
                active_members=[{"id": "groq:llama-3",
                                 "name": "groq/llama-3"}],
                proposals=[FakeProposal(
                    member_id="groq:llama-3", member_name="groq/llama-3",
                    icon="🧠", model="llama-3", content="Proposal: do X.")],
                peer_critiques=[{"member_id": "groq:llama-3",
                                 "member_name": "groq/llama-3",
                                 "critique": "X looks sound."}],
            )

    mod.AICouncil = FakeCouncil
    mod.COUNCIL_ROSTER = {}
    mod.roster_from_verified_lineup = lambda *a, **k: []
    mod.select_fast_members = lambda ms, n=8: list(ms)[:n]
    mod._avg_latency_for = lambda p, m: 120.5
    return mod


@dataclass
class FakeSwarmTask:
    label: str
    tool: str
    args: dict = field(default_factory=dict)


@dataclass
class FakeEvent:
    kind: str = "info"
    text: str = ""
    payload: dict = field(default_factory=dict)
    swarm_id: str | None = None
    swarm_label: str | None = None


def _make_stub_swarm():
    mod = types.ModuleType("jarvis.core.swarm")
    mod.SwarmTask = FakeSwarmTask

    async def _fake_run_swarm(orchestrator, tasks, *, max_concurrency=4):
        run_id = "test1234"
        yield FakeEvent(
            kind="info", text=f"⌬ Swarm dispatched: {len(tasks)} parallel tasks",
            payload={"swarm": True, "swarm_run_id": run_id,
                     "tasks": [{"id": f"{run_id}:{i}", "label": t.label,
                                "tool": t.tool} for i, t in enumerate(tasks)]})
        for i, t in enumerate(tasks):
            yield FakeEvent(
                kind="tool_result", text=f"{t.label} ok",
                payload={"ok": True},
                swarm_id=f"{run_id}:{i}", swarm_label=t.label)
        yield FakeEvent(
            kind="info", text="⌬ Swarm complete:",
            payload={"swarm": True, "swarm_run_id": run_id,
                     "summary": [f"✓ [{t.label}] ok" for t in tasks]})

    mod.run_swarm = _fake_run_swarm
    return mod


def _make_stub_catalog():
    mod = types.ModuleType("jarvis.core.providers_catalog")
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
    mod.list_providers = lambda: list(specs)
    mod.get_provider_spec = lambda pid: next(
        (s for s in specs if s.id == pid), None)
    return mod


@pytest.fixture()
def stub_modules(monkeypatch):
    mods = {
        "jarvis.core.key_manager": types.ModuleType("jarvis.core.key_manager"),
        "jarvis.core.council": _make_stub_council(),
        "jarvis.core.swarm": _make_stub_swarm(),
        "jarvis.core.providers_catalog": _make_stub_catalog(),
    }
    mods["jarvis.core.key_manager"].KeyManager = FakeKeyManager
    mods["jarvis.core.key_manager"].mask_key = _mask_key
    for name, mod in mods.items():
        monkeypatch.setitem(sys.modules, name, mod)
    return mods


# ---------------------------------------------------------------------------
# App harness (same shape as tests/test_admin_endpoints.py)
# ---------------------------------------------------------------------------
class FakeBrain:
    def __init__(self, key_manager=None):
        self.key_manager = key_manager

    def get_cascade_tiers(self):
        raise AttributeError("no get_cascade_tiers")


class FakeRegistry:
    def __init__(self, tool_names):
        self._names = list(tool_names)

    def all_tools(self):
        return [SimpleNamespace(name=n) for n in self._names]


def make_client(cfg=None, brain=None, task_store=None, registry=None):
    cfg = cfg or Config()
    app = FastAPI()
    app.state.cfg = cfg
    app.state.orchestrator = SimpleNamespace(brain=brain)
    app.state.registry = registry
    app.state.memory = None
    app.state.agents = None
    app.state.task_store = task_store
    app.include_router(admin_models.router, prefix="/api")
    app.include_router(keys_admin.router, prefix="/api")
    app.include_router(council_admin.router, prefix="/api")
    app.include_router(swarm_admin.router, prefix="/api")
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# POST /api/models
# ---------------------------------------------------------------------------
def test_models_set_flat_happy_path(tmp_path, stub_modules):
    cfg = Config(project_root=tmp_path)
    client = make_client(cfg=cfg, brain=FakeBrain())
    r = client.post("/api/models", json={
        "provider": "groq", "model": "llama-3", "temperature": 0.5})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert data["requires_restart"] is True
    assert data["current"]["provider"] == "groq"
    assert data["current"]["model"] == "llama-3"
    # Endpoint filled from the provider catalog when omitted.
    assert data["current"]["endpoint"] == "https://api.groq.com/openai/v1"
    on_disk = yaml.safe_load((tmp_path / "config.yaml").read_text())
    assert on_disk["model"]["provider"] == "groq"
    assert on_disk["model"]["model"] == "llama-3"
    assert on_disk["model"]["temperature"] == 0.5


def test_models_set_nested_shape(tmp_path, stub_modules):
    cfg = Config(project_root=tmp_path)
    client = make_client(cfg=cfg, brain=FakeBrain())
    r = client.post("/api/models", json={
        "model": {"provider": "groq", "model": "llama-3"}})
    assert r.status_code == 200, r.text
    assert r.json()["current"]["model"] == "llama-3"
    on_disk = yaml.safe_load((tmp_path / "config.yaml").read_text())
    assert on_disk["model"]["provider"] == "groq"


def test_models_set_missing_model(tmp_path):
    cfg = Config(project_root=tmp_path)
    client = make_client(cfg=cfg, brain=FakeBrain())
    r = client.post("/api/models", json={"provider": "groq"})
    assert r.status_code == 400
    assert not (tmp_path / "config.yaml").exists()


def test_models_set_unknown_field(tmp_path):
    cfg = Config(project_root=tmp_path)
    client = make_client(cfg=cfg, brain=FakeBrain())
    r = client.post("/api/models", json={
        "provider": "groq", "model": "llama-3", "api_key": "sk-secret-1"})
    assert r.status_code == 400
    assert not (tmp_path / "config.yaml").exists()


def test_models_set_invalid_value(tmp_path):
    cfg = Config(project_root=tmp_path)
    client = make_client(cfg=cfg, brain=FakeBrain())
    r = client.post("/api/models", json={
        "provider": "groq", "model": "llama-3",
        "temperature": "not-a-number"})
    assert r.status_code == 400
    assert not (tmp_path / "config.yaml").exists()


def test_models_set_requires_confirm_mode(tmp_path):
    cfg = Config(project_root=tmp_path,
                 permissions=PermissionsConfig(mode="bypass"))
    client = make_client(cfg=cfg, brain=FakeBrain())
    r = client.post("/api/models", json={
        "provider": "groq", "model": "llama-3"})
    assert r.status_code == 403
    assert not (tmp_path / "config.yaml").exists()


def test_models_set_keeps_endpoint_for_unknown_provider(tmp_path):
    # No catalog stub: an unknown provider keeps the configured endpoint
    # instead of blanking it.
    cfg = Config(project_root=tmp_path)
    client = make_client(cfg=cfg, brain=FakeBrain())
    before = cfg.model.endpoint
    r = client.post("/api/models", json={
        "provider": "customprov", "model": "custom-1"})
    assert r.status_code == 200, r.text
    assert r.json()["current"]["endpoint"] == before


def test_models_cascade_untouched_by_models_set(tmp_path, stub_modules):
    """Regression guard: the cascade handler still answers after a set."""
    cfg = Config(project_root=tmp_path)
    client = make_client(cfg=cfg, brain=FakeBrain())
    assert client.post("/api/models", json={
        "provider": "groq", "model": "llama-3"}).status_code == 200
    r = client.get("/api/models/cascade")
    assert r.status_code == 200
    assert r.json()["tiers"]


# ---------------------------------------------------------------------------
# POST /api/keys/remove
# ---------------------------------------------------------------------------
def test_keys_remove_by_masked(stub_modules):
    km = FakeKeyManager({"groq": [FULL_SECRET]})
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/remove", json={
        "provider": "groq", "masked": _mask_key(FULL_SECRET)})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert data["removed"] == _mask_key(FULL_SECRET)
    assert data["remaining"] == 0
    assert FULL_SECRET not in r.text
    assert km.get_keys("groq") == []


def test_keys_remove_by_full_key_never_echoes_it(stub_modules):
    km = FakeKeyManager({"groq": [FULL_SECRET]})
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/remove", json={
        "provider": "groq", "key": FULL_SECRET})
    assert r.status_code == 200, r.text
    assert r.json()["removed"] == _mask_key(FULL_SECRET)
    assert FULL_SECRET not in r.text


def test_keys_remove_by_key_id(stub_modules):
    km = FakeKeyManager({"groq": [FULL_SECRET]})
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/remove", json={
        "provider": "groq", "key_id": _mask_key(FULL_SECRET)})
    assert r.status_code == 200, r.text
    assert km.get_keys("groq") == []


def test_keys_remove_unknown_is_404(stub_modules):
    km = FakeKeyManager({"groq": [FULL_SECRET]})
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/remove", json={
        "provider": "groq", "masked": "nope***0000"})
    assert r.status_code == 404


def test_keys_remove_missing_identifier_is_400(stub_modules):
    km = FakeKeyManager({"groq": [FULL_SECRET]})
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/remove", json={"provider": "groq"})
    assert r.status_code == 400
    assert km.get_keys("groq") == [FULL_SECRET]


def test_keys_remove_requires_confirm_mode(stub_modules):
    km = FakeKeyManager({"groq": [FULL_SECRET]})
    cfg = Config(permissions=PermissionsConfig(mode="bypass"))
    client = make_client(cfg=cfg, brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/remove", json={
        "provider": "groq", "masked": _mask_key(FULL_SECRET)})
    assert r.status_code == 403
    assert km.get_keys("groq") == [FULL_SECRET]


# ---------------------------------------------------------------------------
# POST /api/keys/bulk-import — payload shapes
# ---------------------------------------------------------------------------
def test_keys_bulk_import_string_blob(stub_modules):
    """The UI's bulk-paste box sends one newline-separated string."""
    km = FakeKeyManager()
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/bulk-import", json={
        "provider": "groq",
        "keys": "sk-bulk-key-aaaa1111\nsk-bulk-key-bbbb2222\n"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["added"] == 2
    assert data["total_in_pool"] == 2


def test_keys_bulk_import_text_alias(stub_modules):
    km = FakeKeyManager()
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/bulk-import", json={
        "provider": "groq",
        "text": "sk-bulk-key-aaaa1111, sk-bulk-key-bbbb2222"})
    assert r.status_code == 200, r.text
    assert r.json()["added"] == 2


def test_keys_bulk_import_list_of_dicts(stub_modules):
    km = FakeKeyManager()
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/bulk-import", json={
        "provider": "groq",
        "keys": [{"key": "sk-bulk-key-aaaa1111"},
                 {"key": "sk-bulk-key-bbbb2222"}]})
    assert r.status_code == 200, r.text
    assert r.json()["added"] == 2


def test_keys_bulk_import_list_shape_still_works(stub_modules):
    km = FakeKeyManager({"groq": [FULL_SECRET]})
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/bulk-import", json={
        "provider": "groq",
        "keys": [FULL_SECRET, OTHER_SECRET, "  "]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["added"] == 1
    assert data["duplicates"] == 1
    assert data["total_in_pool"] == 2
    assert FULL_SECRET not in r.text


def test_keys_bulk_import_missing_provider_is_422(stub_modules):
    km = FakeKeyManager()
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/bulk-import", json={
        "keys": ["sk-bulk-key-aaaa1111"]})
    assert r.status_code == 422


def test_keys_bulk_import_empty_is_400(stub_modules):
    km = FakeKeyManager()
    client = make_client(brain=FakeBrain(key_manager=km))
    r = client.post("/api/keys/bulk-import", json={
        "provider": "groq", "keys": ""})
    assert r.status_code == 400
    r = client.post("/api/keys/bulk-import", json={
        "provider": "groq", "keys": []})
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/council/benchmark
# ---------------------------------------------------------------------------
def test_council_benchmark_happy_path(stub_modules):
    client = make_client(brain=FakeBrain())
    r = client.post("/api/council/benchmark", json={})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert data["count"] == 1
    assert data["results"][0]["model"] == "groq/llama-3"
    assert data["elected"][0]["id"] == "groq:llama-3"
    # The run stores its results for the read endpoint.
    assert client.get("/api/council/last-benchmark").json()[
        "last_benchmark"][0]["model"] == "groq/llama-3"


def test_council_benchmark_no_body_ok(stub_modules):
    client = make_client(brain=FakeBrain())
    r = client.post("/api/council/benchmark")
    assert r.status_code == 200, r.text


def test_council_benchmark_without_module(monkeypatch):
    monkeypatch.setattr(council_admin, "_council_module", lambda: None)
    client = make_client(brain=FakeBrain())
    r = client.post("/api/council/benchmark", json={})
    assert r.status_code == 503
    assert r.json()["available"] is False


def test_council_benchmark_without_brain(stub_modules):
    client = make_client(brain=None)
    r = client.post("/api/council/benchmark", json={})
    assert r.status_code == 503


# ---------------------------------------------------------------------------
# POST /api/council
# ---------------------------------------------------------------------------
def test_council_deliberate_happy_path(stub_modules):
    client = make_client(brain=FakeBrain())
    r = client.post("/api/council", json={
        "topic": "Should we cache aggressively?", "context": "8 GB RAM"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert data["topic"] == "Should we cache aggressively?"
    assert data["consensus_verdict"] == "Do X first, then Y."
    assert data["agreement_score"] == 0.94
    assert len(data["proposals"]) == 1
    assert data["proposals"][0]["content"] == "Proposal: do X."
    assert len(data["peer_critiques"]) == 1


def test_council_deliberate_missing_topic_is_400(stub_modules):
    client = make_client(brain=FakeBrain())
    r = client.post("/api/council", json={})
    assert r.status_code == 400
    r = client.post("/api/council", json={"topic": "   "})
    assert r.status_code == 400


def test_council_deliberate_without_module(monkeypatch):
    monkeypatch.setattr(council_admin, "_council_module", lambda: None)
    client = make_client(brain=FakeBrain())
    r = client.post("/api/council", json={"topic": "hi"})
    assert r.status_code == 503


# ---------------------------------------------------------------------------
# POST /api/swarm/run
# ---------------------------------------------------------------------------
def test_swarm_run_happy_path(stub_modules):
    registry = FakeRegistry(["get_weather", "web_search"])
    client = make_client(brain=FakeBrain(), registry=registry)
    r = client.post("/api/swarm/run", json={
        "tasks": [
            {"label": "Weather", "tool": "get_weather",
             "args": {"city": "Cairo"}},
            {"tool": "web_search", "args": {"query": "news"}},
        ],
        "max_concurrency": 2})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert data["swarm_run_id"] == "test1234"
    assert data["tasks"] == [
        {"label": "Weather", "tool": "get_weather"},
        {"label": "web_search", "tool": "web_search"},
    ]
    assert data["counts"] == {"tasks": 2, "events": 4, "errors": 0}
    assert data["summary"] == ["✓ [Weather] ok", "✓ [web_search] ok"]
    assert data["events"][0]["kind"] == "info"
    assert data["events"][1]["kind"] == "tool_result"
    assert data["events"][1]["swarm_label"] == "Weather"


def test_swarm_run_without_registry_skips_tool_check(stub_modules):
    client = make_client(brain=FakeBrain(), registry=None)
    r = client.post("/api/swarm/run", json={
        "tasks": [{"tool": "anything_tool"}]})
    assert r.status_code == 200, r.text


def test_swarm_run_empty_tasks_is_400(stub_modules):
    client = make_client(brain=FakeBrain())
    r = client.post("/api/swarm/run", json={"tasks": []})
    assert r.status_code == 400
    r = client.post("/api/swarm/run", json={})
    assert r.status_code == 400


def test_swarm_run_missing_tool_is_400(stub_modules):
    client = make_client(brain=FakeBrain())
    r = client.post("/api/swarm/run", json={"tasks": [{"label": "x"}]})
    assert r.status_code == 400


def test_swarm_run_unknown_tool_is_400(stub_modules):
    registry = FakeRegistry(["get_weather"])
    client = make_client(brain=FakeBrain(), registry=registry)
    r = client.post("/api/swarm/run", json={
        "tasks": [{"tool": "no_such_tool"}]})
    assert r.status_code == 400


def test_swarm_run_bad_concurrency_is_400(stub_modules):
    client = make_client(brain=FakeBrain())
    for bad in (0, 99, "four"):
        r = client.post("/api/swarm/run", json={
            "tasks": [{"tool": "get_weather"}], "max_concurrency": bad})
        assert r.status_code == 400, bad


def test_swarm_run_requires_confirm_mode(stub_modules):
    cfg = Config(permissions=PermissionsConfig(mode="bypass"))
    client = make_client(cfg=cfg, brain=FakeBrain())
    r = client.post("/api/swarm/run", json={
        "tasks": [{"tool": "get_weather"}]})
    assert r.status_code == 403


def test_swarm_run_without_runner_is_503(monkeypatch):
    monkeypatch.setattr(swarm_admin, "_swarm_module", lambda: None)
    client = make_client(brain=FakeBrain())
    r = client.post("/api/swarm/run", json={
        "tasks": [{"tool": "get_weather"}]})
    assert r.status_code == 503
    assert r.json()["available"] is False
