"""Sync public bounty-program listings into BountyStore via web_search.

Public directories only — no API keys, no authenticated access, no
exploitation, no live-target scanning. Each platform is queried once
through the existing ``web_search`` tool; the returned listings are
parsed into program name + URL + scope hint, deduped by normalized URL,
and stored as *unreviewed* programs with an **empty scope** (empty scope
means nothing is in scope, so nothing can be tested until a human
records the program's real scope on its own page). A platform whose
search fails is skipped, never fatal.

Live network is unverifiable in the sandbox (proxy-blocked); the tests
use a fake ``web_search`` and the live sync must be tried on a
networked machine.
"""
from __future__ import annotations

import inspect
import json
import logging
import re
import sqlite3
from typing import Any, Awaitable, Callable
from urllib.parse import urlparse

from ..common.urls import normalize_url
from .programs import sync_platform_specs
from .store import BountyStore

log = logging.getLogger("jarvis.bounty.sync")

MEDIA_PREFIX = "__JARVIS_MEDIA__"

# Public program directories (no login needed to list them) and the
# site-scoped query used to find their program pages via web_search.
# Single source of truth: jarvis/plugins/bounty/programs.py PROGRAMS —
# this list is derived from it, never copied by hand. ``normalize_url``
# is re-exported here (imported from jarvis.plugins.common.urls) so
# existing ``from .programs_sync import normalize_url`` imports keep
# working; new code should import it from ``..common.urls`` directly.
PLATFORMS: list[dict] = sync_platform_specs()

__all__ = [
    "PLATFORMS",
    "build_web_search_fetcher",
    "list_sync_platforms",
    "normalize_url",
    "parse_search_results",
    "sync_programs",
]

_LINE_RE = re.compile(
    r"^\s*\d+[.)]\s*(?P<title>.+?)\s*[—\-–]\s*(?P<url>https?://\S+)\s*$"
)
_URL_RE = re.compile(r"https?://[^\s)\"'<>]+")


def list_sync_platforms() -> list[str]:
    """Platform keys the sync knows how to query."""
    return [p["platform"] for p in PLATFORMS]


def _clean_title(title: str, platform: str) -> str:
    title = re.sub(r"\s+", " ", (title or "").strip())
    # Drop " | HackerOne" style suffixes the search engine appends.
    title = re.split(r"\s[|\-–—]\s", title)[0].strip()
    return title[:120] if title else platform


def parse_search_results(platform: str, text: str) -> list[dict]:
    """Parse web_search output into program candidates.

    Handles both shapes web_search returns: the ``__JARVIS_MEDIA__``
    JSON payload (``items`` with title/url/snippet) and the plain-text
    fallback (``1. Title — URL`` lines with a snippet line under each).
    Returns dicts with ``name``, ``url`` and ``scope_hint``. The
    platform's own directory URL and bare homepages are skipped — only
    program pages are candidates.
    """
    directory = next(
        (p["directory_url"] for p in PLATFORMS if p["platform"] == platform),
        "",
    )
    skip_urls = {normalize_url(directory)} if directory else set()
    candidates: list[dict] = []
    seen: set[str] = set()

    def _add(title: str, url: str, hint: str) -> None:
        nurl = normalize_url(url)
        if not nurl or nurl in seen or nurl in skip_urls:
            return
        parsed = urlparse(nurl)
        if not parsed.path or parsed.path == "/":
            return  # bare homepage, not a program page
        seen.add(nurl)
        candidates.append({
            "name": _clean_title(title, platform),
            "url": nurl,
            "scope_hint": re.sub(r"\s+", " ", (hint or "").strip())[:200],
        })

    if not text:
        return []
    # 1. Media payload: __JARVIS_MEDIA__{"kind": ..., "items": [...]}
    idx = text.find(MEDIA_PREFIX)
    if idx != -1:
        try:
            payload = json.loads(text[idx + len(MEDIA_PREFIX):].strip())
            for item in payload.get("items", []) or []:
                _add(str(item.get("title", "")),
                     str(item.get("url", "")),
                     str(item.get("snippet", "")))
            return candidates
        except (ValueError, AttributeError):
            pass  # fall through to plain-text parsing
    # 2. Plain text: "1. Title — URL" then an optional snippet line.
    pending: dict | None = None
    for line in text.splitlines():
        m = _LINE_RE.match(line)
        if m:
            if pending is not None:
                _add(pending["title"], pending["url"], pending["hint"])
            pending = {"title": m.group("title"), "url": m.group("url"),
                       "hint": ""}
            continue
        if pending is not None and line.strip():
            pending["hint"] = (pending["hint"] + " " + line.strip()).strip()
    if pending is not None:
        _add(pending["title"], pending["url"], pending["hint"])
    return candidates


