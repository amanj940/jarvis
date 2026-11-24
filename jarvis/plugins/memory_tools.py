"""User-facing memory tools. Wraps the Memory service."""
from __future__ import annotations

import hashlib
import json
import math
import time

from ..core.permissions import Permission
from .base import PluginInfo, tool

MEDIA_PREFIX = "__JARVIS_MEDIA__"

# Cluster palette — distinct neon colors per memory category.
CLUSTER_COLOR: dict[str, str] = {
    "preference":  "#22d3ee",  # cyan
    "note":        "#a78bfa",  # violet
    "fix":         "#f472b6",  # pink
    "path":        "#fbbf24",  # amber
    "tool":        "#34d399",  # emerald
    "command":     "#fb923c",  # orange
    "conversation":"#67e8f9",  # aqua
}


def register(registry):
    memory = registry.services.get("memory")
    if memory is None:
        import logging
        logging.getLogger("jarvis.plugins").warning(
            "memory_tools: 'memory' service unavailable — skipping registration"
        )
        return

    @tool(
        name="remember",
        description="Store a user preference key/value pair.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "key": {"type": "string"},
                "value": {},
            },
            "required": ["key", "value"],
        },
    )
    def remember(key: str, value) -> str:
        memory.set_pref(key, value)
        return f"remembered {key} = {value!r}"

    @tool(
        name="recall",
        description="Retrieve a stored user preference by key.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {"key": {"type": "string"}},
            "required": ["key"],
        },
    )
    def recall(key: str) -> str:
        v = memory.get_pref(key)
        return f"{key} = {v!r}" if v is not None else f"no pref for {key}"

    @tool(
        name="forget",
        description="Delete a stored preference.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {"key": {"type": "string"}},
            "required": ["key"],
        },
    )
    def forget(key: str) -> str:
        ok = memory.delete("preference", key)
        return "forgotten" if ok else "nothing to forget"

    @tool(
        name="list_prefs",
        description="List all stored user preferences.",
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {}},
    )
    def list_prefs() -> str:
        prefs = memory.all_prefs()
        if not prefs:
            return "(no preferences stored)"
        return "\n".join(f"- {k} = {v!r}" for k, v in prefs.items())

    @tool(
        name="add_note",
        description="Add a free-form note tied to a project path.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "note": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}, "default": []},
            },
            "required": ["project", "note"],
        },
    )
    def add_note(project: str, note: str, tags: list[str] | None = None) -> str:
        nid = memory.add_note(project, note, tags=tags or [])
        return f"note #{nid} added"

    @tool(
        name="list_notes",
        description="List notes (optionally filtered by project).",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {"project": {"type": "string", "default": ""}},
        },
    )
    def list_notes(project: str = "") -> str:
        rows = memory.notes(project or None)
        if not rows:
            return "(no notes)"
        return "\n".join(f"#{r['id']} [{r['project']}] {r['note']}" for r in rows[:50])

    @tool(
        name="search_memory",
        description="Full-text search across prefs, notes, fixes, and known paths.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "default": 20}},
            "required": ["query"],
        },
    )
    def search_memory(query: str, limit: int = 20) -> str:
        hits = memory.search(query, limit=limit)
        if not hits:
            return "(no matches)"
        return "\n".join(f"[{h['kind']}] {h['title']}: {h['body']}" for h in hits)

    @tool(
        name="set_path",
        description="Save a labeled path JARVIS should remember (e.g. 'main_project', 'docs_root').",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "label": {"type": "string"},
                "path": {"type": "string"},
                "kind": {"type": "string", "default": ""},
            },
            "required": ["label", "path"],
        },
    )
    def set_path(label: str, path: str, kind: str = "") -> str:
        memory.set_path(label, path, kind)
        return f"saved {label} -> {path}"

    @tool(
        name="get_path",
        description="Retrieve a labeled path.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {"label": {"type": "string"}},
            "required": ["label"],
        },
    )
    def get_path(label: str) -> str:
        p = memory.get_path(label)
        return p or f"no path for label {label!r}"

    @tool(
        name="list_paths",
        description="List all labeled known paths.",
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {}},
    )
    def list_paths() -> str:
        rows = memory.list_paths()
        if not rows:
            return "(no known paths)"
        return "\n".join(f"{r['label']:20s} {r['kind']:>10s}  {r['path']}" for r in rows)

    @tool(
        name="record_tool",
        description="Note that a tool/lib is installed.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "version": {"type": "string", "default": ""},
                "notes": {"type": "string", "default": ""},
            },
            "required": ["name"],
        },
    )
    def record_tool(name: str, version: str = "", notes: str = "") -> str:
        memory.record_tool(name, version, notes)
        return f"recorded {name} {version}".strip()

    @tool(
        name="list_tools",
        description="List installed tools/libraries that JARVIS knows about.",
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {}},
    )
    def list_tools() -> str:
        rows = memory.list_tools()
        if not rows:
            return "(no recorded tools)"
        return "\n".join(f"{r['name']:20s} {r['version']:>15s}  {r['notes']}" for r in rows)

    @tool(
        name="add_fix",
        description="Remember a fix for a recurring error signature.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "error_signature": {"type": "string"},
                "fix": {"type": "string"},
                "context": {"type": "string", "default": ""},
            },
            "required": ["error_signature", "fix"],
        },
    )
    def add_fix(error_signature: str, fix: str, context: str = "") -> str:
        memory.add_fix(error_signature, fix, context)
        return "fix recorded"

    @tool(
        name="lookup_fix",
        description="Look up a previously-recorded fix matching an error signature.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {"error_signature": {"type": "string"}},
            "required": ["error_signature"],
        },
    )
    def lookup_fix(error_signature: str) -> str:
        hit = memory.lookup_fix(error_signature)
        if not hit:
            return "no known fix"
        return f"context: {hit.get('context','')}\nfix: {hit['fix']}"

    @tool(
        name="top_commands",
        description="Show the user's most-used shell commands tracked by JARVIS.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {"limit": {"type": "integer", "default": 10}},
        },
    )
    def top_commands(limit: int = 10) -> str:
        rows = memory.top_commands(limit)
        if not rows:
            return "(no commands tracked yet)"
        return "\n".join(f"{r['uses']:>4d}  {r['command']}" for r in rows)

    @tool(
        name="memory_galaxy",
        description=(
            "★ Show the user's MEMORY GALAXY — a 3D neural cloud of every "
            "preference, note, fix, path, tool, command, and recent "
            "conversation, clustered by category. Inline interactive view in "
            "the Media Bay. Trigger phrases: 'show my memory', 'memory galaxy', "
            "'what do you remember about me', 'visualise my data', "
            "'open the neural cloud', 'show me everything you know'."
        ),
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "limit_per_category": {"type": "integer", "default": 60},
            },
        },
        preview=lambda a: "memory_galaxy",
    )
    def memory_galaxy(limit_per_category: int = 60) -> str:
        nodes: list[dict] = []
        clusters: dict[str, dict] = {}

        def add(category: str, title: str, body: str, ts: float = 0.0):
            cluster = clusters.setdefault(category, {
                "name":  category.upper(),
                "color": CLUSTER_COLOR.get(category, "#22d3ee"),
                "count": 0,
                # Deterministic cluster anchor so repeat renders look stable.
                "anchor": _anchor_from_name(category),
            })
            cluster["count"] += 1
            node_id = hashlib.md5(f"{category}:{title}".encode()).hexdigest()[:10]
            nodes.append({
                "id":       node_id,
                "category": category,
                "color":    cluster["color"],
                "title":    title[:80],
                "body":     (body or "")[:240],
                "ts":       ts,
                # Spread within cluster — small jitter on anchor.
                "anchor":   cluster["anchor"],
            })

        # preferences
        for k, v in (memory.all_prefs() or {}).items():
            add("preference", k, json.dumps(v) if not isinstance(v, str) else v)
        # notes
        for r in memory.notes()[: limit_per_category]:
            add("note", f"{r.get('project','?')} #{r.get('id','')}",
                r.get("note", ""), r.get("created_at", 0) or 0)
        # fixes
        try:
            with memory._conn() as c:
                rows = c.execute(
                    "SELECT error_signature AS title, fix AS body, created_at AS ts "
                    "FROM past_fixes ORDER BY created_at DESC LIMIT ?",
                    (limit_per_category,),
                ).fetchall()
            for r in rows:
                add("fix", r["title"], r["body"], r["ts"] or 0)
        except Exception:
            pass
        # paths
        for r in memory.list_paths():
            add("path", r.get("label", ""), r.get("path", ""))
        # tools
        for r in memory.list_tools():
            add("tool", r.get("name", ""), r.get("notes", "") or r.get("version", ""))
        # commands
        for r in memory.top_commands(limit_per_category):
            add("command", str(r.get("uses", 0)), r.get("command", ""), r.get("last_used", 0) or 0)
        # conversations (sample only — too noisy at full size)
        for r in memory.recent_messages(min(limit_per_category, 40)):
            add("conversation", r.get("role", ""), r.get("content", ""), r.get("created_at", 0) or 0)

        payload = {
            "kind": "galaxy",
            "items": nodes,
            "clusters": list(clusters.values()),
            "summary": f"Memory galaxy: {len(nodes)} nodes across {len(clusters)} clusters.",
            "generated_at": time.time(),
        }
        return MEDIA_PREFIX + json.dumps(payload, ensure_ascii=False)

    # ── Universal Dynamic Database Tools (build a field for anything) ───────────
    @tool(
        name="db_store",
        description="Store or update a structured record with any fields/attributes in the local database.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "collection": {"type": "string", "description": "Category or collection name (e.g. 'devices', 'projects', 'user_info', 'credentials_hints')"},
                "key": {"type": "string", "description": "Unique key or name of the entity"},
                "data": {"type": "object", "description": "Arbitrary fields and values as a JSON object"},
                "tags": {"type": "array", "items": {"type": "string"}, "description": "Optional search tags"},
            },
            "required": ["collection", "key", "data"],
        },
    )
    def db_store(collection: str, key: str, data: dict, tags: list[str] | None = None) -> str:
        res = memory.store_entity(collection, key, data, tags)
        return f"Stored {collection}:{key} with fields: {list(res.keys())}"

    @tool(
        name="db_set_field",
        description="Add or update a single field/attribute inside an entity in the local database (build a field for anything).",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "collection": {"type": "string", "description": "Collection name (e.g. 'user_info', 'devices', 'servers')"},
                "key": {"type": "string", "description": "Entity key/name"},
                "field_name": {"type": "string", "description": "The attribute or field name to add/update"},
                "field_value": {"description": "The value for this field (string, number, list, or object)"},
            },
            "required": ["collection", "key", "field_name", "field_value"],
        },
    )
    def db_set_field(collection: str, key: str, field_name: str, field_value) -> str:
        res = memory.set_entity_field(collection, key, field_name, field_value)
        return f"Updated {collection}:{key}.{field_name} = {field_value!r} (Entity now has {len(res)} fields)"

    @tool(
        name="db_get",
        description="Retrieve an entity and all its stored fields from the local database.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "collection": {"type": "string", "description": "Collection name"},
                "key": {"type": "string", "description": "Entity key/name"},
            },
            "required": ["collection", "key"],
        },
    )
    def db_get(collection: str, key: str) -> str:
        ent = memory.get_entity(collection, key)
        if ent is None:
            return f"Not found: {collection}:{key}"
        return json.dumps(ent, ensure_ascii=False, indent=2)

    @tool(
        name="db_query",
        description="Search across all entities and fields stored in the local database.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "collection": {"type": "string", "default": "", "description": "Filter by collection name (optional)"},
                "query": {"type": "string", "default": "", "description": "Search keyword matching key or field values"},
                "tag": {"type": "string", "default": "", "description": "Filter by tag"},
            },
        },
    )
    def db_query(collection: str = "", query: str = "", tag: str = "") -> str:
        hits = memory.query_entities(collection, query, tag)
        if not hits:
            return "No matching entities found in database."
        lines = [f"Found {len(hits)} matching record(s):"]
        for h in hits:
            fields_summary = ", ".join(f"{k}={v!r}" for k, v in list(h["fields"].items())[:4])
            lines.append(f"• [{h['collection']}] {h['key']}: {fields_summary}")
        return "\n".join(lines)

    @tool(
        name="db_list_collections",
        description="List all custom collections and entity counts in the local database.",
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {}},
    )
    def db_list_collections() -> str:
        cols = memory.list_collections()
        if not cols:
            return "No custom collections in database yet."
        lines = ["Database Collections:"]
        for c in cols:
            sample = f" (e.g. {', '.join(c['sample_keys'])})" if c.get("sample_keys") else ""
            lines.append(f"• {c['collection']}: {c['count']} items{sample}")
        return "\n".join(lines)

    registry.add_pending("memory_tools")
    registry.register_plugin(PluginInfo(
        name="memory_tools",
        description="Read/write local memory: prefs, notes, fixes, paths, and dynamic schema-less universal database.",
        permissions_needed=[Permission.SAFE],
    ))


def _anchor_from_name(name: str) -> list[float]:
    """Stable 3D anchor in [-1,1] for a cluster name."""
    h = hashlib.md5(name.encode()).digest()
    # 3 floats from first 12 bytes
    coords = []
    for i in range(3):
        b = int.from_bytes(h[i*4:(i+1)*4], "big")
        coords.append((b / 2**32) * 2.0 - 1.0)
    # normalise to fixed radius ~0.7 so clusters orbit center, not stack
    length = math.sqrt(sum(c * c for c in coords)) or 1.0
    return [c / length * 0.7 for c in coords]
