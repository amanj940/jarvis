"""Tool registrations for the YouTube plugin.

Read-only tools are SAFE; anything that writes local state is CAUTION;
anything that would publish is DANGEROUS and is *not* implemented —
``youtube_prepare_upload`` only builds a draft plan and refuses to upload.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from ...core.permissions import Permission
from ..base import PluginInfo, tool
from .client import YouTubeClient, YouTubeNotConfigured
from .metrics import ChannelMetricsStore
from .seo import build_video_plan, score_title, suggest_titles


def _store(cfg) -> ChannelMetricsStore:
    return ChannelMetricsStore(cfg.abs_path("data/youtube.db"))


def _json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


def register(registry):
    cfg = registry.cfg
    toggle = cfg.plugins.get("youtube")
    if toggle is not None and not toggle.enabled:
        return

    @tool(
        name="youtube_channel_stats",
        description=(
            "Read a YouTube channel's subscribers/views/video count via the "
            "YouTube Data API (needs YOUTUBE_API_KEY). Stores a snapshot for "
            "growth tracking. Use channel_id or set YOUTUBE_CHANNEL_ID."
        ),
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "channel_id": {"type": "string"},
            "record": {"type": "boolean", "default": True},
        }},
    )
    async def youtube_channel_stats(channel_id: str | None = None, record: bool = True) -> str:
        client = YouTubeClient()
        try:
            stats = await client.channel_stats(channel_id)
        except YouTubeNotConfigured as e:
            return _json({"ok": False, "error": str(e),
                          "setup": "docs/youtube-opportunity.md"})
        if not stats.get("ok"):
            return _json(stats)
        if record:
            _store(cfg).record_channel(stats)
        return _json(stats)

    @tool(
        name="youtube_search",
        description=(
            "Search YouTube videos via the YouTube Data API (needs "
            "YOUTUBE_API_KEY). If no key is configured this returns setup "
            "instructions instead of silently scraping youtube.com — use "
            "web_search as the read-only fallback in that case."
        ),
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "query": {"type": "string"},
            "max_results": {"type": "integer", "default": 10},
            "channel_id": {"type": "string"},
        }, "required": ["query"]},
    )
    async def youtube_search(query: str, max_results: int = 10,
                             channel_id: str | None = None) -> str:
        client = YouTubeClient()
        if not client.configured:
            return _json({
                "ok": False,
                "error": "YOUTUBE_API_KEY is not set",
                "fallback": "Use web_search for a read-only video search until "
                            "the API key is configured (see docs/youtube-opportunity.md). "
                            "Scraping youtube.com/results is NOT the main path.",
            })
        results = await client.search_videos(query, max_results=max_results,
                                             channel_id=channel_id)
        return _json({"ok": True, "query": query, "results": results})

    @tool(
        name="youtube_video_plan",
        description=(
            "Build a reviewable YouTube video plan: scored titles, description, "
            "tags and thumbnail checklist. Draft only — never uploads."
        ),
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "topic": {"type": "string"},
            "keywords": {"type": "array", "items": {"type": "string"}},
            "channel_id": {"type": "string"},
        }, "required": ["topic"]},
    )
    def youtube_video_plan(topic: str, keywords: list | None = None,
                           channel_id: str | None = None) -> str:
        return _json({"ok": True, "plan": build_video_plan(topic, keywords, channel_id)})

    @tool(
        name="youtube_prepare_upload",
        description=(
            "Prepare (only) a YouTube upload draft: title plan, description, "
            "tags, thumbnail checklist. It does NOT upload, schedule, or "
            "publish — a human must approve and do that step explicitly."
        ),
        permission=Permission.CAUTION,
        parameters={"type": "object", "properties": {
            "topic": {"type": "string"},
            "keywords": {"type": "array", "items": {"type": "string"}},
            "video_file": {"type": "string"},
        }, "required": ["topic"]},
    )
    def youtube_prepare_upload(topic: str, keywords: list | None = None,
                               video_file: str | None = None) -> str:
        plan = build_video_plan(topic, keywords)
        if video_file and not Path(video_file).exists():
            return _json({"ok": False, "error": f"video file not found: {video_file}"})
        plan["video_file"] = video_file or ""
        return _json({"ok": True, "draft": plan,
                      "warning": "Upload is NOT done by Jarvis. Review the draft, "
                                 "then upload/schedule it yourself or approve it explicitly."})

    @tool(
        name="youtube_channel_growth",
        description="Show subscriber/view growth from recorded channel snapshots.",
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "channel_id": {"type": "string"},
        }, "required": ["channel_id"]},
    )
    def youtube_channel_growth(channel_id: str) -> str:
        return _json({"ok": True, "growth": _store(cfg).channel_growth(channel_id)})

    registry.add_pending("youtube")
    registry.register_plugin(PluginInfo(
        name="youtube",
        description="YouTube Data API: channel stats, search, video plans, metrics (needs YOUTUBE_API_KEY).",
        permissions_needed=[Permission.SAFE, Permission.CAUTION],
    ))
