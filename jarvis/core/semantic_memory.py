"""Semantic long-term memory — embeddings + cosine recall over SQLite.

Sits alongside the keyword :class:`~jarvis.core.memory.Memory` store, sharing
the same DB file. Each remembered fact is stored with its embedding vector;
recall returns the top-K facts most similar to a query. Those are injected
into the system prompt so JARVIS genuinely remembers the user across sessions
instead of only matching substrings.

Phase 3 — real vector index (was: ``_load_vectors()`` re-read + re-decoded
EVERY stored vector from SQLite on EVERY recall, then a linear ``np.dot``
scan — O(N) SQLite + decode work per user turn, and a hard numpy dependency
that isn't even installed in the minimal venv):

* Preferred backend — **sqlite-vec** (``vec0`` virtual table
  ``semantic_memory_vec``, rowid mirrors ``semantic_memory.id``). Recall is
  a single indexed KNN query (``embedding MATCH … AND k = ?``); inserts
  append one row to the index. No numpy, no extra service, one 163 kB wheel.
  The ``semantic_memory`` table itself is UNCHANGED — the vec table is an
  additive index beside it, rebuilt from the stored blobs if it ever drifts.
* Fallback backend — **pure-Python in-memory index**: the normalised
  matrix is loaded ONCE per process (first recall) and appended to
  incrementally on insert, never re-read per retrieval. Cosine is a dot
  product over unit vectors. Fine for a personal assistant (thousands of
  facts); no dependency at all.

Backend selection is automatic: sqlite-vec is used when the ``sqlite_vec``
package imports AND the SQLite connection accepts ``load_extension``;
anything else falls back to the Python index (``self.index_backend`` reports
which one is active). To force the fallback for testing, pass
``SemanticMemory(cfg, embedder, prefer_vec=False)``.

Switching to FAISS later: keep the ``remember``/``recall``/``forget`` API
and swap the backend class — FAISS wants a ``faiss.IndexFlatIP`` over
unit-normalised float32 vectors persisted with ``faiss.write_index`` next
to the DB, with the same rowid↔id mapping the vec table uses today.

If embeddings are unavailable the store still records facts (vector = empty)
and recall returns nothing — the orchestrator then leans on the existing
keyword :meth:`Memory.search`. Nothing breaks; it just gets less smart.
"""
from __future__ import annotations

import json
import logging
import math
import sqlite3
import struct
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from ..config import Config
from .embeddings import EmbeddingClient

log = logging.getLogger("jarvis.semantic")

SCHEMA = """
CREATE TABLE IF NOT EXISTS semantic_memory (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    kind         TEXT NOT NULL,
    text         TEXT NOT NULL,
    meta         TEXT,
    embedding    BLOB,
    dim          INTEGER NOT NULL DEFAULT 0,
    created_at   REAL NOT NULL,
    last_recalled REAL
);
CREATE INDEX IF NOT EXISTS idx_sem_kind ON semantic_memory(kind);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sem_text ON semantic_memory(kind, text);
"""

# Additive index table (Phase 3). The semantic_memory table above is never
# altered; this vec0 table only mirrors (id → unit-normalised embedding).
_VEC_TABLE = "semantic_memory_vec"


def _normalize(vec: list[float]) -> list[float] | None:
    """Return the unit-normalised copy of ``vec`` (None for a zero vector)."""
    n = math.sqrt(sum(v * v for v in vec))
    if n == 0.0 or not math.isfinite(n):
        return None
    return [v / n for v in vec]


