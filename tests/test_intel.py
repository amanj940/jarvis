"""Intelligence layer tests — no network, no keys, no live server.

Covers the curated geo lookup, the leads-store migration (old databases
gain the new columns without losing rows), the read-only aggregation
(plotted vs unlocated), the tools, the HTTP route handlers (called
directly with a stub request — no server), and plugin discovery.
"""
from __future__ import annotations

import asyncio
import json
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarvis.plugins.bounty.store import BountyStore  # noqa: E402
from jarvis.plugins.intel.geo import resolve_location, valid_coords  # noqa: E402
from jarvis.plugins.intel.store import IntelStore  # noqa: E402
from jarvis.plugins.opportunity.leads import LeadsStore  # noqa: E402


class _FakeCfg:
    def __init__(self, root: Path):
        self._root = root
        self.plugins = {}

    def abs_path(self, p):
        return self._root / p


def _seed(tmp_path) -> IntelStore:
    """IntelStore over tmp DBs with a mix of locatable / unlocatable rows.

    Stores live under ``data/`` — the same paths ``IntelStore`` opens
    through ``cfg.abs_path("data/...")``.
    """
    leads = LeadsStore(tmp_path / "data" / "opportunity.db")
    leads.add_lead("https://example.com/dubai-deal", "Dubai expansion deal",
                   source="upwork", kind="gig", score=80.0)
    leads.add_lead("https://example.com/explicit", "Pinned HQ visit",
                   source="other", kind="other", score=50.0,
                   lat=35.7, lon=51.4, location="Tehran")
    leads.add_lead("https://example.com/nowhere", "Mystery project",
                   source="other", kind="other", score=10.0)
    bounty = BountyStore(tmp_path / "data" / "bounty.db")
    program = bounty.add_program("Google", platform="hackerone",
                                 url="https://hackerone.com/google")
    bounty.add_finding(program["id"], "www.google.com", "Reflected XSS",
                       severity="high")
    bounty.add_program("Acme Corp", platform="other")
    return IntelStore(_FakeCfg(tmp_path))


# ---- geo lookup ----

def test_resolve_city_case_insensitive():
    loc = resolve_location("Hiring in DUBAI next month")
    assert loc == {"lat": 25.2, "lon": 55.27, "name": "Dubai", "match": "city"}


def test_resolve_company_hq():
    loc = resolve_location("Google VRP scope update")
    assert loc["lat"] == 37.42 and loc["lon"] == -122.08
    assert loc["name"] == "Mountain View" and loc["match"] == "company"


def test_resolve_city_beats_company():
    # "Paris" is both a city and the YesWeHack HQ city — the city match wins.
    loc = resolve_location("Meetup in Paris")
    assert loc["match"] == "city" and loc["name"] == "Paris"


def test_resolve_accent_folded():
    loc = resolve_location("Office in Sao Paulo")
    assert loc is not None and loc["name"] == "Sao Paulo"


def test_resolve_unknown_returns_none():
    assert resolve_location("Some random text with no place") is None
    assert resolve_location("") is None


def test_valid_coords():
    assert valid_coords(35.7, 51.4) is True
    assert valid_coords(91, 0) is False
    assert valid_coords(0, 181) is False
    assert valid_coords("nope", 0) is False
    assert valid_coords(None, None) is False


# ---- leads migration ----

def test_old_database_gains_columns_without_losing_rows(tmp_path):
    db = tmp_path / "old.db"
    conn = sqlite3.connect(db)
    conn.execute(
        "CREATE TABLE leads (id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " url_hash TEXT NOT NULL UNIQUE, url TEXT NOT NULL, title TEXT NOT NULL,"
        " source TEXT, kind TEXT, score REAL NOT NULL DEFAULT 0,"
        " status TEXT NOT NULL DEFAULT 'new', notes TEXT,"
        " created_at REAL NOT NULL, updated_at REAL NOT NULL)")
    conn.execute(
        "INSERT INTO leads(url_hash,url,title,source,kind,score,status,notes,"
        "created_at,updated_at) VALUES('abc','https://example.com/old',"
        "'Old lead','upwork','gig',10,'new','',1,1)")
    conn.commit()
    conn.close()
    store = LeadsStore(db)
    rows = store.list_leads()
    assert len(rows) == 1 and rows[0]["title"] == "Old lead"
    assert rows[0]["lat"] is None and rows[0]["lon"] is None
    lead, created = store.add_lead(
        "https://example.com/new", "New lead", lat=51.51, lon=-0.13,
        location="London")
    assert created is True
    assert lead["lat"] == 51.51 and lead["location"] == "London"


def test_add_lead_rejects_bad_coords(tmp_path):
    store = LeadsStore(tmp_path / "opportunity.db")
    with pytest.raises(ValueError, match="lat"):
        store.add_lead("https://example.com/a", "Bad lat", lat=100, lon=0)
    with pytest.raises(ValueError, match="together"):
        store.add_lead("https://example.com/b", "Lon only", lon=10)


# ---- aggregation ----

