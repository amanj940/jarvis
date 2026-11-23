"""Explainable lead scoring — pure functions, no network, no LLM.

Score is 0-100 from keyword hits, urgency signals, and source weight,
minus penalties for stale/closed items. ``reasons`` lists every component
so a human can see *why* a lead ranked where it did.
"""
from __future__ import annotations

import re

URGENCY = {"urgent", "asap", "deadline", "limited", "new", "hiring", "wanted"}
STALE = {"closed", "expired", "filled", "cancelled", "ended", "old"}


def score_lead(title: str, description: str = "", keywords: list[str] | None = None,
               source_weight: float = 1.0) -> dict:
    text = f"{title or ''} {description or ''}".lower()
    kws = [k.lower() for k in (keywords or []) if k]
    reasons: list[str] = []
    score = 20.0  # baseline: a lead exists at all
    hits = [k for k in kws if k in text]
    if hits:
        score += min(40.0, 12.0 * len(hits))
        reasons.append(f"keyword hits: {', '.join(hits)} (+{min(40.0, 12.0 * len(hits)):.0f})")
    urgency = [w for w in URGENCY if re.search(rf"\b{re.escape(w)}\b", text)]
    if urgency:
        score += 10.0
        reasons.append(f"urgency signals: {', '.join(urgency)} (+10)")
    if len((title or "").strip()) >= 10:
        score += 10.0
        reasons.append("descriptive title (+10)")
    stale = [w for w in STALE if re.search(rf"\b{re.escape(w)}\b", text)]
    if stale:
        score -= 25.0
        reasons.append(f"stale/closed signals: {', '.join(stale)} (-25)")
    score *= max(0.0, min(2.0, float(source_weight)))
    score = max(0.0, min(100.0, score))
    return {"score": round(score, 1), "reasons": reasons, "keyword_hits": hits}