class SemanticMemory:
    def __init__(
        self,
        cfg: Config,
        embedder: EmbeddingClient,
        *,
        prefer_vec: bool = True,
    ):
        self.cfg = cfg
        self.embedder = embedder
        self.path: Path = cfg.abs_path(cfg.memory.db_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Set BEFORE the first _conn() call — _conn() reads _vec_ok.
        self.index_backend = "python"
        self._vec_ok = False
        self._vec_dim: int | None = None
        with self._conn() as c:
            c.executescript(SCHEMA)

        # — Backend selection (Phase 3) —
        if prefer_vec:
            self._vec_ok = _sqlite_vec_available()
        if self._vec_ok:
            self.index_backend = "sqlite-vec"
            self._vec_dim = self._vec_table_dim()
            if self._vec_dim is not None:
                self._vec_sync(self._vec_dim)
        # Pure-Python index state: loaded once per process, appended to on
        # insert. Entries are (id, kind, text, meta, unit_vec).
        self._py_index: list[tuple[int, str, str, dict, list[float]]] = []
        self._py_loaded = False
        log.info("semantic memory index backend: %s", self.index_backend)

    # ------------------------------------------------------------------
    # Connection (loads the sqlite-vec extension when the backend needs it)
    # ------------------------------------------------------------------
    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            if self._vec_ok:
                try:
                    conn.enable_load_extension(True)
                    import sqlite_vec

                    conn.load_extension(sqlite_vec.loadable_path())
                except Exception as e:  # noqa: BLE001
                    # Extension vanished mid-process (shouldn't happen) —
                    # degrade to the Python index rather than failing recalls.
                    log.warning("sqlite-vec extension load failed, using python index: %s", e)
                    self._vec_ok = False
                    self.index_backend = "python"
            yield conn
            conn.commit()
        finally:
            conn.close()

    # ------------------------------------------------------------------
    async def remember(self, text: str, kind: str = "fact", meta: dict | None = None) -> bool:
        """Embed + persist a fact. Idempotent on (kind, text). Returns True if
        a new row was written, False if it already existed or text was empty."""
        text = (text or "").strip()
        if not text:
            return False
        vec = await self.embedder.embed(text)
        blob = _to_blob(vec) if vec else b""
        dim = len(vec) if vec else 0
        try:
            with self._conn() as c:
                cur = c.execute(
                    "INSERT OR IGNORE INTO semantic_memory(kind,text,meta,embedding,dim,created_at) "
                    "VALUES(?,?,?,?,?,?)",
                    (kind, text, json.dumps(meta or {}), blob, dim, time.time()),
                )
                wrote = cur.rowcount > 0
                row_id = cur.lastrowid if wrote else None
        except sqlite3.Error as e:
            log.warning("remember failed: %s", e)
            return False
        if not wrote:
            return False
        # Incremental index append — never a full rebuild on insert.
        if vec:
            norm = _normalize(vec)
            if norm is not None:
                if self._vec_ok:
                    self._vec_insert(row_id, norm, dim)
                else:
                    self._py_append(row_id, kind, text, meta or {}, norm)
        log.debug("remembered [%s] %s", kind, text[:80])
        return True

    async def recall(
        self, query: str, k: int | None = None, min_score: float | None = None,
    ) -> list[dict]:
        """Return up to k facts most cosine-similar to query, each with a
        ``score`` in [0,1]. Empty list if embeddings unavailable or no hits."""
        query = (query or "").strip()
        if not query:
            return []
        k = k or self.cfg.ultimate.recall_k
        min_score = self.cfg.ultimate.recall_min_score if min_score is None else min_score

        qv = await self.embedder.embed(query)
        if not qv:
            return []
        q = _normalize(qv)
        if q is None:
            return []

        if self._vec_ok:
            scored = self._vec_recall(q, k, min_score)
        else:
            scored = self._py_recall(q, k, min_score)
        if not scored:
            return []
        self._touch([r["id"] for _, r in scored])
        return [
            {
                "id": row["id"],
                "kind": row["kind"],
                "text": row["text"],
                "meta": row["meta"],
                "score": round(score, 4),
            }
            for score, row in scored
        ]

    # ------------------------------------------------------------------
    # sqlite-vec backend
    # ------------------------------------------------------------------
    def _vec_table_dim(self) -> int | None:
        """Dim of the existing vec table, or None if there is no table yet."""
        with self._conn() as c:
            row = c.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
                (_VEC_TABLE,),
            ).fetchone()
        if not row:
            return None
        import re

        m = re.search(r"float\[(\d+)\]", row[0] or "")
        return int(m.group(1)) if m else None

    def _vec_counts_match(self, dim: int) -> bool:
        """True when the vec table holds exactly the rows it should for dim."""
        try:
            with self._conn() as c:
                have = int(c.execute(f"SELECT COUNT(*) FROM {_VEC_TABLE}").fetchone()[0])
                want = int(
                    c.execute(
                        "SELECT COUNT(*) FROM semantic_memory WHERE dim=?", (dim,)
                    ).fetchone()[0]
                )
            return have == want
        except sqlite3.Error:
            return False

    def _vec_sync(self, dim: int) -> None:
        """Create the vec table if missing / wrong dim, and rebuild it when
        its row count drifted from the source table (e.g. rows written while
        sqlite-vec was unavailable, or an external edit)."""
        table_dim = self._vec_table_dim()
        if table_dim is None or table_dim != dim or not self._vec_counts_match(dim):
            self._vec_rebuild(dim)

    def _vec_rebuild(self, dim: int) -> None:
        """Drop + recreate the vec table and backfill from stored blobs."""
        import sqlite_vec

        with self._conn() as c:
            c.execute(f"DROP TABLE IF EXISTS {_VEC_TABLE}")
            c.execute(
                f"CREATE VIRTUAL TABLE {_VEC_TABLE} USING vec0(embedding float[{dim}])"
            )
            rows = c.execute(
                "SELECT id, embedding FROM semantic_memory WHERE dim=?", (dim,)
            ).fetchall()
            inserted = 0
            for r in rows:
                vec = _from_blob(r["embedding"], dim)
                norm = _normalize(vec) if vec else None
                if norm is None:
                    continue
                c.execute(
                    f"INSERT INTO {_VEC_TABLE}(rowid, embedding) VALUES(?, ?)",
                    (r["id"], sqlite_vec.serialize_float32(norm)),
                )
                inserted += 1
        self._vec_dim = dim
        log.info("rebuilt %s: %d vectors (dim=%d)", _VEC_TABLE, inserted, dim)

    def _vec_insert(self, row_id: int, norm: list[float], dim: int) -> None:
        import sqlite_vec

        try:
            if self._vec_dim is None or self._vec_dim != dim:
                # Only ensure the table exists with the right dim here.
                # (A rebuild backfills rows already in semantic_memory, which
                # may include this one — hence the DELETE before INSERT
                # below.) Count-drift repair stays on the recall path
                # (_vec_sync), so inserts stay O(1) instead of rebuilding
                # per fact.
                if self._vec_table_dim() != dim:
                    self._vec_rebuild(dim)
                else:
                    self._vec_dim = dim
            with self._conn() as c:
                # NB: vec0 tables do NOT honour INSERT OR REPLACE — a
                # conflicting rowid raises UNIQUE instead. DELETE first.
                c.execute(f"DELETE FROM {_VEC_TABLE} WHERE rowid=?", (row_id,))
                c.execute(
                    f"INSERT INTO {_VEC_TABLE}(rowid, embedding) VALUES(?, ?)",
                    (row_id, sqlite_vec.serialize_float32(norm)),
                )
        except sqlite3.Error as e:
            # Index write failed — the fact is still in semantic_memory; the
            # next recall's sync check rebuilds the table. Never lose a fact
            # over an index hiccup.
            log.warning("vec index insert failed (will rebuild on next recall): %s", e)
            self._vec_dim = None

    def _vec_recall(
        self, q: list[float], k: int, min_score: float
    ) -> list[tuple[float, dict]]:
        import sqlite_vec

        dim = len(q)
        self._vec_sync(dim)
        with self._conn() as c:
            rows = c.execute(
                f"SELECT rowid, distance FROM {_VEC_TABLE} "
                "WHERE embedding MATCH ? AND k = ? ORDER BY distance",
                (sqlite_vec.serialize_float32(q), k),
            ).fetchall()
        if not rows:
            return []
        # vec0 `distance` is L2 over unit vectors: d² = 2 − 2·cos → cos = 1 − d²/2.
        scored: list[tuple[float, dict]] = []
        ids = [r["rowid"] for r in rows]
        with self._conn() as c:
            db_rows = {
                r["id"]: r
                for r in c.execute(
                    "SELECT id, kind, text, meta FROM semantic_memory WHERE id IN (%s)"
                    % ",".join("?" * len(ids)),
                    ids,
                ).fetchall()
            }
        for r in rows:
            score = 1.0 - (float(r["distance"]) ** 2) / 2.0
            if score < min_score:
                continue
            db = db_rows.get(r["rowid"])
            if db is None:
                continue
            scored.append((
                score,
                {
                    "id": db["id"],
                    "kind": db["kind"],
                    "text": db["text"],
                    "meta": _safe_json(db["meta"]),
                },
            ))
        scored.sort(key=lambda t: t[0], reverse=True)
        return scored

    # ------------------------------------------------------------------
    # Pure-Python backend — matrix loaded ONCE per process, append on insert
    # ------------------------------------------------------------------
    def _py_ensure_loaded(self) -> None:
        if self._py_loaded:
            return
        with self._conn() as c:
            raw = c.execute(
                "SELECT id, kind, text, meta, embedding, dim FROM semantic_memory "
                "WHERE dim > 0"
            ).fetchall()
        self._py_index = []
        for r in raw:
            vec = _from_blob(r["embedding"], r["dim"])
            norm = _normalize(vec) if vec else None
            if norm is None:
                continue
            self._py_index.append(
                (r["id"], r["kind"], r["text"], _safe_json(r["meta"]), norm)
            )
        self._py_loaded = True
        log.debug("python vector index loaded once: %d vectors", len(self._py_index))

    def _py_append(
        self, row_id: int, kind: str, text: str, meta: dict, norm: list[float]
    ) -> None:
        self._py_ensure_loaded()
        # The row is already in the DB when this is called, so a first
        # load already contains it — skip the duplicate append.
        if any(e[0] == row_id for e in self._py_index):
            return
        self._py_index.append((row_id, kind, text, dict(meta), norm))

    def _py_recall(
        self, q: list[float], k: int, min_score: float
    ) -> list[tuple[float, dict]]:
        self._py_ensure_loaded()
        scored: list[tuple[float, dict]] = []
        for row_id, kind, text, meta, vec in self._py_index:
            if len(vec) != len(q):
                continue
            score = sum(a * b for a, b in zip(q, vec))  # both unit → cosine
            if score >= min_score:
                scored.append((
                    score,
                    {"id": row_id, "kind": kind, "text": text, "meta": meta},
                ))
        scored.sort(key=lambda t: t[0], reverse=True)
        return scored[:k]

    # ------------------------------------------------------------------
    def _touch(self, ids: list[int]) -> None:
        if not ids:
            return
        now = time.time()
        with self._conn() as c:
            c.executemany(
                "UPDATE semantic_memory SET last_recalled=? WHERE id=?",
                [(now, i) for i in ids],
            )

    def count(self) -> int:
        with self._conn() as c:
            return int(c.execute("SELECT COUNT(*) FROM semantic_memory").fetchone()[0])

    def recent(self, limit: int = 50) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT id, kind, text, meta, created_at, last_recalled "
                "FROM semantic_memory ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {**dict(r), "meta": _safe_json(r["meta"])}
            for r in rows
        ]

    def forget(self, mem_id: int) -> bool:
        with self._conn() as c:
            cur = c.execute("DELETE FROM semantic_memory WHERE id=?", (mem_id,))
            deleted = cur.rowcount > 0
            if deleted and self._vec_ok:
                try:
                    c.execute(f"DELETE FROM {_VEC_TABLE} WHERE rowid=?", (mem_id,))
                except sqlite3.Error as e:
                    log.warning("vec index delete failed: %s", e)
        if deleted and not self._vec_ok:
            self._py_index = [e for e in self._py_index if e[0] != mem_id]
        return deleted