def build_web_search_fetcher(registry):
    """Return ``search(query, max_results) -> str`` wired to the
    registered ``web_search`` tool. Raises if the tool is missing."""
    async def search(query: str, max_results: int = 5) -> str:
        tool = registry.get("web_search")
        if tool is None:
            raise RuntimeError("web_search tool is not registered")
        return await tool.invoke({"query": query, "max_results": max_results})
    return search


async def sync_programs(
    store: BountyStore,
    search: Callable[..., Any | Awaitable[Any]] | None = None,
    platforms: list[str] | None = None,
) -> dict:
    """Sync public program listings into ``store``.

    ``search`` is a callable ``(query, max_results) -> str`` (sync or
    async); pass ``build_web_search_fetcher(registry)`` in production.
    With no ``search`` the sync is a documented no-op. Returns a summary
    dict: ``added``, ``duplicates``, ``skipped`` (platforms whose search
    failed) and the added program names.
    """
    wanted = [p for p in PLATFORMS
              if platforms is None or p["platform"] in set(platforms or [])]
    unknown = sorted(set(platforms or []) - {p["platform"] for p in PLATFORMS})
    if unknown:
        raise ValueError(f"unknown sync platform(s): {unknown} "
                         f"(use one of {list_sync_platforms()})")
    if search is None:
        return {
            "ok": True, "added": 0, "duplicates": 0, "skipped": [],
            "programs": [],
            "note": "No search function configured — pass "
                    "build_web_search_fetcher(registry) to sync_programs.",
        }
    known_urls = {normalize_url(p.get("url", "")) for p in store.list_programs()}
    known_urls.discard("")
    added: list[str] = []
    duplicates = 0
    skipped: list[str] = []
    for spec in wanted:
        platform = spec["platform"]
        try:
            result = search(spec["query"], max_results=5)
            if inspect.isawaitable(result):
                result = await result
        except Exception as exc:  # noqa: BLE001 — one bad platform skips
            log.warning("bounty sync: %s search failed, skipping: %s",
                        platform, exc)
            skipped.append(platform)
            continue
        for cand in parse_search_results(platform, str(result or "")):
            nurl = normalize_url(cand["url"])
            if nurl in known_urls:
                duplicates += 1
                continue
            notes = (
                f"Synced from the {spec['name']} public directory; "
                f"UNREVIEWED — verify the scope on the program page before "
                f"testing anything. Scope hint: "
                f"{cand['scope_hint'] or 'none given'}"
            )
            try:
                program = store.add_program(
                    cand["name"], platform=platform, url=nurl,
                    scope=[], notes=notes,
                )
            except (sqlite3.IntegrityError, ValueError):
                duplicates += 1  # same name already recorded
                continue
            known_urls.add(nurl)
            added.append(program["name"])
    log.info("bounty sync: %d added, %d duplicates, skipped=%s",
             len(added), duplicates, skipped)
    return {
        "ok": True,
        "added": len(added),
        "duplicates": duplicates,
        "skipped": skipped,
        "programs": added,
    }
