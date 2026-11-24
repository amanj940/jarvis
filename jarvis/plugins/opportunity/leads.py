"""Persistent leads store (SQLite) with URL dedup.

Dedup key: a normalised URL — lower-cased scheme/host, no fragment, no
``utm_*`` / ``fbclid`` tracking params, no trailing slash. The same
opportunity posted under a tracking link twice is *one* lead; the second
add returns the existing row with ``created=False`` instead of a duplicate.

Own file (default ``data/opportunity.db``), own tables — never touches
the memory database.

Scope is enforced HERE, in the store — not only at the tool layer. A
``LeadsStore`` may be built with an explicit allowlist
(``allowed_hosts`` and/or ``allowed_sources``); when one is configured,
``add_lead`` refuses a lead outside it with :class:`OutOfScopeError`,
``get`` refuses an out-of-scope lead, and ``list_leads`` / ``count``
only serve in-scope leads. With no allowlist configured (the default)
the store accepts any ``http(s)`` URL, preserving the scanner's
behaviour — scan candidates are web-search results from anywhere on the
web, not just the curated source sites — and the manual add-lead tool.
``update_status`` re-checks scope except for the ``ignored`` disposition,
so an out-of-scope lead can still be dismissed.

Store failures (locked/unreadable DB, ...) are normalised through
:func:`jarvis.plugins.common.errors.normalize_provider_error` into a
structured :class:`StoreError` instead of a raw ``sqlite3`` traceback.
"""
from __future__ import annotations

import hashlib
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from ..common.errors import OutOfScopeError, normalize_provider_error

SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_hash TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    source TEXT,
    kind TEXT,
    score REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new',
    notes TEXT,
    lat REAL,
    lon REAL,
    location TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status, score);
