"""Tool registrations for the intelligence layer.

Both tools are SAFE and read-only: they aggregate the local opportunity
and bounty stores into a geo-tagged view for the globe. Nothing here
writes, fetches, submits, or spends anything.
"""
from __future__ import annotations

import json

from ...core.permissions import Permission
from ..base import PluginInfo, tool
from .store import IntelStore


def _store(cfg) -> IntelStore:
    return IntelStore(cfg)


def _json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


def register(registry):
    cfg = registry.cfg
    toggle = cfg.plugins.get("intel")
    if toggle is not None and not toggle.enabled:
        return

    @tool(
        name="intel_globe_items",
        description=(
            "Geo-tagged intelligence items for the globe: opportunity leads "
            "and bug-bounty programs/findings that have a location, plus "
            "how many items could not be located. Read-only."
        ),
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "limit": {"type": "integer", "default": 200},
        }},
    )
    def intel_globe_items(limit: int = 200) -> str:
        return _json(_store(cfg).globe_items(limit=limit))

    @tool(
        name="intel_summary",
        description=(
            "Counts for the intelligence layer: how many opportunity leads "
            "and bounty programs/findings exist, how many have a location, "
            "and leads by source. Read-only."
        ),
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {}},
    )
    def intel_summary() -> str:
        return _json(_store(cfg).summary())

    registry.add_pending("intel")
    registry.register_plugin(PluginInfo(
        name="intel",
        description="Intelligence layer: geo-tagged opportunity + bounty "
                    "items plotted on the Earth globe (read-only).",
        permissions_needed=[Permission.SAFE],
    ))
