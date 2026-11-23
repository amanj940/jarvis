"""SQLite metrics store for YouTube channel / video snapshots.

Two tables, both append-only snapshots so growth is computable:

* ``channel_metrics`` — one row per fetch: subscribers, views, videos.
* ``video_metrics``   — one row per video per fetch: views, likes, comments.

The store lives in its own file (default ``data/youtube.db``) so it never
touches the memory database. All timestamps are epoch seconds.
"""
from __future__ import annotations

import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS channel_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    title TEXT,
    subscribers INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    videos INTEGER NOT NULL DEFAULT 0,
    fetched_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ch_channel ON channel_metrics(channel_id, fetched_at);
CREATE TABLE IF NOT EXISTS video_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    channel_id TEXT,
    title TEXT,
    views INTEGER NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    fetched_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vm_video ON video_metrics(video_id, fetched_at);
"""


class ChannelMetricsStore:
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

    # -- writes ---------------------------------------------------------
    def record_channel(self, stats: dict, fetched_at: float | None = None) -> dict:
        row = {
            "channel_id": stats.get("channel_id", ""),
            "title": stats.get("title", ""),
            "subscribers": int(stats.get("subscribers") or 0),
            "views": int(stats.get("views") or 0),
            "videos": int(stats.get("videos") or 0),
            "fetched_at": float(fetched_at if fetched_at is not None else time.time()),
        }
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO channel_metrics(channel_id,title,subscribers,views,videos,fetched_at)"
                " VALUES(?,?,?,?,?,?)",
                (row["channel_id"], row["title"], row["subscribers"],
                 row["views"], row["videos"], row["fetched_at"]),
            )
            row["id"] = cur.lastrowid
        return row

    def record_videos(self, videos: list[dict], fetched_at: float | None = None) -> int:
        ts = float(fetched_at if fetched_at is not None else time.time())
        with self._conn() as c:
            for v in videos:
                c.execute(
                    "INSERT INTO video_metrics(video_id,channel_id,title,views,likes,comments,fetched_at)"
                    " VALUES(?,?,?,?,?,?,?)",
                    (v.get("video_id", ""), v.get("channel_id", ""), v.get("title", ""),
                     int(v.get("views") or 0), int(v.get("likes") or 0),
                     int(v.get("comments") or 0), ts),
                )
        return len(videos)

    # -- reads ----------------------------------------------------------
    def latest_channel(self, channel_id: str) -> dict | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT * FROM channel_metrics WHERE channel_id=? ORDER BY fetched_at DESC LIMIT 1",
                (channel_id,),
            ).fetchone()
            return dict(row) if row else None

    def channel_growth(self, channel_id: str) -> dict:
        """Subscribers/views delta between the oldest and newest snapshots."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM channel_metrics WHERE channel_id=? ORDER BY fetched_at",
                (channel_id,),
            ).fetchall()
        if len(rows) < 2:
            latest = dict(rows[-1]) if rows else {}
            return {"channel_id": channel_id, "snapshots": len(rows),
                    "subscribers_delta": 0, "views_delta": 0, "latest": latest}
        first, last = dict(rows[0]), dict(rows[-1])
        return {
            "channel_id": channel_id,
            "snapshots": len(rows),
            "since": first["fetched_at"],
            "until": last["fetched_at"],
            "subscribers_delta": last["subscribers"] - first["subscribers"],
            "views_delta": last["views"] - first["views"],
            "videos_delta": last["videos"] - first["videos"],
            "latest": last,
        }

    def top_videos(self, limit: int = 10) -> list[dict]:
        """Latest snapshot per video, ranked by views."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT v.* FROM video_metrics v"
                " JOIN (SELECT video_id, MAX(fetched_at) AS m FROM video_metrics GROUP BY video_id) latest"
                "   ON v.video_id = latest.video_id AND v.fetched_at = latest.m"
                " ORDER BY v.views DESC LIMIT ?",
                (max(1, limit),),
            ).fetchall()
            return [dict(r) for r in rows]

    def history(self, channel_id: str, limit: int = 30) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM channel_metrics WHERE channel_id=? ORDER BY fetched_at DESC LIMIT ?",
                (channel_id, max(1, limit)),
            ).fetchall()
            return [dict(r) for r in rows]
