"""YouTube plugin (Data API v3).

The plugin name stays ``youtube`` so config, ``/api/plugins`` output and
the registry are stable. All heavy work is lazy: no API call happens at
import or registration time — only when a tool runs, and only with
``YOUTUBE_API_KEY`` set (see ``docs/youtube-opportunity.md``).
"""
from __future__ import annotations

from .client import YouTubeClient, YouTubeNotConfigured
from .metrics import ChannelMetricsStore
from .seo import build_video_plan, score_title, suggest_titles
from .tools import register

__all__ = [
    "ChannelMetricsStore",
    "YouTubeClient",
    "YouTubeNotConfigured",
    "build_video_plan",
    "register",
    "score_title",
    "suggest_titles",
]
