"""Unit tests for the bug-bounty team agent — no network, no live APIs."""
from __future__ import annotations

import sys
from pathlib import Path

import asyncio

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarvis.plugins.bounty.classification import (  # noqa: E402
    classify_finding, in_scope, sort_findings,
)
from jarvis.plugins.bounty.programs import list_platforms, program_notes  # noqa: E402
from jarvis.plugins.bounty.report import BANNER, render_report  # noqa: E402
from jarvis.plugins.bounty.store import BountyStore  # noqa: E402


# ---- classification ----

def test_sqli_is_critical():
    c = classify_finding("SQL injection in login form", "user input concatenated into query")
    assert c["severity"] == "critical"
    assert c["cwe"] == "CWE-89"
    assert c["needs_verification"] is True


def test_xss_and_ssrf():
    assert classify_finding("Stored XSS in comments")["severity"] == "high"
    assert classify_finding("Reflected XSS in search")["severity"] == "medium"
    assert classify_finding("SSRF in image proxy")["category"].startswith("Server-Side")


def test_unknown_is_low_and_needs_verification():
    c = classify_finding("Weird behaviour on settings page")
    assert c["severity"] == "low"
    assert c["category"] == "Unclassified"
    assert c["needs_verification"] is True


def test_sort_most_severe_first():
    findings = [{"severity": "low"}, {"severity": "critical"}, {"severity": "high"}]
    assert [f["severity"] for f in sort_findings(findings)] == ["critical", "high", "low"]


# ---- scope ----

def test_in_scope_rules():
    scope = ["example.com", "*.api.example.com", "/admin/"]
    assert in_scope("https://example.com/login", scope)
    assert in_scope("sub.example.com", scope)
    assert in_scope("x.api.example.com", scope)
    assert not in_scope("evil.com", scope)
    assert in_scope("api.example.com", scope)  # bare domain covers subdomains
    assert not in_scope("example.com.evil.com", scope)
    assert in_scope("https://example.com/admin/users", scope)


def test_empty_scope_means_nothing_in_scope():
    assert not in_scope("example.com", [])
    assert not in_scope("", ["example.com"])


# ---- programs (static data only) ----

def test_program_notes_are_data_not_api():
    assert "hackerone" in list_platforms()
    assert "bugcrowd" in list_platforms()
    notes = program_notes("hackerone")
    assert notes and "hackerone.com" in notes["url"]
    assert program_notes("not-a-platform") is None


# ---- report ----

def test_report_is_marked_draft():
    finding = {
        "title": "SQLi in login", "target": "example.com", "severity": "critical",
        "category": "SQL Injection", "cwe": "CWE-89", "status": "draft",
        "description": "input concatenated into SQL",
        "evidence": "sleep(5) delayed the response",
        "remediation": "Use parameterised queries.",
    }
    md = render_report(finding, {"name": "Acme", "platform": "hackerone",
                                 "scope": ["example.com"]})
    assert "DO NOT SUBMIT" in md
    assert BANNER.split("**")[1] in md
    assert "SQLi in login" in md and "CWE-89" in md and "example.com" in md
    assert "parameterised queries" in md


# ---- store ----

def test_store_crud_roundtrip(tmp_path):
    store = BountyStore(tmp_path / "bounty.db")
    program = store.add_program("Acme", platform="hackerone",
                                url="https://hackerone.com/acme",
                                scope=["example.com"])
    assert program["id"] == 1
    assert program["scope"] == ["example.com"]
    target = store.add_target(program["id"], "example.com")
    assert target["target"] == "example.com"
    finding = store.add_finding(program["id"], "example.com", "SQLi in login",
                                "input concatenated", "sleep(5)",
                                category="SQL Injection", cwe="CWE-89",
                                severity="critical")
    assert finding["status"] == "draft"  # always draft on creation
    assert store.list_findings(program["id"], status="draft")[0]["id"] == finding["id"]
    updated = store.update_finding_status(finding["id"], "verified")
    assert updated["status"] == "verified"
    assert store.get_program_by_name("Acme")["id"] == program["id"]


def test_store_rejects_bad_input(tmp_path):
    store = BountyStore(tmp_path / "bounty.db")
    with pytest.raises(ValueError):
        store.add_program("Acme", platform="nope")
    with pytest.raises(ValueError):
        store.add_target(999, "example.com")
    program = store.add_program("Acme")
    finding = store.add_finding(program["id"], "example.com", "XSS")
    with pytest.raises(ValueError):
        store.update_finding_status(finding["id"], "shipped")


# ---- plugin registration + agent scope gate (fake registry, real tools) ----

class _FakeCfg:
    def __init__(self, root: Path):
        self._root = root
        self.plugins = {}

    def abs_path(self, p):
        return self._root / p


def _registered_registry(tmp_path):
    from jarvis.plugins.bounty.tools import register
    from jarvis.plugins.registry import PluginRegistry

    registry = PluginRegistry(_FakeCfg(tmp_path))
    register(registry)
    return registry


def test_plugin_registers_bounty_tools(tmp_path):
    registry = _registered_registry(tmp_path)
    for name in ("bounty_add_program", "bounty_scope_check", "bounty_classify_finding",
                 "bounty_record_finding", "bounty_render_report", "bounty_program_notes"):
        assert registry.get(name) is not None, name


def test_agent_refuses_out_of_scope(tmp_path):
    asyncio.run(_agent_refuses_out_of_scope(tmp_path))


async def _agent_refuses_out_of_scope(tmp_path):
    registry = _registered_registry(tmp_path)
    from jarvis.agents.security import SecurityAgent

    agent = SecurityAgent(registry=registry)
    assert [step["step"] for step in agent.plan("example.com")] == [
        "scope", "recon", "triage", "record", "report"]
    program = registry.services["bounty_store"].add_program(
        "Acme", platform="hackerone", scope=["example.com"])
    result = await agent.triage_and_record(
        program["id"], "evil.com", "SQLi", "x", "y")
    assert result["recorded"] is False
    assert registry.services["bounty_store"].list_findings() == []


def test_agent_records_in_scope_draft(tmp_path):
    asyncio.run(_agent_records_in_scope_draft(tmp_path))


async def _agent_records_in_scope_draft(tmp_path):
    registry = _registered_registry(tmp_path)
    from jarvis.agents.security import SecurityAgent

    agent = SecurityAgent(registry=registry)
    program = registry.services["bounty_store"].add_program(
        "Acme", platform="hackerone", scope=["example.com"])
    result = await agent.run(program["id"], "example.com",
                             title="SQL injection in login",
                             description="input concatenated into query")
    assert result["ok"] is True
    findings = registry.services["bounty_store"].list_findings()
    assert len(findings) == 1
    assert findings[0]["status"] == "draft"
    assert findings[0]["severity"] == "critical"
