"""Opportunity-hunting plugin.

The plugin name stays ``opportunity`` so config, ``/api/plugins`` output
and the registry are stable. Nothing is fetched or submitted at import
or registration time — the daily scan only runs through the Phase 4
task scheduler (see ``jobs.register_opportunity_daily_job``).
"""
from __future__ import annotations

from .jobs import (
    DAILY_SCHEDULE,
    format_alerts,
    register_opportunity_daily_job,
    run_opportunity_scan,
)
from .leads import LeadsStore, normalize_url, url_hash
from .scoring import score_lead
from .sources import DEFAULT_SOURCES, Source, list_sources, validate_source
from .tools import register

__all__ = [
    "DAILY_SCHEDULE",
    "DEFAULT_SOURCES",
    "LeadsStore",
    "Source",
    "format_alerts",
    "list_sources",
    "normalize_url",
    "register",
    "register_opportunity_daily_job",
    "run_opportunity_scan",
    "score_lead",
    "url_hash",
    "validate_source",
]
