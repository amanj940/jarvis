"""Unit tests for bounty program sync — no network, fake web_search."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarvis.plugins.base import Tool  # noqa: E402
from jarvis.plugins.bounty.programs_sync import (  # noqa: E402
    build_web_search_fetcher, normalize_url, parse_search_results,
    sync_programs,
)
from jarvis.plugins.bounty.store import BountyStore  # noqa: E402
from jarvis.plugins.registry import PluginRegistry  # noqa: E402

PLAIN_RESULTS = {
    "hackerone": (
        "Found 2 results for 'site:hackerone.com/directory bug bounty program':\n"
        "1. Acme Corp — https://hackerone.com/acme\n"
        "   Bug bounty program for Acme web and API. Scope includes *.acme.com.\n"
        "2. Beta Ltd — https://hackerone.com/beta\n"
        "   Scope: beta.com and *.beta.com.\n"
    ),
    "bugcrowd": (
        "Found 2 results for 'site:bugcrowd.com/programs bug bounty':\n"
        "1. Gamma Inc — https://bugcrowd.com/gamma\n"
        "   Public program, scope gamma.io.\n"
        "2. Delta LLC — https://bugcrowd.com/delta\n"
        "   Scope: *.delta.app.\n"
    ),
    "intigriti": (
        "Found 2 results for 'site:intigriti.com/programs bug bounty':\n"
        "1. Epsilon BV — https://intigriti.com/programs/epsilon\n"
        "   European program, scope epsilon.eu.\n"
        "2. Zeta GmbH — https://intigriti.com/programs/zeta\n"
        "   Scope: zeta.de.\n"
    ),
    "yeswehack": (
        "Found 2 results for 'site:yeswehack.com/programs bug bounty':\n"
        "1. Eta SAS — https://yeswehack.com/programs/eta\n"
        "   Scope: eta.fr.\n"
        "2. Theta Oy — https://yeswehack.com/programs/theta\n"
        "   Scope: theta.fi.\n"
    ),
}


class FakeSearch:
    """Sync fake web_search: canned text per platform, optional failures."""

    def __init__(self, fail: set[str] | None = None):
        self.fail = set(fail or [])
        self.calls: list[str] = []

    def __call__(self, query: str, max_results: int = 5) -> str:
        self.calls.append(query)
        for platform, text in PLAIN_RESULTS.items():
            if platform in query:
                if platform in self.fail:
                    raise RuntimeError(f"search failed for {platform}")
                return text
        return "web search: no results"


def _run(store, search, **kwargs):
    return asyncio.run(sync_programs(store, search=search, **kwargs))


# ---- sync behaviour ----

def test_first_sync_adds_programs(tmp_path):
    store = BountyStore(tmp_path / "bounty.db")
    result = _run(store, FakeSearch())
    assert result["ok"] is True
    assert result["added"] == 8
    assert result["duplicates"] == 0
    assert result["skipped"] == []
    programs = store.list_programs()
    assert len(programs) == 8
    acme = store.get_program_by_name("Acme Corp")
    assert acme is not None
    assert acme["platform"] == "hackerone"
    assert acme["url"] == "https://hackerone.com/acme"
    assert acme["scope"] == []  # unreviewed: empty scope = nothing in scope
    assert "UNREVIEWED" in acme["notes"]
    assert "*.acme.com" in acme["notes"]  # scope hint kept in notes


def test_second_sync_dedups_to_zero_new(tmp_path):
    store = BountyStore(tmp_path / "bounty.db")
    first = _run(store, FakeSearch())
    second = _run(store, FakeSearch())
    assert first["added"] == 8
    assert second["added"] == 0
    assert second["duplicates"] == 8
    assert len(store.list_programs()) == 8


def test_failing_platform_skipped_not_fatal(tmp_path):
    store = BountyStore(tmp_path / "bounty.db")
    result = _run(store, FakeSearch(fail={"intigriti"}))
    assert result["ok"] is True
    assert result["skipped"] == ["intigriti"]
    assert result["added"] == 6
    assert {p["platform"] for p in store.list_programs()} == {
        "hackerone", "bugcrowd", "yeswehack"}


def test_sync_without_search_is_noop(tmp_path):
    store = BountyStore(tmp_path / "bounty.db")
    result = asyncio.run(sync_programs(store, search=None))
    assert result["ok"] is True
    assert result["added"] == 0
    assert "note" in result
    assert store.list_programs() == []


def test_unknown_platform_rejected(tmp_path):
    store = BountyStore(tmp_path / "bounty.db")
    with pytest.raises(ValueError):
        _run(store, FakeSearch(), platforms=["nope"])


def test_sync_single_platform_only(tmp_path):
    store = BountyStore(tmp_path / "bounty.db")
    result = _run(store, FakeSearch(), platforms=["yeswehack"])
    assert result["added"] == 2
    assert all(p["platform"] == "yeswehack" for p in store.list_programs())


# ---- parsing ----

def test_parse_plain_text_skips_directory_and_homepage():
    text = (
        "Found 4 results:\n"
        "1. HackerOne Directory — https://hackerone.com/directory\n"
        "   The full program directory.\n"
        "2. HackerOne — https://hackerone.com\n"
        "   Homepage.\n"
        "3. Acme Corp — https://hackerone.com/acme\n"
        "   Scope includes *.acme.com.\n"
        "4. No link here\n"
        "   A result without a URL is ignored.\n"
    )
    parsed = parse_search_results("hackerone", text)
    assert [(c["name"], c["url"]) for c in parsed] == [
        ("Acme Corp", "https://hackerone.com/acme")]
    assert "*.acme.com" in parsed[0]["scope_hint"]


def test_parse_media_payload():
    payload = "__JARVIS_MEDIA__" + json.dumps({
        "kind": "search",
        "items": [
            {"title": "Acme Corp | HackerOne",
             "url": "https://hackerone.com/acme",
             "snippet": "Scope: *.acme.com"},
            {"title": "No URL program", "url": "", "snippet": "skip me"},
        ],
        "summary": "2 items",
    })
    parsed = parse_search_results("hackerone", payload)
    assert len(parsed) == 1
    assert parsed[0]["name"] == "Acme Corp"
    assert parsed[0]["url"] == "https://hackerone.com/acme"
    assert "*.acme.com" in parsed[0]["scope_hint"]


def test_normalize_url():
    assert normalize_url("HTTPS://HackerOne.COM/Acme/?utm_source=x#frag") == \
        "https://hackerone.com/Acme"
    assert normalize_url("https://example.com/a/?fbclid=1&x=2") == \
        "https://example.com/a?x=2"
    assert normalize_url("not a url") == ""
    assert normalize_url("") == ""


# ---- tool wiring (fake registry, real tools) ----

class _FakeCfg:
    def __init__(self, root: Path):
        self._root = root
        self.plugins = {}

    def abs_path(self, p):
        return self._root / p


def _registered_registry(tmp_path):
    from jarvis.plugins.bounty.tools import register

    registry = PluginRegistry(_FakeCfg(tmp_path))
    register(registry)
    return registry


def test_bounty_sync_programs_tool_registered(tmp_path):
    registry = _registered_registry(tmp_path)
    assert registry.get("bounty_sync_programs") is not None


def test_tool_runs_sync_through_fake_web_search(tmp_path):
    asyncio.run(_tool_runs_sync(tmp_path))


async def _tool_runs_sync(tmp_path):
    registry = _registered_registry(tmp_path)
    fake = FakeSearch()

    async def _fake_web_search(query: str, max_results: int = 5) -> str:
        return fake(query, max_results)

    registry.add(Tool(
        name="web_search", description="fake", parameters={},
        handler=_fake_web_search,
    ))
    tool = registry.get("bounty_sync_programs")
    first = await tool.invoke({})
    assert "8 new" in first
    assert "0 duplicates" in first
    second = await tool.invoke({})
    assert "0 new" in second
    assert "8 duplicates" in second


def test_fetcher_raises_without_web_search(tmp_path):
    registry = _registered_registry(tmp_path)
    fetcher = build_web_search_fetcher(registry)
    with pytest.raises(RuntimeError, match="web_search"):
        asyncio.run(fetcher("site:hackerone.com/directory bug bounty"))
