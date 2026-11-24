"""YouTube Data API v3 client — config-gated, no keys in code.

The API key comes from the ``YOUTUBE_API_KEY`` environment variable (and
optionally ``YOUTUBE_CHANNEL_ID`` for the owner's channel). Nothing in this
module contains a key, a token, or a credential.

This is the *only* supported path for YouTube data in Jarvis. The old
``_yt_search`` in ``plugins/web_tools.py`` scrapes ``youtube.com/results``
— it is fragile, breaks when YouTube changes its page, and has no quota
or analytics. It remains only as a read-only fallback for plain video
*search* when no API key is configured, and the tools say so explicitly
instead of silently falling back to it.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import httpx

log = logging.getLogger("jarvis.youtube")

BASE_URL = "https://www.googleapis.com/youtube/v3"
SEARCH_URL = f"{BASE_URL}/search"
CHANNELS_URL = f"{BASE_URL}/channels"


class YouTubeNotConfigured(RuntimeError):
    """Raised when YOUTUBE_API_KEY is missing."""


def api_key_from_env() -> str:
    return os.environ.get("YOUTUBE_API_KEY", "").strip()


def channel_id_from_env() -> str:
    return os.environ.get("YOUTUBE_CHANNEL_ID", "").strip()


def _int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


# ----------------------------------------------------------------------
# Pure parsing helpers — unit-testable without any network.
# ----------------------------------------------------------------------
def parse_channel_stats(payload: dict) -> dict:
    """Parse a channels.list response (one channel) into a flat dict."""
    items = payload.get("items") or []
    if not items:
        return {"ok": False, "error": "channel not found"}
    item = items[0]
    stats = item.get("statistics") or {}
    snippet = item.get("snippet") or {}
    return {
        "ok": True,
        "channel_id": item.get("id", ""),
        "title": snippet.get("title", ""),
        "description": (snippet.get("description") or "")[:500],
        "subscribers": _int(stats.get("subscriberCount")),
        "views": _int(stats.get("viewCount")),
        "videos": _int(stats.get("videoCount")),
        "hidden_subscribers": bool(stats.get("hiddenSubscriberCount")),
    }


def parse_search_results(payload: dict) -> list[dict]:
    """Parse a search.list response into flat video dicts."""
    out: list[dict] = []
    for item in payload.get("items") or []:
        kind = (item.get("id") or {}).get("kind", "")
        if kind != "youtube#video":
            continue
        snippet = item.get("snippet") or {}
        thumbs = (snippet.get("thumbnails") or {}).get("high") or {}
        out.append({
            "video_id": (item.get("id") or {}).get("videoId", ""),
            "title": snippet.get("title", ""),
            "channel": snippet.get("channelTitle", ""),
            "channel_id": snippet.get("channelId", ""),
            "published": snippet.get("publishedAt", ""),
            "description": (snippet.get("description") or "")[:300],
            "thumbnail": thumbs.get("url", ""),
            "url": f"https://www.youtube.com/watch?v={(item.get('id') or {}).get('videoId', '')}",
        })
    return out


def parse_video_stats(payload: dict) -> list[dict]:
    """Parse a videos.list response into flat video dicts."""
    out: list[dict] = []
    for item in payload.get("items") or []:
        stats = item.get("statistics") or {}
        snippet = item.get("snippet") or {}
        out.append({
            "video_id": item.get("id", ""),
            "title": snippet.get("title", ""),
            "channel": snippet.get("channelTitle", ""),
            "published": snippet.get("publishedAt", ""),
            "views": _int(stats.get("viewCount")),
            "likes": _int(stats.get("likeCount")),
            "comments": _int(stats.get("commentCount")),
            "url": f"https://www.youtube.com/watch?v={item.get('id', '')}",
        })
    return out


# ----------------------------------------------------------------------
# Client
# ----------------------------------------------------------------------
class YouTubeClient:
    """Thin async wrapper around the YouTube Data API v3.

    ``transport`` exists for tests (``httpx.MockTransport``) — production
    code never passes one. Every call raises :class:`YouTubeNotConfigured`
    when no API key is set, instead of making an unauthenticated request.
    """

    def __init__(
        self,
        api_key: str | None = None,
        channel_id: str | None = None,
        transport: httpx.BaseTransport | None = None,
    ):
        self.api_key = (api_key if api_key is not None else api_key_from_env()).strip()
        self.channel_id = (channel_id if channel_id is not None else channel_id_from_env()).strip()
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _require_key(self) -> None:
        if not self.api_key:
            raise YouTubeNotConfigured(
                "YOUTUBE_API_KEY is not set — see docs/youtube-opportunity.md. "
                "No YouTube Data API calls can be made without it."
            )

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=self._transport, timeout=30)

    async def _get(self, url: str, params: dict) -> dict:
        self._require_key()
        params = {**params, "key": self.api_key}
        async with self._client() as client:
            resp = await client.get(url, params=params)
            if resp.status_code == 403:
                raise RuntimeError(
                    "YouTube API returned 403 — key invalid, quota exceeded, "
                    "or the API is not enabled in Google Cloud Console."
                )
            resp.raise_for_status()
            return resp.json()

    async def search_videos(
        self, query: str, max_results: int = 10, channel_id: str | None = None,
        order: str = "relevance",
    ) -> list[dict]:
        payload = await self._get(SEARCH_URL, {
            "part": "snippet", "q": query, "type": "video",
            "maxResults": max(1, min(50, max_results)), "order": order,
            **({"channelId": channel_id} if channel_id else {}),
        })
        return parse_search_results(payload)

    async def channel_stats(self, channel_id: str | None = None) -> dict:
        cid = channel_id or self.channel_id
        if not cid:
            raise ValueError("channel_id is required (arg or YOUTUBE_CHANNEL_ID)")
        payload = await self._get(CHANNELS_URL, {
            "part": "snippet,statistics", "id": cid,
        })
        return parse_channel_stats(payload)