CREATE INDEX IF NOT EXISTS idx_leads_kind ON leads(kind);
"""

# Columns added after the first release. ``CREATE TABLE IF NOT EXISTS``
# never touches an existing table, so old databases get them here.
_MIGRATIONS = (
    ("lat", "REAL"),
    ("lon", "REAL"),
    ("location", "TEXT"),
)

TRACKING_PARAMS = {"utm_source", "utm_medium", "utm_campaign", "utm_term",
                   "utm_content", "fbclid", "gclid", "ref", "referrer"}
VALID_STATUSES = {"new", "reviewing", "pursuing", "won", "lost", "ignored"}


def normalize_url(url: str) -> str:
    """Canonical form used for dedup."""
    parsed = urlparse((url or "").strip())
    query = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
             if k.lower() not in TRACKING_PARAMS]
    path = parsed.path.rstrip("/") or "/"
    return urlunparse((
        parsed.scheme.lower(), parsed.netloc.lower(), path,
        "", urlencode(sorted(query)), "",
    ))


def url_hash(url: str) -> str:
    return hashlib.sha256(normalize_url(url).encode("utf-8")).hexdigest()


class LeadsStore:
    def __init__(self, db_path: str | Path,
                 allowed_hosts: list[str] | None = None,
                 allowed_sources: list[str] | None = None):
        self.path = Path(db_path)
        # Normalised allowlists; empty/None = unrestricted (default).
        # Hosts match the host and its subdomains (``upwork.com`` also
        # covers ``www.upwork.com``). Sources match by exact name,
        # case-insensitively. When both are set, a lead must satisfy both.
        self._allowed_hosts = sorted({
            h.strip().lower().lstrip("*.") for h in (allowed_hosts or [])
            if h and h.strip()})
        self._allowed_sources = sorted({
            s.strip().lower() for s in (allowed_sources or [])
            if s and s.strip()})
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(SCHEMA)
            existing = {r[1] for r in c.execute("PRAGMA table_info(leads)")}
            for col, decl in _MIGRATIONS:
                if col not in existing:
                    c.execute(f"ALTER TABLE leads ADD COLUMN {col} {decl}")

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
    def in_scope(self, url: str, source: str = "") -> bool:
        """True when a lead URL/source is inside this store's allowlist.

        With no allowlist configured every lead is in scope.
        """
        if self._allowed_hosts:
            host = (urlparse((url or "").strip()).netloc or "").lower().split(":")[0]
            if not host or not any(host == h or host.endswith("." + h)
                                   for h in self._allowed_hosts):
                return False
        if self._allowed_sources:
            if (source or "").strip().lower() not in self._allowed_sources:
                return False
        return True

    def _require_in_scope(self, url: str, source: str = "") -> None:
        """Raise :class:`OutOfScopeError` unless the lead is in scope."""
        if not self.in_scope(url, source):
            raise OutOfScopeError(
                f"lead {url!r} is outside the configured lead scope",
                target=url,
                details={"allowed_hosts": list(self._allowed_hosts),
                         "allowed_sources": list(self._allowed_sources)})

    def _row_in_scope(self, row: dict) -> bool:
        return self.in_scope(row["url"], row.get("source") or "")

    def add_lead(self, url: str, title: str, source: str = "", kind: str = "",
                 score: float = 0.0, notes: str = "",
                 lat: float | None = None, lon: float | None = None,
                 location: str = "") -> tuple[dict, bool]:
        """Insert a lead; returns (lead, created). Duplicates return the old row.

        ``lat`` / ``lon`` are optional explicit coordinates (used by the
        intelligence layer to pin the lead on the globe); out-of-range
        values are rejected. ``location`` is a human-readable place name.
        """
        if not url or not url.strip().lower().startswith(("http://", "https://")):
            raise ValueError("lead needs an http(s) URL")
        if not (title or "").strip():
            raise ValueError("lead needs a title")
        if (lat is None) != (lon is None):
            raise ValueError("lat and lon go together — set both or neither")
        if lat is not None and not (-90.0 <= float(lat) <= 90.0
                                    and -180.0 <= float(lon) <= 180.0):
            raise ValueError("lat must be -90..90 and lon -180..180")
        self._require_in_scope(url, source)
        h = url_hash(url)
        now = time.time()
        with self._conn() as c:
            row = c.execute("SELECT * FROM leads WHERE url_hash=?", (h,)).fetchone()
            if row:
                return dict(row), False
            cur = c.execute(
                "INSERT INTO leads(url_hash,url,title,source,kind,score,status,notes,"
                "lat,lon,location,created_at,updated_at)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (h, url.strip(), title.strip(), source, kind, float(score),
                 "new", notes, lat, lon, location or "", now, now),
            )
            row = c.execute("SELECT * FROM leads WHERE id=?", (cur.lastrowid,)).fetchone()
            return dict(row), True

    def _get_row(self, lead_id: int) -> dict | None:
        """Raw row fetch without the scope check (internal use)."""
        with self._conn() as c:
            row = c.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
            return dict(row) if row else None

    def get(self, lead_id: int) -> dict | None:
        row = self._get_row(lead_id)
        if row is None:
            return None
        self._require_in_scope(row["url"], row.get("source") or "")
        return row

    def list_leads(self, status: str | None = None, kind: str | None = None,
                   limit: int = 50) -> list[dict]:
        q = "SELECT * FROM leads"
        clauses, args = [], []
        if status:
            clauses.append("status=?")
            args.append(status)
        if kind:
            clauses.append("kind=?")
            args.append(kind)
        if clauses:
            q += " WHERE " + " AND ".join(clauses)
        q += " ORDER BY score DESC, created_at DESC"
        with self._conn() as c:
            rows = [dict(r) for r in c.execute(q, args).fetchall()]
        # Filter before applying the limit so an out-of-scope row never
        # eats a slot meant for an in-scope lead.
        rows = [r for r in rows if self._row_in_scope(r)]
        return rows[:max(1, limit)]

    def top_leads(self, limit: int = 10, status: str = "new") -> list[dict]:
        return self.list_leads(status=status, limit=limit)

    def update_status(self, lead_id: int, status: str) -> dict | None:
        if status not in VALID_STATUSES:
            raise ValueError(f"invalid status {status!r}; use one of {sorted(VALID_STATUSES)}")
        row = self._get_row(lead_id)
        if row is None:
            return None
        if status != "ignored":
            self._require_in_scope(row["url"], row.get("source") or "")
        with self._conn() as c:
            c.execute("UPDATE leads SET status=?, updated_at=? WHERE id=?",
                      (status, time.time(), lead_id))
        return self._get_row(lead_id)

    def count(self, status: str | None = None) -> int:
        if not (self._allowed_hosts or self._allowed_sources):
            with self._conn() as c:
                if status:
                    return c.execute("SELECT COUNT(*) FROM leads WHERE status=?", (status,)).fetchone()[0]
                return c.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
        return len(self.list_leads(status=status, limit=10 ** 9))
