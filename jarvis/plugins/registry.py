"""Plugin discovery + tool registry.

Merged ui-hud-upgrade (Phase 2 minimal registry) + audit/fixes additions:
  - ``get_service`` / ``__getitem__`` — plugins reach shared services
    (e.g. ``registry.get_service("memory")``) without confusing them
    with tools (``get()`` resolves tools only).
  - ``ESSENTIAL_CORE_TOOLS`` / ``DOMAIN_TOOLS`` / ``ARABIC_TOOL_HINTS`` +
    ``relevant_tools()`` — query-aware tool selection (English + Arabic)
    for a bounded ``max_tools`` budget, with essential tools seeded
    first so they are never evicted mid-chain.
  - ``schemas(..., always_include=...)`` — pin tools into a bounded
    schema list; pinned tools consume slots against ``max_tools``.
  - ``reload_all()`` — clear + re-import all enabled plugins.

Compatibility note (deliberate deviation from audit/fixes): ``schemas()``
and ``documentation()`` default to ``max_tools=0``, i.e. NO limit —
return every registered tool, exactly like the Phase 2 ui version.
The orchestrator calls both with no arguments and depends on seeing
all tools; audit/fixes' default of 24 would silently hide ~70 tools
from the LLM. Pass an explicit ``max_tools`` (and a ``query``) to get
the ranked subset. ``max_tools=0`` is the documented "no limit" value
(see tests/test_registry_schemas.py).
"""
from __future__ import annotations

import importlib
import logging
import pkgutil
import re
from typing import Any

from ..config import Config
from . import base as _base
from .base import PluginInfo, Tool

log = logging.getLogger("jarvis.plugins")


