"""SQLite store for bug-bounty programs, targets, and findings.

All data lives in ``data/bounty.db`` (next to the memory DB). Nothing here
touches the network. Findings are always created as ``draft`` and must be
verified by a human before any report is submitted anywhere.
"""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS bounty_programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL DEFAULT 'other',
    url TEXT,
    scope TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS bounty_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL REFERENCES bounty_programs(id),
    target TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'domain',
    created_at REAL NOT NULL,
    UNIQUE(program_id, target)
);
CREATE TABLE IF NOT EXISTS bounty_findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL REFERENCES bounty_programs(id),
    target TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    evidence TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Unclassified',
    cwe TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'low',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_findings_program ON bounty_findings(program_id);
CREATE INDEX IF NOT EXISTS idx_findings_status ON bounty_findings(status);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON bounty_findings(severity);
"""

VALID_STATUSES = {"draft", "verified", "reported", "triaged", "duplicate",
                  "out_of_scope", "resolved", "rejected"}
VALID_PLATFORMS = {"hackerone", "bugcrowd", "intigriti", "yeswehack", "other"}


class BountyStore:
    """SQLite-backed bounty CRUD. Takes a plain path so tests can use tmp dirs."""

    def __init__(self, db_path: str | Path):
        self.path = Path(db_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # ---- programs ----
    def add_program(self, name: str, platform: str = "other",
                    url: str = "", scope: list[str] | None = None,
                    notes: str = "") -> dict:
        platform = (platform or "other").lower()
        if platform not in VALID_PLATFORMS:
            raise ValueError(f"unknown platform: {platform!r} (use one of {sorted(VALID_PLATFORMS)})")
        if not name or not name.strip():
            raise ValueError("program name is required")
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO bounty_programs(name, platform, url, scope, notes, created_at)"
                " VALUES(?,?,?,?,?,?)",
                (name.strip(), platform, url or "", json.dumps(list(scope or [])),
                 notes or "", time.time()),
            )
            # Same connection: the row is not yet committed, so a fresh
            # connection would not see it.
            row = c.execute("SELECT * FROM bounty_programs WHERE id=?",
                            (cur.lastrowid,)).fetchone()
            return self._program_row(row)

    def get_program(self, program_id: int) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM bounty_programs WHERE id=?", (program_id,)).fetchone()
            return self._program_row(row) if row else None

    def get_program_by_name(self, name: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM bounty_programs WHERE name=?", (name,)).fetchone()
            return self._program_row(row) if row else None

    def list_programs(self) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM bounty_programs ORDER BY name").fetchall()
            return [self._program_row(r) for r in rows]

    @staticmethod
    def _program_row(row) -> dict:
        d = dict(row)
        d["scope"] = json.loads(d["scope"] or "[]")
        return d

    # ---- targets ----
    def add_target(self, program_id: int, target: str, kind: str = "domain") -> dict:
        if self.get_program(program_id) is None:
            raise ValueError(f"no program with id {program_id}")
        if not target or not target.strip():
            raise ValueError("target is required")
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO bounty_targets(program_id, target, kind, created_at)"
                " VALUES(?,?,?,?)",
                (program_id, target.strip(), kind or "domain", time.time()),
            )
            row = c.execute("SELECT * FROM bounty_targets WHERE id=?", (cur.lastrowid,)).fetchone()
            return dict(row)

    def list_targets(self, program_id: int) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM bounty_targets WHERE program_id=? ORDER BY target",
                (program_id,)).fetchall()
            return [dict(r) for r in rows]

    # ---- findings ----
    def add_finding(self, program_id: int, target: str, title: str,
                    description: str = "", evidence: str = "",
                    category: str = "Unclassified", cwe: str = "",
                    severity: str = "low") -> dict:
        if self.get_program(program_id) is None:
            raise ValueError(f"no program with id {program_id}")
        if not title or not title.strip():
            raise ValueError("finding title is required")
        now = time.time()
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO bounty_findings(program_id, target, title, description,"
                " evidence, category, cwe, severity, status, created_at, updated_at)"
                " VALUES(?,?,?,?,?,?,?,?, 'draft', ?, ?)",
                (program_id, target, title.strip(), description or "", evidence or "",
                 category, cwe, (severity or "low").lower(), now, now),
            )
            # Same connection: the row is not yet committed, so a fresh
            # connection would not see it.
            row = c.execute("SELECT * FROM bounty_findings WHERE id=?",
                            (cur.lastrowid,)).fetchone()
            return dict(row)

    def get_finding(self, finding_id: int) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM bounty_findings WHERE id=?", (finding_id,)).fetchone()
            return dict(row) if row else None

    def list_findings(self, program_id: int | None = None,
                      status: str | None = None) -> list[dict]:
        q = "SELECT * FROM bounty_findings"
        args: list[Any] = []
        where = []
        if program_id is not None:
            where.append("program_id=?")
            args.append(program_id)
        if status:
            if status not in VALID_STATUSES:
                raise ValueError(f"unknown status: {status!r}")
            where.append("status=?")
            args.append(status)
        if where:
            q += " WHERE " + " AND ".join(where)
        q += " ORDER BY created_at DESC"
        with self._conn() as c:
            return [dict(r) for r in c.execute(q, args).fetchall()]

    def update_finding_status(self, finding_id: int, status: str) -> dict:
        if status not in VALID_STATUSES:
            raise ValueError(f"unknown status: {status!r} (use one of {sorted(VALID_STATUSES)})")
        with self._conn() as c:
            c.execute("UPDATE bounty_findings SET status=?, updated_at=? WHERE id=?",
                      (status, time.time(), finding_id))
        found = self.get_finding(finding_id)
        if found is None:
            raise ValueError(f"no finding with id {finding_id}")
        return found