def _sqlite_vec_available() -> bool:
    """True when the sqlite-vec extension can actually be loaded here."""
    try:
        import sqlite_vec

        conn = sqlite3.connect(":memory:")
        try:
            conn.enable_load_extension(True)
            conn.load_extension(sqlite_vec.loadable_path())
            conn.execute("CREATE VIRTUAL TABLE _probe USING vec0(embedding float[2])")
        finally:
            conn.close()
        return True
    except Exception as e:  # noqa: BLE001
        log.info("sqlite-vec unavailable (%s) — using pure-python index", e)
        return False


def _to_blob(vec: list[float]) -> bytes:
    # float32 little-endian — byte-identical to the old numpy tobytes()
    # on x86, so existing stored blobs keep working.
    return struct.pack(f"<{len(vec)}f", *vec)


def _from_blob(blob: bytes | None, dim: int) -> list[float] | None:
    if not blob or dim <= 0:
        return None
    try:
        vals = struct.unpack(f"<{dim}f", bytes(blob[: dim * 4]))
        return list(vals) if len(vals) == dim else None
    except Exception:  # noqa: BLE001
        return None


def _safe_json(s: str | None) -> dict:
    if not s:
        return {}
    try:
        v = json.loads(s)
        return v if isinstance(v, dict) else {}
    except Exception:  # noqa: BLE001
        return {}
