"""Shared helpers for the split route modules (Phase 2)."""
from __future__ import annotations

from fastapi import Request


def _services(req: Request):
    s = req.app.state
    return s.cfg, s.orchestrator, s.registry, s.memory, s.agents
