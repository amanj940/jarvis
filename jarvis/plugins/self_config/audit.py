"""Audit log for every self-configuration / self-modification attempt.

One JSON object per line in ``data/logs/self_config_audit.jsonl`` — the
same logs directory the self-healing system already uses. Every entry
records what changed, why, what the verification steps said, and whether
the change was kept or rolled back. The log is append-only from this
module's point of view: entries are never edited or deleted by the
self-config code (the audit file itself is a protected path for the
self-edit loop, see guard.PROTECTED_PATHS).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

AUDIT_REL_PATH = Path("data/logs/self_config_audit.jsonl")


def audit_path(root: Path) -> Path:
    return Path(root) / AUDIT_REL_PATH


def new_entry(
    kind: str,
    target: str,
    reason: str,
    outcome: str,
    verification: dict[str, Any] | None = None,
    details: str = "",
) -> dict[str, Any]:
    """Build one audit entry. ``outcome`` is one of:
    ``kept``, ``kept_unverified_health``, ``rolled_back``, ``rejected``."""
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "kind": kind,
        "target": target,
        "reason": reason,
        "outcome": outcome,
        "verification": verification or {},
        "details": details,
    }


def append_audit(root: Path, entry: dict[str, Any]) -> Path:
    """Append ``entry`` to the audit log and return the log path."""
    path = audit_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return path


def read_audit(root: Path, limit: int = 20) -> list[dict[str, Any]]:
    """Return the last ``limit`` audit entries (oldest first)."""
    path = audit_path(root)
    if not path.exists():
        return []
    entries: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return entries[-limit:] if limit > 0 else entries
