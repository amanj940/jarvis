"""Unified memory store (Phase 2).

One API over the two stores that used to be reached separately:

- :class:`jarvis.core.memory.Memory` — keyword SQLite store (prefs, notes,
  paths, fixes, tools, rolling conversation history).
- :class:`jarvis.core.semantic_memory.SemanticMemory` — embedding recall
  over the same SQLite file (``semantic_memory`` table).

Both keep their own schema and tables — this module changes **no SQL**
and no stored-data semantics; it only unifies access so the orchestrator
and the memory tools stop juggling two objects. Keyword methods delegate
to ``Memory``; semantic ``remember``/``recall`` delegate to the
``SemanticMemory`` when one was built, and degrade to no-ops (``False`` /
``[]``) when embeddings are unavailable — exactly the old behaviour.

Usage (see main.py)::

    memory = MemoryStore(cfg, semantic=semantic)   # semantic may be None
    memory.set_pref("theme", "dark")               # keyword, as before
    await memory.remember("user likes tea")        # semantic, if available
    hits = await memory.recall("what does the user like?")
    both = await memory.search_all("tea")          # {"keyword": [...], "semantic": [...]}
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Iterable

from ..config import Config
from .memory import Memory

if TYPE_CHECKING:
    from .semantic_memory import SemanticMemory

log = logging.getLogger("jarvis.memory_store")


class MemoryStore:
    """Keyword + semantic memory behind a single API (same DB file)."""

    def __init__(self, cfg: Config, semantic: "SemanticMemory | None" = None):
        self.cfg = cfg
        self.keyword = Memory(cfg)
        self.semantic = semantic
        # Same path the old Memory object exposed (main.py logs it).
        self.path = self.keyword.path

    # ------------------------------------------------------------------
    # Semantic availability
    # ------------------------------------------------------------------
    @property
    def semantic_available(self) -> bool:
        return self.semantic is not None

    def semantic_count(self) -> int:
        return self.semantic.count() if self.semantic is not None else 0

    # ------------------------------------------------------------------
    # Unified API
    # ------------------------------------------------------------------
    async def remember(self, text: str, kind: str = "fact", meta: dict | None = None) -> bool:
        """Embed + persist a fact. False when embeddings are unavailable."""
        if self.semantic is None:
            return False
        return await self.semantic.remember(text, kind=kind, meta=meta)

    async def recall(
        self, query: str, k: int | None = None, min_score: float | None = None,
    ) -> list[dict]:
        """Top-K semantically similar facts. [] when embeddings unavailable."""
        if self.semantic is None:
            return []
        return await self.semantic.recall(query, k=k, min_score=min_score)

    async def search_all(self, query: str, limit: int = 20, k: int | None = None) -> dict[str, Any]:
        """Keyword search + semantic recall in one call.

        Returns ``{"keyword": [...], "semantic": [...]}``. The keyword side
        is synchronous SQLite LIKE matching; the semantic side is embedding
        cosine recall (empty when embeddings are unavailable).
        """
        return {
            "keyword": self.keyword.search(query, limit=limit),
            "semantic": await self.recall(query, k=k),
        }

    # ------------------------------------------------------------------
    # Keyword API — explicit pass-throughs to Memory (the full public API)
    # ------------------------------------------------------------------
    def set_pref(self, key: str, value: Any) -> None:
        self.keyword.set_pref(key, value)

    def get_pref(self, key: str, default: Any = None) -> Any:
        return self.keyword.get_pref(key, default)

    def all_prefs(self) -> dict[str, Any]:
        return self.keyword.all_prefs()

    def add_note(self, project: str, note: str, tags: Iterable[str] = ()) -> int:
        return self.keyword.add_note(project, note, tags)

    def notes(self, project: str | None = None) -> list[dict]:
        return self.keyword.notes(project)

    def bump_command(self, command: str) -> None:
        self.keyword.bump_command(command)

    def top_commands(self, limit: int = 10) -> list[dict]:
        return self.keyword.top_commands(limit)

    def add_goal(self, project: str, title: str, notes: str = "") -> int:
        return self.keyword.add_goal(project, title, notes)

    def goals(self, project: str | None = None, status: str | None = None) -> list[dict]:
        return self.keyword.goals(project, status)

    def complete_goal(self, goal_id: int, done: bool = True) -> dict | None:
        return self.keyword.complete_goal(goal_id, done)

    def add_fix(self, signature: str, fix: str, context: str = "") -> None:
        self.keyword.add_fix(signature, fix, context)

    def lookup_fix(self, signature: str) -> dict | None:
        return self.keyword.lookup_fix(signature)

    def set_path(self, label: str, path: str, kind: str = "") -> None:
        self.keyword.set_path(label, path, kind)

    def get_path(self, label: str) -> str | None:
        return self.keyword.get_path(label)

    def list_paths(self) -> list[dict]:
        return self.keyword.list_paths()

    def record_tool(self, name: str, version: str = "", notes: str = "") -> None:
        self.keyword.record_tool(name, version, notes)

    def list_tools(self) -> list[dict]:
        return self.keyword.list_tools()

    def append_message(self, role: str, content: str) -> None:
        self.keyword.append_message(role, content)

    def recent_messages(self, limit: int = 50) -> list[dict]:
        return self.keyword.recent_messages(limit)

    def search(self, query: str, limit: int = 20) -> list[dict]:
        return self.keyword.search(query, limit)

    def delete(self, kind: str, identifier: str) -> bool:
        return self.keyword.delete(kind, identifier)

    # ---- schema-less entities (audit/fixes db_* tools) ----
    def store_entity(
        self,
        collection: str,
        key: str,
        data: dict,
        tags: Iterable[str] | None = None,
    ) -> dict[str, Any]:
        return self.keyword.store_entity(collection, key, data, tags)

    def set_entity_field(
        self, collection: str, key: str, field_name: str, field_value: Any
    ) -> dict[str, Any]:
        return self.keyword.set_entity_field(collection, key, field_name, field_value)

    def get_entity(self, collection: str, key: str) -> dict[str, Any] | None:
        return self.keyword.get_entity(collection, key)

    def query_entities(
        self, collection: str = "", query: str = "", tag: str = ""
    ) -> list[dict[str, Any]]:
        return self.keyword.query_entities(collection, query, tag)

    def list_collections(self) -> list[dict[str, Any]]:
        return self.keyword.list_collections()

    # ------------------------------------------------------------------
    # Fallback: anything else (e.g. _conn) delegates to the keyword store.
    # ------------------------------------------------------------------
    def __getattr__(self, name: str) -> Any:
        return getattr(self.__dict__["keyword"], name)
