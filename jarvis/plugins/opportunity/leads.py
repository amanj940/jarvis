"""Persistent leads store (SQLite) with URL dedup.

Dedup key: a normalised URL — lower-cased scheme/host, no fragment, no
``utm_*`` / ``fbclid`` tracking params, no trailing slash. The same
opportunity posted under a tracking link twice is *one* lead; the second
add returns the existing row with ``created=False`` instead of a duplicate.

Own file (default ``data/opportunity.db``), own tables — never touches
the memory database.
"""
from __future__ import annotations

import hashlib
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

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
    def __init__(self, db_path: str | Path):
        self.path = Path(db_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(SCHEMA)
            existing = {r[1] for r in c.execute("PRAGMA table_info(leads)")}
            for col, decl in _MIGRATIONS:
                if col not in existing:
                    c.execute(f"ALTER TABLE leads ADD COLUMN {col} {decl}")

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

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

    def get(self, lead_id: int) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
            return dict(row) if row else None

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
        q += " ORDER BY score DESC, created_at DESC LIMIT ?"
        args.append(max(1, limit))
        with self._conn() as c:
            return [dict(r) for r in c.execute(q, args).fetchall()]

    def top_leads(self, limit: int = 10, status: str = "new") -> list[dict]:
        return self.list_leads(status=status, limit=limit)

    def update_status(self, lead_id: int, status: str) -> dict | None:
        if status not in VALID_STATUSES:
            raise ValueError(f"invalid status {status!r}; use one of {sorted(VALID_STATUSES)}")
        with self._conn() as c:
            c.execute("UPDATE leads SET status=?, updated_at=? WHERE id=?",
                      (status, time.time(), lead_id))
        return self.get(lead_id)

    def count(self, status: str | None = None) -> int:
        with self._conn() as c:
            if status:
                return c.execute("SELECT COUNT(*) FROM leads WHERE status=?", (status,)).fetchone()[0]
            return c.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
