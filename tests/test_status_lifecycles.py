"""Status-lifecycle tools for bounty findings and opportunity leads.

Findings used to be stuck in ``draft`` and leads stuck in ``new`` because
no tool ever called the stores' status methods
(``BountyStore.update_finding_status`` / ``LeadsStore.update_status``).
These tests drive the new ``bounty_update_finding_status`` and
``opportunity_update_lead_status`` tools through the real registry with
tmp SQLite stores — no network, no live APIs, no publishing.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarvis.core.permissions import Permission  # noqa: E402
from jarvis.plugins.bounty.store import VALID_STATUSES as BOUNTY_STATUSES  # noqa: E402
from jarvis.plugins.opportunity.leads import (  # noqa: E402
    VALID_STATUSES as LEAD_STATUSES,
    LeadsStore,
)
from jarvis.plugins.registry import PluginRegistry  # noqa: E402


class _FakeCfg:
    def __init__(self, root: Path):
        self._root = root
        self.plugins = {}

    def abs_path(self, p):
        return self._root / p


def _bounty_registry(tmp_path):
    from jarvis.plugins.bounty.tools import register

    registry = PluginRegistry(_FakeCfg(tmp_path))
    register(registry)
    return registry


def _opportunity_registry(tmp_path):
    from jarvis.plugins.opportunity.tools import register

    registry = PluginRegistry(_FakeCfg(tmp_path))
    register(registry)
    return registry


def _invoke(registry, name, args):
    tool = registry.get(name)
    assert tool is not None, name
    return asyncio.run(tool.invoke(args))


def _make_finding(store, title="SQLi in login"):
    program = store.add_program("Acme", platform="hackerone",
                                scope=["example.com"])
    return store.add_finding(program["id"], "example.com", title,
                             "input concatenated", "sleep(5)",
                             category="SQL Injection", cwe="CWE-89",
                             severity="critical")


def _make_lead(store, url="https://example.com/jobs/1",
               title="Backend engineer role"):
    lead, created = store.add_lead(url, title, source="example",
                                   kind="job", score=8.0)
    assert created
    return lead


# ---- bounty: registration ----

def test_bounty_status_tool_is_registered(tmp_path):
    registry = _bounty_registry(tmp_path)
    tool = registry.get("bounty_update_finding_status")
    assert tool is not None
    assert tool.permission is Permission.CAUTION  # state change, not a read
    assert tool.parameters["properties"]["status"]["enum"] == sorted(BOUNTY_STATUSES)
    assert tool.parameters["required"] == ["finding_id", "status"]


# ---- bounty: transitions ----

def test_bounty_draft_to_triaged(tmp_path):
    registry = _bounty_registry(tmp_path)
    store = registry.services["bounty_store"]
    finding = _make_finding(store)
    assert finding["status"] == "draft"

    result = _invoke(registry, "bounty_update_finding_status",
                     {"finding_id": finding["id"], "status": "triaged"})
    assert "draft -> triaged" in result
    assert "nothing submitted" in result
    updated = store.get_finding(finding["id"])
    assert updated["status"] == "triaged"
    # status change only — nothing else about the finding moved
    assert updated["title"] == finding["title"]
    assert updated["severity"] == finding["severity"]


def test_bounty_full_lifecycle(tmp_path):
    registry = _bounty_registry(tmp_path)
    store = registry.services["bounty_store"]
    finding = _make_finding(store)
    for status in ("verified", "reported", "triaged", "resolved"):
        result = _invoke(registry, "bounty_update_finding_status",
                         {"finding_id": finding["id"], "status": status})
        assert "error" not in result, result
        assert store.get_finding(finding["id"])["status"] == status


def test_bounty_terminal_statuses_accepted(tmp_path):
    registry = _bounty_registry(tmp_path)
    store = registry.services["bounty_store"]
    program = store.add_program("Acme", platform="hackerone",
                                scope=["example.com"])
    for status in ("duplicate", "out_of_scope", "rejected"):
        finding = store.add_finding(program["id"], "example.com",
                                    f"finding for {status}")
        result = _invoke(registry, "bounty_update_finding_status",
                         {"finding_id": finding["id"], "status": status})
        assert "error" not in result, result
        assert store.get_finding(finding["id"])["status"] == status


def test_bounty_status_is_normalised(tmp_path):
    registry = _bounty_registry(tmp_path)
    store = registry.services["bounty_store"]
    finding = _make_finding(store)
    result = _invoke(registry, "bounty_update_finding_status",
                     {"finding_id": finding["id"], "status": "TRIAGED"})
    assert "error" not in result, result
    assert store.get_finding(finding["id"])["status"] == "triaged"


# ---- bounty: rejection paths ----

def test_bounty_invalid_status_rejected(tmp_path):
    registry = _bounty_registry(tmp_path)
    store = registry.services["bounty_store"]
    finding = _make_finding(store)
    result = _invoke(registry, "bounty_update_finding_status",
                     {"finding_id": finding["id"], "status": "shipped"})
    assert result.startswith("error: unknown status")
    assert "triaged" in result  # valid statuses are listed
    assert "NOT changed" in result
    assert store.get_finding(finding["id"])["status"] == "draft"


def test_bounty_unknown_finding_id(tmp_path):
    registry = _bounty_registry(tmp_path)
    store = registry.services["bounty_store"]
    result = _invoke(registry, "bounty_update_finding_status",
                     {"finding_id": 9999, "status": "triaged"})
    assert result.startswith("error: no finding with id 9999")
    assert "NOT changed" in result
    assert store.list_findings() == []


# ---- opportunity: registration ----

def test_opportunity_status_tool_is_registered(tmp_path):
    registry = _opportunity_registry(tmp_path)
    tool = registry.get("opportunity_update_lead_status")
    assert tool is not None
    assert tool.permission is Permission.CAUTION  # state change, not a read
    assert tool.parameters["properties"]["status"]["enum"] == sorted(LEAD_STATUSES)
    assert tool.parameters["required"] == ["lead_id", "status"]


# ---- opportunity: transitions ----

def test_opportunity_new_to_won(tmp_path):
    registry = _opportunity_registry(tmp_path)
    store = LeadsStore(tmp_path / "data" / "opportunity.db")
    lead = _make_lead(store)
    assert lead["status"] == "new"

    previous = "new"
    for status in ("reviewing", "pursuing", "won"):
        payload = json.loads(_invoke(
            registry, "opportunity_update_lead_status",
            {"lead_id": lead["id"], "status": status}))
        assert payload["ok"] is True, payload
        assert payload["previous_status"] == previous
        assert payload["lead"]["status"] == status
        assert store.get(lead["id"])["status"] == status
        previous = status
    # status change only — nothing else about the lead moved
    assert store.get(lead["id"])["title"] == lead["title"]
    assert store.get(lead["id"])["url"] == lead["url"]


def test_opportunity_lost_and_ignored(tmp_path):
    registry = _opportunity_registry(tmp_path)
    store = LeadsStore(tmp_path / "data" / "opportunity.db")
    for i, status in enumerate(("lost", "ignored")):
        lead = _make_lead(store, url=f"https://example.com/jobs/{i + 10}")
        payload = json.loads(_invoke(
            registry, "opportunity_update_lead_status",
            {"lead_id": lead["id"], "status": status}))
        assert payload["ok"] is True, payload
        assert store.get(lead["id"])["status"] == status


def test_opportunity_same_status_is_ok(tmp_path):
    registry = _opportunity_registry(tmp_path)
    store = LeadsStore(tmp_path / "data" / "opportunity.db")
    lead = _make_lead(store)
    payload = json.loads(_invoke(
        registry, "opportunity_update_lead_status",
        {"lead_id": lead["id"], "status": "new"}))
    assert payload["ok"] is True
    assert payload["previous_status"] == "new"
    assert payload["lead"]["status"] == "new"


# ---- opportunity: rejection paths ----

def test_opportunity_invalid_status_rejected(tmp_path):
    registry = _opportunity_registry(tmp_path)
    store = LeadsStore(tmp_path / "data" / "opportunity.db")
    lead = _make_lead(store)
    payload = json.loads(_invoke(
        registry, "opportunity_update_lead_status",
        {"lead_id": lead["id"], "status": "shipped"}))
    assert payload["ok"] is False
    assert "unknown status" in payload["error"]
    assert payload["valid_statuses"] == sorted(LEAD_STATUSES)
    assert store.get(lead["id"])["status"] == "new"


def test_opportunity_unknown_lead_id(tmp_path):
    registry = _opportunity_registry(tmp_path)
    payload = json.loads(_invoke(
        registry, "opportunity_update_lead_status",
        {"lead_id": 9999, "status": "reviewing"}))
    assert payload["ok"] is False
    assert "no lead with id 9999" in payload["error"]
