"""Daily opportunity scan — the job the Phase 4 scheduler runs.

The scan itself is pure orchestration over an injected ``fetcher``:
a callable returning candidate dicts (``url``, ``title``, ``source``,
``kind``, optional ``description``). The production fetcher is
``build_web_search_fetcher(registry)``: one ``web_search`` query per
curated source (see ``source_queries``), search-result snippets only —
no page is ever fetched, no login, no keys, no paid API. Wire it by
passing it — or a ``registry`` — to ``register_opportunity_daily_job``.
With no fetcher the scan is a documented no-op that returns
``scanned: 0`` instead of pretending to work.

Registration with the Phase 4 scheduler:
``register_opportunity_daily_job(store, scheduler, leads_store)`` creates
a persistent ``TaskStore`` task (kind ``opportunity_scan``, cron
``0 9 * * *`` = daily 09:00 UTC) and registers its handler, so the scan
survives restarts exactly like reminders and notes do. Registration is
idempotent: calling it again (e.g. on every server boot) reuses the
existing pending task instead of creating a duplicate.
"""
from __future__ import annotations

import inspect
import json
import logging
import re
from typing import Any, Callable
from urllib.parse import urlparse

from .leads import LeadsStore, normalize_url
from .scoring import score_lead
from .sources import DEFAULT_KEYWORDS, list_sources

log = logging.getLogger("jarvis.opportunity")

DAILY_SCHEDULE = "0 9 * * *"  # daily 09:00 UTC

# Prefix the web_search tool puts on structured results:
# ``__JARVIS_MEDIA__`` + JSON {"kind", "items": [...], "summary"}.
MEDIA_PREFIX = "__JARVIS_MEDIA__"

# Bounded by design: one query per source, few results each. web_search
# itself also caches successful results for 10 minutes.
MAX_RESULTS_PER_QUERY = 5

# Search phrase per source kind — combined with a ``site:`` restriction
# on the source's own domain, so each query stays on that source's
# public pages. A kind with no phrase falls back to the source keywords.
QUERY_PHRASES = {
    "bug_bounty": "bug bounty programs",
    "freelance": "freelance remote jobs",
    "marketplace": "new product launches",
    "news": "startup launches",
    "trend": "",
}

# Plain-text rendering of web_search results (see plugins/web_tools.py):
#   "Found N results for 'q':"
#   "1. Title — https://example.com/x"
#   "   snippet line"
_RESULT_LINE_RE = re.compile(r"^\d+\.\s+(.*?)\s+[—-]\s+(https?://\S+)\s*$")


def format_alerts(leads: list[dict], limit: int = 5) -> str:
    """One short alert line per top lead, for the morning summary."""
    if not leads:
        return "No new opportunities."
    lines = ["New opportunities:"]
    for lead in leads[:limit]:
        lines.append(
            f"- [{lead.get('score', 0):.0f}] {lead.get('title', '')} "
            f"({lead.get('source', '')}) — {lead.get('url', '')}"
        )
    return "\n".join(lines)


def source_queries(sources: list[dict] | None = None) -> list[dict]:
    """One bounded web_search query per active source.

    Derived from the curated list in ``sources.py``, so editing a source
    (or its keywords) automatically changes what the scan asks for.
    Each entry is ``{"name", "kind", "query"}``.
    """
    out: list[dict] = []
    for s in (sources if sources is not None else list_sources()):
        domain = urlparse(s.get("url") or "").netloc
        phrase = QUERY_PHRASES.get(s.get("kind") or "", "")
        if not phrase:
            phrase = " ".join(s.get("keywords") or [])
        query = f"site:{domain} {phrase}".strip() if domain else phrase
        if not query:
            continue
        out.append({"name": s["name"], "kind": s["kind"], "query": query})
    return out


def parse_web_search_result(text: str | None) -> list[dict]:
    """Parse a ``web_search`` tool result string into candidate dicts.

    Success is ``__JARVIS_MEDIA__`` + JSON whose ``items`` carry
    ``url``/``title``/``snippet``/``source``. Anything else — a failure
    message, "no results", malformed JSON — yields ``[]``. A plain-text
    rendering of the same results (``N. title — url`` lines with
    indented snippets) is parsed as a fallback.
    """
    if not text:
        return []
    text = str(text)
    if text.startswith(MEDIA_PREFIX):
        try:
            payload = json.loads(text[len(MEDIA_PREFIX):])
        except (ValueError, TypeError):
            return []
        candidates: list[dict] = []
        for item in (payload or {}).get("items") or []:
            url = str(item.get("url") or "").strip()
            title = str(item.get("title") or "").strip()
            if not url or not title:
                continue
            candidates.append({
                "url": url,
                "title": title,
                "description": str(item.get("snippet") or ""),
                "source": str(item.get("source") or ""),
            })
        return candidates
    # Plain-text fallback.
    candidates = []
    current: dict | None = None
    for line in text.splitlines():
        m = _RESULT_LINE_RE.match(line.strip())
        if m:
            if current:
                candidates.append(current)
            current = {"url": m.group(2).strip(), "title": m.group(1).strip(),
                       "description": "", "source": ""}
            continue
        if current and line[:1] in (" ", "\t") and line.strip():
            current["description"] = (current["description"] + " " + line.strip()).strip()
    if current:
        candidates.append(current)
    return candidates


