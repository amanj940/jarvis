"""SQLite job store for the video builder — local only.

All data lives in ``data/video.db`` (next to the memory DB). A project is a
draft video; its scenes are the plan; its status tracks the render:

    draft -> rendering -> done | failed

Nothing here touches the network and nothing is ever published — the store
only records local draft work. Rendered files live under ``data/video/``.
"""
from __future__ import annotations

import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS video_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    output_path TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS video_scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    idx INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    narration TEXT NOT NULL DEFAULT '',
    duration_seconds REAL NOT NULL DEFAULT 5.0,
    image_path TEXT NOT NULL DEFAULT '',
    audio_path TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    UNIQUE (project_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_scenes_project ON video_scenes(project_id);
"""

STATUSES = ("draft", "rendering", "done", "failed")


class VideoStore:
    """SQLite-backed video job store. Takes a plain path so tests can use tmp dirs."""

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

    # ---- projects ----
    def create_project(self, name: str, topic: str = "") -> dict:
        if not (name or "").strip():
            raise ValueError("project name must not be blank")
        now = time.time()
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO video_projects(name, topic, status, created_at,"
                " updated_at) VALUES(?,?, 'draft', ?, ?)",
                (name.strip(), topic or "", now, now),
            )
            # Build the dict from this same connection: a fresh connection
            # cannot see the row until this transaction commits.
            row = c.execute("SELECT * FROM video_projects WHERE id=?",
                            (cur.lastrowid,)).fetchone()
            d = dict(row)
            d["scenes"] = []
            return d

    def get_project(self, project_id: int) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM video_projects WHERE id=?",
                            (int(project_id),)).fetchone()
            if row is None:
                return None
            d = dict(row)
            d["scenes"] = self.list_scenes(int(project_id))
            return d

    def list_projects(self, limit: int = 50) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM video_projects ORDER BY created_at DESC LIMIT ?",
                (max(1, limit),)).fetchall()
            out = []
            for r in rows:
                d = dict(r)
                d["scene_count"] = c.execute(
                    "SELECT COUNT(*) FROM video_scenes WHERE project_id=?",
                    (d["id"],)).fetchone()[0]
                out.append(d)
            return out

    def set_project_status(
        self, project_id: int, status: str,
        output_path: str = "", error: str = "",
    ) -> dict | None:
        if status not in STATUSES:
            raise ValueError(f"unknown status: {status}")
        with self._conn() as c:
            c.execute(
                "UPDATE video_projects SET status=?, output_path=?, error=?,"
                " updated_at=? WHERE id=?",
                (status, output_path or "", error or "", time.time(), int(project_id)),
            )
            # Same-connection read (see create_project): the update is not
            # visible to a fresh connection until this transaction commits.
            row = c.execute("SELECT * FROM video_projects WHERE id=?",
                            (int(project_id),)).fetchone()
            if row is None:
                return None
            d = dict(row)
            d["scenes"] = [dict(r) for r in c.execute(
                "SELECT * FROM video_scenes WHERE project_id=? ORDER BY idx",
                (int(project_id),)).fetchall()]
            return d

    # ---- scenes ----
    def add_scene(
        self, project_id: int, title: str, narration: str,
        duration_seconds: float = 5.0, image_path: str = "",
    ) -> dict:
        if self.get_project(int(project_id)) is None:
            raise ValueError(f"project not found: {project_id}")
        if not (narration or "").strip():
            raise ValueError("scene narration must not be blank")
        with self._conn() as c:
            idx = c.execute(
                "SELECT COALESCE(MAX(idx), -1) + 1 FROM video_scenes"
                " WHERE project_id=?", (int(project_id),)).fetchone()[0]
            cur = c.execute(
                "INSERT INTO video_scenes(project_id, idx, title, narration,"
                " duration_seconds, image_path) VALUES(?,?,?,?,?,?)",
                (int(project_id), int(idx), title or f"Scene {idx + 1}",
                 narration.strip(), max(1.0, float(duration_seconds)),
                 image_path or ""),
            )
            row = c.execute("SELECT * FROM video_scenes WHERE id=?",
                            (cur.lastrowid,)).fetchone()
            return dict(row)

    def list_scenes(self, project_id: int) -> list[dict]:
        with self._conn() as c:
            return [dict(r) for r in c.execute(
                "SELECT * FROM video_scenes WHERE project_id=? ORDER BY idx",
                (int(project_id),)).fetchall()]

    def set_scene_audio(self, scene_id: int, audio_path: str) -> None:
        with self._conn() as c:
            c.execute("UPDATE video_scenes SET audio_path=? WHERE id=?",
                      (audio_path or "", int(scene_id)))

    def set_scene_status(self, scene_id: int, status: str) -> None:
        with self._conn() as c:
            c.execute("UPDATE video_scenes SET status=? WHERE id=?",
                      (status, int(scene_id)))

    def counts(self) -> dict:
        with self._conn() as c:
            return {
                "projects": c.execute(
                    "SELECT COUNT(*) FROM video_projects").fetchone()[0],
                "scenes": c.execute(
                    "SELECT COUNT(*) FROM video_scenes").fetchone()[0],
            }
