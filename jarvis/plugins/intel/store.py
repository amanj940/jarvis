"""Read-only aggregation for the intelligence layer.

``IntelStore`` reads the two existing SQLite stores — opportunity leads
and bounty programs/findings — and turns them into one geo-tagged view
for the globe. It never writes to either source database: a lead or a
finding is only *read*, and a location is only *derived* from text the
row already carries.

Where a coordinate comes from, in priority order:

1. Explicit ``lat`` / ``lon`` columns on the lead (nullable, added by
   the leads store; the fetcher or a human can set them later).
2. A city or company name found in the item's text — see ``geo.py``.
   The returned item always says *what* matched (``location_name`` and
   ``match``), so a bad pin is visible instead of silent.

Items with no location are not plotted; they are counted as
``unlocated`` so the globe never silently hides data.
"""
from __future__ import annotations

from ..bounty.store import BountyStore
from ..opportunity.leads import LeadsStore
from .geo import resolve_location, valid_coords

# How many leads we scan for the globe view. Plotted items are capped
# separately by the ``limit`` argument; the scan cap keeps the endpoint
# cheap even if the leads table grows.
_SCAN_LIMIT = 500


class IntelStore:
    """Live read-only view over the opportunity + bounty stores."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.leads = LeadsStore(cfg.abs_path("data/opportunity.db"))
        self.bounty = BountyStore(cfg.abs_path("data/bounty.db"))

    # ---- location resolution -------------------------------------------
    @staticmethod
    def _lead_location(lead: dict) -> dict | None:
        if valid_coords(lead.get("lat"), lead.get("lon")):
            return {
                "lat": float(lead["lat"]),
                "lon": float(lead["lon"]),
                "name": (lead.get("location") or "pinned").strip() or "pinned",
                "match": "explicit",
            }
        text = " ".join(
            str(lead.get(k) or "")
            for k in ("title", "notes", "source", "kind")
        )
        return resolve_location(text)

    @staticmethod
    def _bounty_location(program_name: str, target: str = "") -> dict | None:
        # Program names are usually companies ("Google", "HackerOne") so
        # the company-HQ table resolves most of them. A target domain
        # almost never contains a place name, but try it as a fallback.
        return resolve_location(program_name) or resolve_location(target)

    # ---- items ----------------------------------------------------------
    def globe_items(self, limit: int = 200) -> dict:
        """Plotted items + unlocated counts.

        ``limit`` caps how many located items are returned; the
        unlocated counts cover every row scanned, not just the capped
        ones, so the numbers always add up to the scanned totals.
        """
        limit = max(1, int(limit))
        items: list[dict] = []
        unlocated = {"opportunity": 0, "bounty": 0}

        for lead in self.leads.list_leads(limit=_SCAN_LIMIT):
            loc = self._lead_location(lead)
            if loc is None:
                unlocated["opportunity"] += 1
                continue
            if len(items) < limit:
                items.append({
                    "id": f"opp:{lead['id']}",
                    "kind": "opportunity",
                    "title": lead.get("title", ""),
                    "lat": loc["lat"],
                    "lon": loc["lon"],
                    "score": float(lead.get("score") or 0.0),
                    "severity": None,
                    "source": lead.get("source") or "",
                    "url": lead.get("url") or "",
                    "location_name": loc["name"],
                    "match": loc["match"],
                })

        programs = {p["id"]: p for p in self.bounty.list_programs()}
        for program in programs.values():
            loc = self._bounty_location(program.get("name") or "")
            if loc is None:
                unlocated["bounty"] += 1
                continue
            if len(items) < limit:
                items.append({
                    "id": f"bounty:program:{program['id']}",
                    "kind": "bounty",
                    "title": program.get("name", ""),
                    "lat": loc["lat"],
                    "lon": loc["lon"],
                    "score": None,
                    "severity": "program",
                    "source": program.get("platform") or "",
                    "url": program.get("url") or "",
                    "location_name": loc["name"],
                    "match": loc["match"],
                })
        for finding in self.bounty.list_findings():
            program = programs.get(finding.get("program_id") or 0) or {}
            loc = self._bounty_location(
                program.get("name") or "", finding.get("target") or "")
            if loc is None:
                unlocated["bounty"] += 1
                continue
            if len(items) < limit:
                items.append({
                    "id": f"bounty:finding:{finding['id']}",
                    "kind": "bounty",
                    "title": finding.get("title", ""),
                    "lat": loc["lat"],
                    "lon": loc["lon"],
                    "score": None,
                    "severity": (finding.get("severity") or "low").lower(),
                    "source": program.get("name") or "",
                    "url": program.get("url") or "",
                    "location_name": loc["name"],
                    "match": loc["match"],
                })

        return {
            "ok": True,
            "items": items,
            "unlocated": unlocated,
            "total": len(items),
            "located": {
                "opportunity": sum(1 for i in items if i["kind"] == "opportunity"),
                "bounty": sum(1 for i in items if i["kind"] == "bounty"),
            },
        }

    def summary(self) -> dict:
        """Counts by kind/source — no coordinates, just the shape of the data."""
        leads = self.leads.list_leads(limit=_SCAN_LIMIT)
        by_source: dict[str, int] = {}
        located = unlocated = 0
        for lead in leads:
            by_source[lead.get("source") or ""] = \
                by_source.get(lead.get("source") or "", 0) + 1
            if self._lead_location(lead) is None:
                unlocated += 1
            else:
                located += 1
        programs = self.bounty.list_programs()
        findings = self.bounty.list_findings()
        bounty_located = bounty_unlocated = 0
        for program in programs:
            if self._bounty_location(program.get("name") or "") is None:
                bounty_unlocated += 1
            else:
                bounty_located += 1
        for finding in findings:
            program = next((p for p in programs
                            if p["id"] == finding.get("program_id")), {})
            if self._bounty_location(program.get("name") or "",
                                     finding.get("target") or "") is None:
                bounty_unlocated += 1
            else:
                bounty_located += 1
        return {
            "ok": True,
            "opportunity": {
                "total": len(leads),
                "located": located,
                "unlocated": unlocated,
                "by_source": by_source,
            },
            "bounty": {
                "programs": len(programs),
                "findings": len(findings),
                "located": bounty_located,
                "unlocated": bounty_unlocated,
            },
        }