def build_web_search_fetcher(registry, queries: list[dict] | None = None,
                             max_results_per_query: int = MAX_RESULTS_PER_QUERY):
    """Build the production fetcher over the existing ``web_search`` tool.

    Returns an async callable taking no arguments and returning candidate
    dicts (``url``, ``title``, ``source``, ``kind``, ``description``).
    The ``web_search`` tool is resolved at call time, so plugin
    registration order does not matter. One query per source, bounded
    result counts; a failing source is logged and skipped, never killing
    the scan; candidates are deduped by normalised URL within the run.
    Only search-result snippets are read — no page is ever fetched, no
    login, no keys. Links may still point at pages that need an account
    to view or apply (e.g. Upwork, HackerOne); those are leads for a
    human to review, never something Jarvis acts on.
    """
    search_queries = list(queries) if queries is not None else source_queries()

    async def fetch() -> list[dict]:
        tool = registry.get("web_search") if registry is not None else None
        if tool is None:
            log.warning(
                "opportunity fetcher: web_search tool unavailable — scan found nothing")
            return []
        candidates: list[dict] = []
        seen: set[str] = set()
        for q in search_queries:
            try:
                result = await tool.invoke({
                    "query": q["query"],
                    "max_results": max_results_per_query,
                })
            except Exception as e:  # noqa: BLE001
                log.warning("opportunity fetcher: query %r failed: %s", q["query"], e)
                continue
            for cand in parse_web_search_result(str(result)):
                url = str(cand.get("url") or "")
                if not url:
                    continue
                try:
                    key = normalize_url(url)
                except Exception:  # noqa: BLE001
                    continue
                if key in seen:
                    continue
                seen.add(key)
                cand["url"] = url
                cand["source"] = q["name"]
                cand["kind"] = q["kind"]
                candidates.append(cand)
        return candidates

    return fetch


async def run_opportunity_scan(
    leads_store: LeadsStore,
    fetcher: Callable[[], Any] | None = None,
    keywords: list[str] | None = None,
    source_weight: float = 1.0,
) -> dict:
    """Run one scan. ``fetcher`` returns candidate dicts (sync or async)."""
    kws = keywords or DEFAULT_KEYWORDS
    if fetcher is None:
        return {
            "ok": True, "scanned": 0, "new": 0, "duplicates": 0,
            "note": "No fetcher configured — wire one (e.g. over web_search) "
                    "and pass it to run_opportunity_scan; see docs/youtube-opportunity.md.",
            "alerts": "No new opportunities.",
        }
    result = fetcher()
    if inspect.isawaitable(result):
        result = await result
    candidates = list(result or [])
    new_leads: list[dict] = []
    duplicates = 0
    for cand in candidates:
        url = str(cand.get("url") or "")
        title = str(cand.get("title") or "")
        if not url or not title:
            continue
        scored = score_lead(title, cand.get("description", ""), kws, source_weight)
        lead, created = leads_store.add_lead(
            url=url, title=title, source=str(cand.get("source") or ""),
            kind=str(cand.get("kind") or ""),
            score=scored["score"], notes="; ".join(scored["reasons"]),
        )
        if created:
            new_leads.append(lead)
        else:
            duplicates += 1
    new_leads.sort(key=lambda l: l.get("score", 0), reverse=True)
    log.info("opportunity scan: %d scanned, %d new, %d duplicates",
             len(candidates), len(new_leads), duplicates)
    return {
        "ok": True,
        "scanned": len(candidates),
        "new": len(new_leads),
        "duplicates": duplicates,
        "top": new_leads[:5],
        "alerts": format_alerts(new_leads),
    }


def register_opportunity_daily_job(task_store, scheduler, leads_store: LeadsStore,
                                   fetcher: Callable[[], Any] | None = None,
                                   schedule: str = DAILY_SCHEDULE,
                                   registry=None) -> dict:
    """Create the persistent daily task and register its scheduler handler.

    Pass a ``fetcher`` directly, or a ``registry`` — with a registry and
    no fetcher, the production ``web_search`` fetcher is built from it
    (``build_web_search_fetcher``). An explicit fetcher always wins.

    Idempotent: the server calls this on every boot, so an existing
    pending ``opportunity_scan`` task is reused (and re-aligned to the
    requested schedule if it drifted) instead of creating a duplicate.
    """
    if fetcher is None and registry is not None:
        fetcher = build_web_search_fetcher(registry)

    async def _handler(task: dict) -> str:
        summary = await run_opportunity_scan(leads_store, fetcher=fetcher)
        return summary.get("alerts", "")

    scheduler.register_handler("opportunity_scan", _handler)
    existing = [
        t for t in task_store.list_tasks(kind="opportunity_scan", status="pending")
    ]
    if existing:
        task = existing[0]
        if task.get("schedule") != schedule:
            task = task_store.update(task["id"], schedule=schedule)
        log.info("opportunity daily job already registered (task #%s, %s)",
                 task["id"], task.get("schedule"))
    else:
        task = task_store.create(
            "Daily opportunity scan",
            kind="opportunity_scan",
            payload={"sources": [s["name"] for s in list_sources()]},
            schedule=schedule,
        )
    if hasattr(scheduler, "schedule_task"):
        scheduler.schedule_task(task)
    return task
