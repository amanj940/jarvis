"""SQLite store for bug-bounty programs, targets, and findings.

All data lives in ``data/bounty.db`` (next to the memory DB). Nothing here
touches the network. Findings are always created as ``draft`` and must be
verified by a human before any report is submitted anywhere.

Scope is enforced HERE, in the store — not only at the tool/agent layer —
so a direct store call cannot bypass the scope a program declares:

* ``add_target`` / ``add_finding`` refuse a target outside the program's
  scope with :class:`OutOfScopeError` (structured ``out_of_scope`` error,
  never a silent success).
* ``update_finding_status`` re-checks scope before a finding may advance
  toward reporting (``verified`` / ``reported`` / ``triaged`` /
  ``resolved``); disposition statuses (``draft`` / ``duplicate`` /
  ``out_of_scope`` / ``rejected``) stay allowed so an out-of-scope
  finding can still be marked as such.
* ``get_finding`` refuses a finding whose target fell out of its
  program's current scope; ``list_findings`` / ``list_targets`` exclude
  such rows (defence for data recorded before enforcement, or after a
  program's scope was narrowed).

A program with NO scope entries yet has not declared a scope: writes and
reads are allowed by default so a program can be created and scoped
afterwards (this preserves the long-standing behaviour that a bare
``add_program("Acme")`` is usable). Pass ``strict_scope=True`` for the
airtight rule — empty scope then means nothing is in scope, exactly like
:func:`jarvis.plugins.bounty.classification.in_scope`.

Store failures (locked/unreadable DB, ...) are normalised through
:func:`jarvis.plugins.common.errors.normalize_provider_error` into a
structured :class:`StoreError` instead of a raw ``sqlite3`` traceback.
"""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from ..common.errors import OutOfScopeError, normalize_provider_error
from .classification import in_scope

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

# Statuses that move a finding toward reporting — these require the
# finding's target to be in scope. Every other status is a disposition
# (including "out_of_scope" itself) and stays allowed.
_ADVANCING_STATUSES = {"verified", "reported", "triaged", "resolved"}


class BountyStore:
    """SQLite-backed bounty CRUD. Takes a plain path so tests can use tmp dirs."""

    def __init__(self, db_path: str | Path, strict_scope: bool = False):
        self.path = Path(db_path)
        self.strict_scope = bool(strict_scope)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def _conn(self):
        try:
            conn = sqlite3.connect(self.path)
        except sqlite3.Error as exc:
            # Structured error, no raw traceback to the caller.
            raise normalize_provider_error(exc, provider="store") from None
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except sqlite3.Error as exc:
            # Structured error, no raw traceback to the caller.
            raise normalize_provider_error(exc, provider="store") from None
        finally:
            conn.close()

    # ---- scope (store layer) ----
    def is_in_scope(self, program_id: int, target: str) -> bool:
        """True when *target* is inside program *program_id*'s declared scope.

        Empty scope means "no scope declared yet" and answers True, unless
        this store was built with ``strict_scope=True`` (empty scope then
        means nothing is in scope).
        """
        program = self.get_program(program_id)
        if program is None:
            raise ValueError(f"no program with id {program_id}")
        scope = program.get("scope") or []
        if not scope:
            return not self.strict_scope
        return in_scope(target, scope)

    def _require_in_scope(self, program: dict, target: str) -> None:
        """Raise :class:`OutOfScopeError` unless *target* is in scope."""
        scope = program.get("scope") or []
        if not scope:
            if self.strict_scope:
                raise OutOfScopeError(
                    f"target {target!r} is out of scope: program "
                    f"{program.get('name')!r} declares no scope",
                    target=target, scope=[])
            return
        if not in_scope(target, scope):
            raise OutOfScopeError(
                f"target {target!r} is out of scope for program "
                f"{program.get('name')!r}",
                target=target, scope=list(scope))

    def _row_in_scope(self, row: dict) -> bool:
        """True when a stored target/finding row is inside its program's scope."""
        program = self.get_program(row["program_id"])
        if program is None:
            return True  # orphan row: no program scope to check against
        scope = program.get("scope") or []
        if not scope:
            return not self.strict_scope
        return in_scope(row["target"], scope)

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
        program = self.get_program(program_id)
        if program is None:
            raise ValueError(f"no program with id {program_id}")
        if not target or not target.strip():
            raise ValueError("target is required")
        self._require_in_scope(program, target.strip())
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
            rows = [dict(r) for r in rows]
        return [r for r in rows if self._row_in_scope(r)]

    # ---- findings ----
    def add_finding(self, program_id: int, target: str, title: str,
                    description: str = "", evidence: str = "",
                    category: str = "Unclassified", cwe: str = "",
                    severity: str = "low") -> dict:
        program = self.get_program(program_id)
        if program is None:
            raise ValueError(f"no program with id {program_id}")
        if not title or not title.strip():
            raise ValueError("finding title is required")
        self._require_in_scope(program, target)
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

    def _get_finding_row(self, finding_id: int) -> dict | None:
        """Raw row fetch without the scope check (internal use)."""
        with self._conn() as c:
            row = c.execute("SELECT * FROM bounty_findings WHERE id=?", (finding_id,)).fetchone()
            return dict(row) if row else None

    def get_finding(self, finding_id: int) -> dict | None:
        row = self._get_finding_row(finding_id)
        if row is None:
            return None
        program = self.get_program(row["program_id"])
        if program is not None:
            self._require_in_scope(program, row["target"])
        return row

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
            rows = [dict(r) for r in c.execute(q, args).fetchall()]
        return [r for r in rows if self._row_in_scope(r)]

    def update_finding_status(self, finding_id: int, status: str) -> dict:
        if status not in VALID_STATUSES:
            raise ValueError(f"unknown status: {status!r} (use one of {sorted(VALID_STATUSES)})")
        found = self._get_finding_row(finding_id)
        if found is None:
            raise ValueError(f"no finding with id {finding_id}")
        if status in _ADVANCING_STATUSES:
            program = self.get_program(found["program_id"])
            if program is not None:
                self._require_in_scope(program, found["target"])
        with self._conn() as c:
            c.execute("UPDATE bounty_findings SET status=?, updated_at=? WHERE id=?",
                      (status, time.time(), finding_id))
        found = self._get_finding_row(finding_id)
        if found is None:
            raise ValueError(f"no finding with id {finding_id}")
        return found