def test_globe_items_plots_located_and_counts_unlocated(tmp_path):
    store = _seed(tmp_path)
    result = store.globe_items()
    assert result["ok"] is True
    by_id = {i["id"]: i for i in result["items"]}
    # Dubai lead resolved from its title; explicit lead pinned to Tehran.
    assert by_id["opp:1"]["location_name"] == "Dubai"
    assert by_id["opp:1"]["match"] == "city"
    assert by_id["opp:2"]["lat"] == 35.7 and by_id["opp:2"]["match"] == "explicit"
    # Google program + its finding both resolve to Mountain View.
    assert by_id["bounty:program:1"]["location_name"] == "Mountain View"
    assert by_id["bounty:finding:1"]["severity"] == "high"
    assert by_id["bounty:finding:1"]["location_name"] == "Mountain View"
    # Mystery lead + Acme program have no location.
    assert result["unlocated"] == {"opportunity": 1, "bounty": 1}
    assert result["total"] == 4
    assert result["located"] == {"opportunity": 2, "bounty": 2}


def test_globe_items_limit_caps_plotted_but_counts_all(tmp_path):
    store = _seed(tmp_path)
    result = store.globe_items(limit=1)
    assert len(result["items"]) == 1
    assert result["unlocated"] == {"opportunity": 1, "bounty": 1}


def test_summary_counts(tmp_path):
    store = _seed(tmp_path)
    s = store.summary()
    assert s["opportunity"]["total"] == 3
    assert s["opportunity"]["located"] == 2
    assert s["opportunity"]["unlocated"] == 1
    assert s["opportunity"]["by_source"]["upwork"] == 1
    assert s["bounty"]["programs"] == 2
    assert s["bounty"]["findings"] == 1
    assert s["bounty"]["located"] == 2
    assert s["bounty"]["unlocated"] == 1


def test_aggregation_is_read_only(tmp_path):
    store = _seed(tmp_path)
    store.globe_items()
    store.summary()
    leads = LeadsStore(tmp_path / "data" / "opportunity.db")
    assert leads.count() == 3
    bounty = BountyStore(tmp_path / "data" / "bounty.db")
    assert len(bounty.list_programs()) == 2
    assert len(bounty.list_findings()) == 1


# ---- tools + discovery ----

def _registered_registry(tmp_path):
    from jarvis.plugins.intel.tools import register
    from jarvis.plugins.registry import PluginRegistry

    registry = PluginRegistry(_FakeCfg(tmp_path))
    register(registry)
    return registry


def test_tools_registered_safe_and_work(tmp_path):
    _seed(tmp_path)
    registry = _registered_registry(tmp_path)
    assert registry.get("intel_globe_items") is not None
    assert registry.get("intel_summary") is not None
    assert registry.get("intel_globe_items").permission.name == "SAFE"
    assert registry.get("intel_summary").permission.name == "SAFE"
    items = json.loads(registry.get("intel_globe_items").handler())
    assert items["ok"] is True and items["total"] == 4
    summary = json.loads(registry.get("intel_summary").handler())
    assert summary["opportunity"]["total"] == 3


def test_load_all_discovers_intel(tmp_path):
    from jarvis.plugins.registry import PluginRegistry

    registry = PluginRegistry(_FakeCfg(tmp_path))
    registry.load_all()
    assert "intel" in [p.name for p in registry.plugins()]
    assert registry.get("intel_globe_items") is not None


# ---- HTTP routes (handlers called directly, no server) ----

def _request(cfg):
    from starlette.applications import Starlette
    from starlette.requests import Request

    app = Starlette()
    app.state.cfg = cfg
    # _services() reads all five — the route only uses cfg.
    app.state.orchestrator = None
    app.state.registry = None
    app.state.memory = None
    app.state.agents = None
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/intel/globe",
        "headers": [],
        "app": app,
    }
    return Request(scope)


def test_route_handlers(tmp_path):
    from jarvis.server.routes.intel import intel_globe, intel_summary

    _seed(tmp_path)
    cfg = _FakeCfg(tmp_path)
    globe = asyncio.run(intel_globe(_request(cfg)))
    assert globe["ok"] is True and globe["total"] == 4
    summary = asyncio.run(intel_summary(_request(cfg)))
    assert summary["bounty"]["programs"] == 2


def test_intel_routes_serve_via_test_client(tmp_path):
    """The aggregated router serves both intel endpoints (in-process)."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from jarvis.server.routes import router

    _seed(tmp_path)
    app = FastAPI()
    app.state.cfg = _FakeCfg(tmp_path)
    app.state.orchestrator = None
    app.state.registry = None
    app.state.memory = None
    app.state.agents = None
    app.include_router(router, prefix="/api")
    with TestClient(app) as client:
        globe = client.get("/api/intel/globe")
        assert globe.status_code == 200
        assert globe.json()["total"] == 4
        summary = client.get("/api/intel/summary")
        assert summary.status_code == 200
        assert summary.json()["bounty"]["programs"] == 2
