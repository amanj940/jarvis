"""Daily opportunity scan — the job the Phase 4 scheduler runs.

The scan itself is pure orchestration over an injected ``fetcher``:
a callable returning candidate dicts (``url``, ``title``, ``source``,
``kind``, optional ``description``). Production wiring is the caller's
job — e.g. a fetcher built on ``web_search`` — because *how* a source is
fetched (API, RSS, search) differs per source and none of it should be
hard-coded here. With no fetcher the scan is a documented no-op that
returns ``scanned: 0`` instead of pretending to work.

Registration with the Phase 4 scheduler:
``register_opportunity_daily_job(store, scheduler, leads_store)`` creates
a persistent ``TaskStore`` task (kind ``opportunity_scan``, cron
``0 9 * * *`` = daily 09:00 UTC) and registers its handler, so the scan
survives restarts exactly like reminders and notes do.
"""
from __future__ import annotations

import asyncio
import inspect
import logging
from typing import Any, Awaitable, Callable

from .leads import LeadsStore
from .scoring import score_lead
from .sources import DEFAULT_KEYWORDS, list_sources

log = logging.getLogger("jarvis.opportunity")

DAILY_SCHEDULE = "0 9 * * *"  # daily 09:00 UTC


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
                                   schedule: str = DAILY_SCHEDULE) -> dict:
    """Create the persistent daily task and register its scheduler handler."""
    async def _handler(task: dict) -> str:
        summary = await run_opportunity_scan(leads_store, fetcher=fetcher)
        return summary.get("alerts", "")

    scheduler.register_handler("opportunity_scan", _handler)
    task = task_store.create(
        "Daily opportunity scan",
        kind="opportunity_scan",
        payload={"sources": [s["name"] for s in list_sources()]},
        schedule=schedule,
    )
    if hasattr(scheduler, "schedule_task"):
        scheduler.schedule_task(task)
    return task
