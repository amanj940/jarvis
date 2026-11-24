"""Tool registrations for the opportunity plugin.

``opportunity_scan`` runs the scan with the web_search fetcher wired at
registration time (see ``jobs.py``: ``build_web_search_fetcher``) — search
snippets only, no page is ever fetched. Nothing here contacts a platform,
submits anything, or spends money; leads are local SQLite rows a human
reviews. Leads move through new -> reviewing -> pursuing -> won (or to
lost / ignored) via ``opportunity_update_lead_status`` — a status change
only, never a submission or an application.
"""
from __future__ import annotations

import asyncio
import json

from ...core.permissions import Permission
from ..base import PluginInfo, tool
from .jobs import (
    build_web_search_fetcher,
    format_alerts,
    register_opportunity_daily_job,
    run_opportunity_scan,
)
from .leads import VALID_STATUSES, LeadsStore
from .scoring import score_lead
from .sources import list_sources


def _store(cfg) -> LeadsStore:
    return LeadsStore(cfg.abs_path("data/opportunity.db"))


def _json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


def register(registry):
    cfg = registry.cfg
    toggle = cfg.plugins.get("opportunity")
    if toggle is not None and not toggle.enabled:
        return
    store = _store(cfg)
    fetcher = build_web_search_fetcher(registry)

    @tool(
        name="opportunity_add_lead",
        description="Save one opportunity lead (URL + title) for later review. Duplicates by URL are ignored.",
        permission=Permission.CAUTION,
        parameters={"type": "object", "properties": {
            "url": {"type": "string"},
            "title": {"type": "string"},
            "source": {"type": "string"},
            "kind": {"type": "string"},
            "keywords": {"type": "array", "items": {"type": "string"}},
        }, "required": ["url", "title"]},
    )
    def opportunity_add_lead(url: str, title: str, source: str = "", kind: str = "",
                             keywords: list | None = None) -> str:
        scored = score_lead(title, "", keywords or [])
        lead, created = store.add_lead(url, title, source=source, kind=kind,
                                       score=scored["score"],
                                       notes="; ".join(scored["reasons"]))
        return _json({"ok": True, "created": created, "lead": lead})

    @tool(
        name="opportunity_list_leads",
        description="List saved opportunity leads, highest score first.",
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "status": {"type": "string"},
            "kind": {"type": "string"},
            "limit": {"type": "integer", "default": 20},
        }},
    )
    def opportunity_list_leads(status: str | None = None, kind: str | None = None,
                               limit: int = 20) -> str:
        return _json({"ok": True, "leads": store.list_leads(status=status, kind=kind, limit=limit)})

    @tool(
        name="opportunity_update_lead_status",
        description=(
            "Move an opportunity lead through its lifecycle: new -> reviewing -> "
            "pursuing -> won, or to lost / ignored. Local DB status change only — "
            "never submits, applies, or spends anything."
        ),
        permission=Permission.CAUTION,
        parameters={"type": "object", "properties": {
            "lead_id": {"type": "integer"},
            "status": {"type": "string", "enum": sorted(VALID_STATUSES)},
        }, "required": ["lead_id", "status"]},
    )
    def opportunity_update_lead_status(lead_id: int, status: str) -> str:
        status = (status or "").strip().lower()
        if status not in VALID_STATUSES:
            return _json({"ok": False,
                          "error": f"unknown status {status!r}",
                          "valid_statuses": sorted(VALID_STATUSES)})
        current = store.get(lead_id)
        if current is None:
            return _json({"ok": False, "error": f"no lead with id {lead_id}"})
        try:
            updated = store.update_status(lead_id, status)
        except ValueError as exc:
            return _json({"ok": False, "error": str(exc)})
        if updated is None:  # removed between the get and the update
            return _json({"ok": False, "error": f"no lead with id {lead_id}"})
        return _json({"ok": True, "lead": updated,
                      "previous_status": current["status"]})

    @tool(
        name="opportunity_top_leads",
        description="Top new opportunity leads as a short alert summary.",
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "limit": {"type": "integer", "default": 5},
        }},
    )
    def opportunity_top_leads(limit: int = 5) -> str:
        top = store.top_leads(limit=limit)
        return _json({"ok": True, "alerts": format_alerts(top, limit=limit), "leads": top})

    @tool(
        name="opportunity_scan",
        description=(
            "Run one opportunity scan now over the curated sources "
            "(web_search snippets only, no page is ever fetched); it never "
            "submits, applies, or spends anything."
        ),
        permission=Permission.CAUTION,
        parameters={"type": "object", "properties": {}},
    )
    async def opportunity_scan() -> str:
        summary = await run_opportunity_scan(store, fetcher=fetcher)
        return _json(summary)

    @tool(
        name="opportunity_sources",
        description="List the curated opportunity sources Jarvis may check.",
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {}},
    )
    def opportunity_sources() -> str:
        return _json({"ok": True, "sources": list_sources()})

    registry.add_pending("opportunity")
    registry.register_plugin(PluginInfo(
        name="opportunity",
        description="Opportunity hunting: curated sources, deduped leads DB, scoring, daily scan.",
        permissions_needed=[Permission.SAFE, Permission.CAUTION],
    ))