class PluginRegistry:
    def __init__(self, cfg: Config, services: dict[str, Any] | None = None):
        self.cfg = cfg
        self._tools: dict[str, Tool] = {}
        self._plugins: dict[str, PluginInfo] = {}
        # services pulled in by plugins (memory, action log, etc.)
        self.services: dict[str, Any] = services or {}

    def __getitem__(self, key: str) -> Any:
        """Allow plugins to access services via registry['memory']."""
        return self.services.get(key)

    def get_service(self, key: str, default: Any = None) -> Any:
        """Allow plugins to access services via registry.get_service('memory')."""
        return self.services.get(key, default)

    # ------------------------------------------------------------------
    def add(self, t: Tool) -> None:
        if t.name in self._tools:
            log.warning("tool '%s' already registered, overwriting", t.name)
        self._tools[t.name] = t

    def add_pending(self, plugin_name: str) -> None:
        for t in _base.consume_pending(plugin_name):
            self.add(t)

    def register_plugin(self, info: PluginInfo) -> None:
        self._plugins[info.name] = info

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def all_tools(self) -> list[Tool]:
        return list(self._tools.values())

    def plugins(self) -> list[PluginInfo]:
        return list(self._plugins.values())

    # ------------------------------------------------------------------
    # Minimal baseline tools that should always be available
    ESSENTIAL_CORE_TOOLS = {
        "web_search", "run_shell", "system_status", "remember", "recall",
        "desktop_click_text", "desktop_type_into", "chrome_open_url", "computer",
    }

    # Extended domain tools mapped to specific topics
    DOMAIN_TOOLS = {
        "desktop_click", "desktop_type", "desktop_open_and_focus", "desktop_list_windows",
        "chrome_close_tab", "chrome_switch_tab", "gmail_open", "gmail_search", "gmail_send_email", "gmail_read_inbox_summary",
        "youtube_open_studio", "youtube_get_channel_stats", "youtube_research_niche_trends", "youtube_generate_content_strategy",
        "youtube_create_short", "gcloud_console_open", "chatgpt_open", "chatgpt_ask", "read_file", "write_file", "list_dir",
    }

    ARABIC_TOOL_HINTS = {
        "ملف": ["file", "dir", "read", "write", "scan", "list"],
        "مجلد": ["dir", "folder", "list_dir", "scan"],
        "اقرأ": ["read_file", "file_read", "read"],
        "اكتب": ["write_file", "desktop_type", "type_into"],
        "احذف": ["delete", "remove", "clean"],
        "برمج": ["code", "debug", "python", "node"],
        "كود": ["code", "debug", "snippet", "python"],
        "شغل": ["run", "shell", "exec", "start"],
        "نفذ": ["run", "shell", "exec"],
        "ابحث": ["search", "web_search", "find", "google"],
        "بحث": ["search", "web_search", "find"],
        "جوجل": ["web_search", "chrome"],
        "نت": ["web_search", "network"],
        "موقع": ["chrome_open_url", "web_search", "url"],
        "رابط": ["chrome_open_url", "web_search", "url"],
        "بريد": ["gmail", "email", "inbox", "mail"],
        "إيميل": ["gmail", "email", "inbox"],
        "ايميل": ["gmail", "email", "inbox"],
        "جيميل": ["gmail_open", "gmail_read_inbox_summary", "gmail_send_email"],
        "رسائل": ["gmail", "email", "inbox"],
        "يوتيوب": ["youtube", "video", "shorts", "channel"],
        "يوتوب": ["youtube", "video", "shorts"],
        "فيديو": ["video", "youtube", "shorts"],
        "شورتس": ["youtube_create_short", "shorts"],
        "قناة": ["youtube_get_channel_stats", "youtube_open_studio"],
        "صورة": ["image_generate", "image", "vision"],
        "رسم": ["image_generate", "flux"],
        "سطح": ["desktop", "window", "screen"],
        "شاشة": ["screen", "desktop_get_screen_info", "screenshot"],
        "نافذة": ["window", "desktop_focus_window"],
        "انقر": ["desktop_click", "desktop_click_text"],
        "اضغط": ["desktop_click", "desktop_press_key"],
        "سايبر": ["cyberlab", "harness", "scan"],
        "أمان": ["security", "cyberlab", "audit"],
        "فحص": ["scan", "audit", "test", "status"],
        "ذاكرة": ["memory", "remember", "recall"],
        "تذكر": ["remember", "memory"],
        "احفظ": ["remember", "memory", "write_file"],
        "سيرفر": ["system_status", "system_monitor"],
        "معالج": ["system_status", "cpu"],
        "رام": ["system_status", "ram"],
        "شبكة": ["system_status", "network"],
    }

    def relevant_tools(self, query: str = "", max_tools: int = 28) -> list[Tool]:
        """Select a concise subset of relevant tools based on query keywords.
        Supports both English and Arabic query intent mapping."""
        if not self._tools:
            return []

        lower_query = (query or "").lower()
        words = set(re.findall(r"[\w-]+", lower_query))

        # Expand Arabic keywords to relevant English tool tokens
        expanded_tokens: set[str] = set()
        for ar_term, en_tokens in self.ARABIC_TOOL_HINTS.items():
            if ar_term in lower_query:
                expanded_tokens.update(en_tokens)
        all_search_tokens = words | expanded_tokens

        scored: list[tuple[int, Tool]] = []
        for name, t in self._tools.items():
            score = 0
            if name in self.ESSENTIAL_CORE_TOOLS:
                score += 2  # Baseline priority for essential tools

            name_parts = set(name.lower().split("_"))
            overlap = all_search_tokens & name_parts
            if overlap:
                score += len(overlap) * 5

            desc_words = set(re.findall(r"[\w-]+", (t.description or "").lower()))
            desc_overlap = all_search_tokens & desc_words
            if desc_overlap:
                score += len(desc_overlap) * 2

            scored.append((score, t))

        scored.sort(key=lambda x: x[0], reverse=True)

        selected: dict[str, Tool] = {}
        # 0. Seed essential core tools first — ranking must never evict them.
        # This guarantees "computer" and friends are always callable, which is
        # required for computer-use chains to even start on the first hop.
        for name in self.ESSENTIAL_CORE_TOOLS:
            if len(selected) >= max_tools:
                break
            t = self._tools.get(name)
            if t is not None:
                selected[name] = t

        # 1. Pick the highest scoring tools matching intent
        for score, t in scored:
            if len(selected) >= max_tools:
                break
            if t.name in selected:
                continue
            if score > 2 or len(selected) < (max_tools // 2):
                selected[t.name] = t

        return list(selected.values())

    def schemas(
        self,
        query: str = "",
        max_tools: int = 0,
        always_include: set[str] | None = None,
    ) -> list[dict]:
        """JSON schemas suitable for OpenAI / Anthropic native tool calls.

        ``max_tools=0`` (default) means no limit: every registered tool
        is returned — the behaviour the orchestrator relies on when it
        calls ``schemas()`` with no arguments. Pass an explicit budget
        to get the ranked subset instead.

        Tools named in ``always_include`` are pinned into the result and never
        evicted by ranking, but they still consume slots against ``max_tools``.
        """
        tools: list[Tool]
        if not max_tools:
            tools = list(self._tools.values())
        elif always_include:
            pinned: dict[str, Tool] = {
                n: self._tools[n] for n in (always_include or set()) if n in self._tools
            }
            selected: dict[str, Tool] = dict(pinned)
            remaining = max(0, max_tools - len(pinned))
            if remaining > 0:
                for t in self.relevant_tools(query, remaining):
                    if t.name in selected:
                        continue
                    selected[t.name] = t
                    if len(selected) >= max_tools:
                        break
            tools = list(selected.values())
        else:
            tools = self.relevant_tools(query, max_tools)
        return [
            {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
            }
            for t in tools
        ]

    def documentation(self, query: str = "", max_tools: int = 0) -> str:
        tools = self.relevant_tools(query, max_tools) if max_tools else list(self._tools.values())
        lines: list[str] = []
        for t in tools:
            params = t.parameters.get("properties", {}) or {}
            sig = ", ".join(params.keys())
            desc = (t.description or "").split("\n")[0].strip()
            if len(desc) > 80:
                desc = desc[:77] + "..."
            lines.append(f"- {t.name}({sig}): {desc}")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    def load_all(self) -> None:
        """Import every plugin enabled in config and call its register()."""
        from . import (  # noqa: F401  — ensures package loaded for pkgutil
            base as _b,
        )
        pkg = importlib.import_module("jarvis.plugins")
        prefix = pkg.__name__ + "."
        for mod_info in pkgutil.iter_modules(pkg.__path__):
            modname = mod_info.name
            if modname in {"__init__", "base", "registry"}:
                continue
            toggle = self.cfg.plugins.get(modname)
            if toggle is not None and not toggle.enabled:
                log.info("plugin '%s' disabled in config", modname)
                continue
            try:
                m = importlib.import_module(prefix + modname)
            except Exception as e:  # noqa: BLE001
                log.error("failed to import plugin '%s': %s", modname, e)
                continue
            if not hasattr(m, "register"):
                log.warning("plugin '%s' has no register(registry)", modname)
                continue
            try:
                m.register(self)
                log.info("plugin '%s' loaded", modname)
            except Exception as e:  # noqa: BLE001
                log.error("plugin '%s' register() failed: %s", modname, e)

    def reload_all(self) -> None:
        """Clear registered tools and plugins, re-read config, and re-import all enabled plugins."""
        self._tools.clear()
        self._plugins.clear()
        self.load_all()
        log.info("Plugin registry reloaded: %d active tools across %d plugins", len(self._tools), len(self._plugins))
