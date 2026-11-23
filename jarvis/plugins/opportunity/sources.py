"""Opportunity sources — a curated, editable list, not a scraper.

Each source is a place Jarvis *may* look for work / deals. Fetching is
done by an injected fetcher (see ``jobs.py``); this module only defines
*where* to look and *what* counts as relevant. No source is fetched
automatically, and no source here implies an account, a credential, or
permission to act on that platform.
"""
from __future__ import annotations

from dataclasses import dataclass, field

DEFAULT_KEYWORDS = [
    "bug bounty", "security", "freelance", "remote", "contract",
    "ecommerce", "shopify", "youtube", "ai agent", "automation",
]


@dataclass
class Source:
    name: str
    kind: str  # bug_bounty | freelance | marketplace | news | trend
    url: str
    keywords: list[str] = field(default_factory=list)
    active: bool = True
    notes: str = ""


DEFAULT_SOURCES: list[Source] = [
    Source("HackerOne", "bug_bounty", "https://hackerone.com/opportunities",
           ["bug bounty", "security"], notes="Public programs list; needs an account to submit."),
    Source("Bugcrowd", "bug_bounty", "https://bugcrowd.com/programs",
           ["bug bounty", "security"], notes="Public programs list; needs an account to submit."),
    Source("Intigriti", "bug_bounty", "https://www.intigriti.com/programs",
           ["bug bounty", "security"]),
    Source("YesWeHack", "bug_bounty", "https://yeswehack.com/programs",
           ["bug bounty", "security"]),
    Source("Upwork", "freelance", "https://www.upwork.com/freelance-jobs/",
           ["freelance", "remote", "contract"]),
    Source("Product Hunt", "marketplace", "https://www.producthunt.com/",
           ["launch", "new product", "ai"]),
    Source("Hacker News", "news", "https://news.ycombinator.com/",
           ["launch", "ai", "startup"]),
]


def list_sources(active_only: bool = True) -> list[dict]:
    return [
        {"name": s.name, "kind": s.kind, "url": s.url,
         "keywords": list(s.keywords), "active": s.active, "notes": s.notes}
        for s in DEFAULT_SOURCES if (s.active or not active_only)
    ]


def validate_source(data: dict) -> Source:
    name = str(data.get("name") or "").strip()
    url = str(data.get("url") or "").strip()
    if not name or not url.startswith(("http://", "https://")):
        raise ValueError("source needs a name and an http(s) URL")
    kind = str(data.get("kind") or "news").strip()
    if kind not in {"bug_bounty", "freelance", "marketplace", "news", "trend"}:
        raise ValueError(f"unknown source kind {kind!r}")
    return Source(name=name, kind=kind, url=url,
                  keywords=list(data.get("keywords") or []),
                  active=bool(data.get("active", True)),
                  notes=str(data.get("notes") or ""))
