"""SEO / title / thumbnail workflow for YouTube videos.

Everything here is local and deterministic — no API, no LLM, no upload.
It produces a *plan* a human reviews. Publishing is deliberately out of
scope: ``build_video_plan`` always sets ``approval_required: True`` and
nothing in this module uploads, schedules, or publishes a video.
"""
from __future__ import annotations

import re

HOOK_WORDS = {
    "how", "why", "best", "free", "new", "secret", "ultimate", "complete",
    "easy", "fast", "step", "guide", "tutorial", "review", "vs", "top",
}
CLICKBAIT = {"shocking", "you won't believe", "gone wrong", "100% free money", "insane"}


def score_title(title: str) -> dict:
    """Score a title 0-100 with explainable components."""
    title = (title or "").strip()
    words = title.split()
    components: dict[str, int] = {}
    # Length: 40-60 chars is the sweet spot for search + display.
    n = len(title)
    components["length"] = 25 if 40 <= n <= 60 else (15 if 20 <= n < 40 or 60 < n <= 80 else 5)
    # Hook words present.
    low = title.lower()
    components["hook"] = 20 if any(w in low for w in HOOK_WORDS) else 5
    # A number (list / year / version) helps CTR.
    components["number"] = 15 if re.search(r"\d", title) else 0
    # Readability: not ALL CAPS, not too long, no clickbait spam.
    components["readability"] = 20 if title and title != title.upper() and len(words) <= 12 else 8
    components["clickbait_penalty"] = -20 if any(p in low for p in CLICKBAIT) else 0
    score = max(0, min(100, sum(components.values()) + 20))  # +20 baseline
    return {"title": title, "score": score, "components": components}


def suggest_titles(topic: str, keywords: list[str] | None = None) -> list[str]:
    """Template-based title variants — deterministic, no LLM call."""
    topic = (topic or "video").strip()
    kws = [k.strip() for k in (keywords or []) if k and k.strip()]
    kw = kws[0] if kws else topic
    return [
        f"How to {topic} — Complete Guide",
        f"{topic}: {kw} Explained in 10 Minutes",
        f"Best {topic} in 2026 — What Actually Works",
        f"{topic} for Beginners: Step by Step",
        f"5 {topic} Mistakes (and How to Fix Them)",
    ]


def thumbnail_checklist() -> list[str]:
    return [
        "1280x720 px, under 2 MB, JPG or PNG",
        "One clear subject, readable at small size",
        "At most 3-4 words of large, high-contrast text",
        "Face / emotion visible where it fits the topic",
        "Consistent brand colours — match the channel style",
        "No misleading image: thumbnail must match the video",
    ]


def description_template(title: str, keywords: list[str] | None = None) -> str:
    kws = ", ".join(keywords or [])
    lines = [title, "", "In this video:", "— What you will learn", "— Key steps", ""]
    if kws:
        lines.append(f"Keywords: {kws}")
    lines += ["", "Subscribe for more videos like this."]
    return "\n".join(lines)


def build_video_plan(topic: str, keywords: list[str] | None = None,
                     channel_id: str | None = None) -> dict:
    """Build a reviewable publishing plan. Does NOT upload anything."""
    titles = suggest_titles(topic, keywords)
    scored = [score_title(t) for t in titles]
    best = max(scored, key=lambda s: s["score"])
    return {
        "topic": topic,
        "channel_id": channel_id or "",
        "titles": scored,
        "best_title": best["title"],
        "best_title_score": best["score"],
        "description": description_template(best["title"], keywords),
        "tags": list(dict.fromkeys((keywords or []) + [topic]))[:15],
        "thumbnail_checklist": thumbnail_checklist(),
        "publishing_checklist": [
            "Review the title and description — edit before publishing",
            "Make / pick the thumbnail from the checklist",
            "Add end screen + cards",
            "Set playlist, language, and audience (made for kids?)",
            "Explicit human approval before any upload/schedule",
        ],
        "approval_required": True,
        "uploaded": False,
        "note": "Draft only. Jarvis never uploads or schedules a video "
                "without explicit human approval.",
    }
