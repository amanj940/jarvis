"""Regression tests for the SecurityAgent fixes (worker E).

Covers the three bugs fixed in ``jarvis/agents/security.py``:

1. ``run()`` must report ``ok: False`` when recording a finding fails
   (it previously returned ``ok: True`` unconditionally after the scope
   gate passed).
2. ``bounty_sync_programs`` must be in ``ALLOWED_TOOLS``.
3. The scope gate must use exact/structured matching, not
   ``str.startswith`` — a verdict / scope that merely starts with an
   allowed prefix must NOT pass.

Sync test functions drive the async agent with ``asyncio.run`` so no
pytest-asyncio plugin is required.
"""
from __future__ import annotations

import asyncio

import pytest

from jarvis.agents.security import (
    ALLOWED_TOOLS,
    SecurityAgent,
    is_in_scope_detail,
    matches_scope,
)


class _FakeTool:
    """Minimal async tool stub returning a canned response."""

    def __init__(self, response: str, calls: list | None = None):
        self.response = response
        self.calls = calls if calls is not None else []

    async def invoke(self, args: dict) -> str:
        self.calls.append(args)
        return self.response


class _FakeRegistry:
    def __init__(self, tools: dict):
        self._tools = tools

    def get(self, name: str):
        return self._tools.get(name)


def _agent(scope_detail: str = "IN SCOPE",
           record_response: str = "recorded as DRAFT (id 1)",
           classify_response: str = "classified: medium",
           record_calls: list | None = None) -> SecurityAgent:
    tools = {
        "bounty_scope_check": _FakeTool(scope_detail),
        "bounty_classify_finding": _FakeTool(classify_response),
        "bounty_record_finding": _FakeTool(record_response, record_calls),
        "web_search": _FakeTool("search results"),
        "scan_project": _FakeTool("scan summary"),
    }
    return SecurityAgent(registry=_FakeRegistry(tools))


# --- Bug 1: run() must report failure when recording fails -------------------

def test_run_reports_failure_when_record_fails():
    agent = _agent(record_response="failed to record finding: database error")
    result = asyncio.run(agent.run(1, "example.com", title="XSS in search"))
    assert result["ok"] is False
    assert result["stopped_at"] == "record"
    assert result["triage"]["recorded"] is False


def test_run_reports_failure_when_record_tool_missing():
    # Registry without bounty_record_finding: _invoke reports unavailable,
    # which contains no "recorded as DRAFT" marker -> not recorded.
    tools = {
        "bounty_scope_check": _FakeTool("IN SCOPE"),
        "bounty_classify_finding": _FakeTool("classified: medium"),
        "web_search": _FakeTool("search results"),
    }
    agent = SecurityAgent(registry=_FakeRegistry(tools))
    result = asyncio.run(agent.run(1, "example.com", title="XSS in search"))
    assert result["ok"] is False
    assert result["stopped_at"] == "record"


def test_run_ok_when_record_succeeds():
    agent = _agent()
    result = asyncio.run(agent.run(1, "example.com", title="XSS in search"))
    assert result["ok"] is True
    assert result["stopped_at"] is None
    assert result["triage"]["recorded"] is True


def test_run_without_title_still_ok():
    agent = _agent()
    result = asyncio.run(agent.run(1, "example.com"))
    assert result["ok"] is True
    assert "triage" not in result


# --- Bug 2: bounty_sync_programs is allowed ----------------------------------

def test_bounty_sync_programs_in_allowed_tools():
    assert "bounty_sync_programs" in ALLOWED_TOOLS
    agent = _agent()
    assert "bounty_sync_programs" in agent.allowed_tools


# --- Bug 3a: scope-gate verdict parsing (exact, not prefix) ------------------

@pytest.mark.parametrize("detail", [
    "IN SCOPE",
    "IN SCOPE: example.com",
    "IN SCOPE example.com is in scope",
    "IN SCOPE\nexample.com",
    '{"in_scope": true}',
    '{"in_scope": true, "scope": "example.com"}',
])
def test_scope_gate_accepts_exact_scopes(detail):
    assert is_in_scope_detail(detail) is True


@pytest.mark.parametrize("detail", [
    "IN SCOPEX",
    "IN SCOPE-attacker.com",
    "IN SCOPE.evil.com",
    "IN SCOPEISH",
    "IN SCOPE2",
    "OUT OF SCOPE",
    "NOT IN SCOPE",
    "in scope",  # verdict tokens are case-sensitive; lowercase is not a verdict
    "",
    "   ",
    '{"in_scope": "true"}',  # string, not the JSON boolean true
    '{"in_scope": 1}',
    '{"in_scope": false}',
    '{"scope": "example.com"}',  # no in_scope field at all
    "{not json",
    None,
    123,
])
def test_scope_gate_rejects_prefix_tricks(detail):
    assert is_in_scope_detail(detail) is False


def test_check_scope_rejects_prefix_trick_verdict():
    agent = _agent(scope_detail="IN SCOPEX (spoofed)")
    result = asyncio.run(agent.check_scope(1, "example.com"))
    assert result["in_scope"] is False


def test_run_stops_at_scope_on_prefix_trick_verdict_and_records_nothing():
    record_calls: list = []
    agent = _agent(scope_detail="IN SCOPE-attacker.com", record_calls=record_calls)
    result = asyncio.run(agent.run(1, "example.com", title="XSS in search"))
    assert result["ok"] is False
    assert result["stopped_at"] == "scope"
    assert record_calls == []


# --- Bug 3b: structured target-vs-scope matching -----------------------------

@pytest.mark.parametrize("target, scope", [
    ("example.com", "example.com"),
    ("Example.COM", "example.com"),  # case-insensitive
    ("https://example.com/path", "example.com"),
    ("example.com.", "example.com"),  # trailing dot
    ("sub.example.com", "*.example.com"),
    ("deep.sub.example.com", "*.example.com"),
])
def test_matches_scope_accepts_exact_scopes(target, scope):
    assert matches_scope(target, scope) is True


@pytest.mark.parametrize("target, scope", [
    ("example.com.evil.com", "example.com"),
    ("fakeexample.com", "example.com"),
    ("example.com.attacker.com", "example.com"),
    ("sub.example.com", "example.com"),  # subdomain is not the exact scope
    ("example.com", "*.example.com"),  # wildcard needs a real subdomain
    ("example.com.evil.com", "*.example.com"),
    ("evilsub.example.com.evil.com", "*.example.com"),
    ("", "example.com"),
    ("example.com", ""),
])
def test_matches_scope_rejects_prefix_tricks(target, scope):
    assert matches_scope(target, scope) is False
