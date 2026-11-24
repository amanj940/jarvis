"""Comprehension layer — session understanding, context tracking, logic rules.

Sits between raw user text and the LLM prompt. Gives JARVIS the things chat
platforms have that a stateless prompt lacks:

  1. ENTITY MEMORY   — remembers what was just discussed (models, URLs,
     files, names, tasks) so follow-ups like "what about it?" / "و الثاني؟"
     resolve against real context instead of guessing.
  2. REFERENCE LOGIC — detects anaphora / ellipsis / short confirmations and
     rewrites the *interpretation* (not the text) with concrete referents.
  3. RULE ENGINE     — deterministic per-turn rules that inject guidance into
     the system prompt: language lock, brevity hints, model-DB resolution,
     pending-clarification tracking, stop/cancel detection.
  4. TURN STATE      — tracks language, last intent, turn count, and what the
     assistant last did, so multi-turn dialogue stays coherent.

Design rules
------------
- Cheap: pure Python + one SQLite read for model-name resolution (cached).
- Honest: only injects facts it actually extracted — never invents context.
- Non-destructive: never rewrites user_text; only augments the system prompt.
"""
from __future__ import annotations

import logging
import re
import sqlite3
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger("jarvis.comprehension")

_MODEL_DB = "data/models.db"

# ── Language detection ──────────────────────────────────────────────────────

_ARABIC_RE = re.compile(r"[؀-ۿ]")


def detect_language(text: str) -> str:
    """Return 'ar' or 'en' based on Arabic character ratio. Defaults to 'ar'."""
    if not text:
        return "ar"
    arabic = len(_ARABIC_RE.findall(text))
    letters = sum(1 for c in text if c.isalpha())
    if letters == 0:
        return "ar" if arabic else "ar"
    return "ar" if arabic / letters > 0.3 else "en"


# ── Follow-up / reference detection ─────────────────────────────────────────

# English anaphora + ellipsis markers
_EN_FOLLOWUP = re.compile(
    r"^(what about|how about|and |also |too\b|same for|why\??|explain (it|that|this)|"
    r"tell me more|go on|continue|elaborate|and the |what'?s (it|that)|"
    r"can you (explain|elaborate|detail)|more (details|info|on that))\b",
    re.IGNORECASE,
)
_EN_PRONOUN_START = re.compile(
    r"^(it|that|this|they|them|those|these|he|she|the (same|other|rest|first|second|third|last))\b",
    re.IGNORECASE,
)
# Arabic follow-up markers
_AR_FOLLOWUP = re.compile(
    r"^(و|ايش|وش|كيف|ليش|متى|كم|هل|شنو|ايش عن|وماذا عن|نفس الشي|كمان|برضو|"
    r"اشرح|فصل|اكمل|كمل|بعدها|ثاني|الأول|الثاني|الأخير|هذا|هذه|ذلك|تلك|هو|هي)"
)
_SHORT_REPLY = re.compile(
    r"^(yes|no|ok|okay|sure|nah|yep|nope|نعم|لا|ايوا|ايوه|تمام|أكيد|اكيد|طيب|ماشي|"
    r"correct|right|wrong|good|bad|continue|stop|cancel|إلغاء|الغي|بطّل|اوقف)\b",
    re.IGNORECASE,
)

_URL_RE = re.compile(r"https?://[^\s)\]\"'>]+")
_PATH_RE = re.compile(r"(?:/home|/tmp|/var|/etc|~|\./|\.\./)[\w\-./]{2,}")
_MODELISH_RE = re.compile(r"[A-Za-z][\w.-]*(?:[/\-:][\w.:-]+)+")


@dataclass
class TurnState:
    """Rolling per-session comprehension state."""

    language: str = "ar"
    turn_count: int = 0
    last_intent: str = ""
    last_action: str = ""
    last_topic: str = ""
    pending_clarification: str = ""
    entities: dict[str, list[str]] = field(default_factory=lambda: {
        "models": [], "urls": [], "paths": [], "names": [], "topics": [],
    })
    recent_turns: list[dict[str, str]] = field(default_factory=list)

    _MAX_ENTITIES = 8
    _MAX_TURNS = 12

    def push_turn(self, user: str, assistant: str = "") -> None:
        self.recent_turns.append({"user": user[:300], "assistant": assistant[:300]})
        if len(self.recent_turns) > self._MAX_TURNS:
            self.recent_turns = self.recent_turns[-self._MAX_TURNS:]

    def add_entity(self, kind: str, value: str) -> None:
        bucket = self.entities.setdefault(kind, [])
        if value and value not in bucket:
            bucket.insert(0, value)
            del bucket[self._MAX_ENTITIES:]

    def top_entity(self, kind: str) -> str:
        bucket = self.entities.get(kind) or []
        return bucket[0] if bucket else ""


# ── Model-name resolution via models.db ─────────────────────────────────────

class ModelResolver:
    """Resolves user-typed model mentions against the tested model catalog."""

    def __init__(self, db_path: str = _MODEL_DB) -> None:
        self._db_path = db_path
        self._names: set[str] = set()
        self._loaded = False

    def _ensure(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        try:
            conn = sqlite3.connect(self._db_path)
            rows = conn.execute(
                "SELECT m.model_name, m.provider, m.status FROM models m"
            ).fetchall()
            conn.close()
            # keep only active + rate_limited (usable) models for resolution hints
            self._entries = [
                (name, prov, status) for name, prov, status in rows
                if status in ("active", "rate_limited")
            ]
            self._names = {n.lower() for n, _, _ in self._entries}
        except Exception as e:
            log.warning("ModelResolver init failed: %s", e)
            self._entries = []
            self._names = set()

    def resolve(self, text: str) -> list[dict[str, str]]:
        """Find catalog models mentioned in text. Returns up to 5 matches."""
        self._ensure()
        if not self._entries:
            return []
        lowered = text.lower()
        matches: list[dict[str, str]] = []
        seen: set[str] = set()
        # token-level + substring matching on distinctive tokens
        tokens = {t.strip(".,!?()[]{}\"'؟،؛") for t in re.split(r"[\s,/]+", lowered)}
        tokens.discard("")
        for name, prov, status in self._entries:
            nl = name.lower()
            key = f"{prov}/{name}"
            if key in seen:
                continue
            # exact token match OR distinctive substring (>=8 chars to avoid noise)
            hit = nl in tokens or (len(nl) >= 6 and nl in lowered)
            if hit:
                seen.add(key)
                matches.append({
                    "provider": prov,
                    "model": name,
                    "status": status,
                    "key": key,
                })
            if len(matches) >= 5:
                break
        return matches


# ── Rule engine ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class RuleResult:
    rule: str
    hint: str


class ComprehensionEngine:
    """Per-session understanding: state + rules + context builder."""

    def __init__(self) -> None:
        self.state = TurnState()
        self.models = ModelResolver()

    # ── analysis ──────────────────────────────────────────────────────────
    def analyze(self, text: str) -> dict[str, Any]:
        lang = detect_language(text)
        stripped = text.strip()
        low = stripped.lower()

        is_followup = bool(
            _EN_FOLLOWUP.match(low)
            or _EN_PRONOUN_START.match(low)
            or (_ARABIC_RE.search(stripped) and _AR_FOLLOWUP.match(stripped))
        )
        is_short_reply = bool(_SHORT_REPLY.match(low))
        urls = _URL_RE.findall(text)
        paths = _PATH_RE.findall(text)
        modelish = _MODELISH_RE.findall(text)
        model_hits = self.models.resolve(text)

        qtype = "statement"
        if re.match(r"^(what|who|whom|whose|when|where|why|how|which|is|are|was|were|do|does|did|can|could|should|would|will)\b", low):
            qtype = "question"
        if _ARABIC_RE.search(stripped) and re.match(r"^(ما|ماذا|من|متى|أين|اين|كيف|ليش|هل|كم|هل يمكن|شنو|ايش|وش)\b", stripped):
            qtype = "question"
        if re.match(r"^(please\s+)?(generate|create|make|build|write|run|open|show|find|search|list|delete|remove|move|copy|tell|give|send|set|start|stop|cancel)\b", low):
            qtype = "command"

        wants_cancel = bool(re.match(r"^(stop|cancel|never ?mind|forget it|abort|الغي|إلغاء|بطّل|اوقف|وقف|لا تكمل)\b", low))

        return {
            "language": lang,
            "is_followup": is_followup,
            "is_short_reply": is_short_reply,
            "qtype": qtype,
            "urls": urls,
            "paths": paths,
            "modelish": modelish,
            "model_hits": model_hits,
            "wants_cancel": wants_cancel,
            "text": stripped,
        }

    # ── rule evaluation → prompt hints ────────────────────────────────────
    def build_context_block(self, analysis: dict[str, Any]) -> str:
        """Produce a system-prompt context section for this turn."""
        hints: list[str] = []
        st = self.state

        # R1 — language lock reinforcement
        if st.language and st.language != analysis["language"] and st.turn_count > 2:
            hints.append(
                f"User switched language to {'Arabic' if analysis['language']=='ar' else 'English'} "
                f"(was {st.language}). Mirror the NEW language immediately."
            )
        elif analysis["language"] == "ar":
            hints.append("User is writing in Arabic — respond in fluent Arabic (address as سيدي).")

        # R2 — follow-up reference resolution
        if analysis["is_followup"] and st.turn_count > 0:
            refs = []
            for kind, label in (("models", "model"), ("urls", "URL"), ("paths", "file/path"), ("names", "name"), ("topics", "topic")):
                top = st.top_entity(kind)
                if top:
                    refs.append(f"{label}: {top}")
            if refs:
                hints.append(
                    "FOLLOW-UP TURN: the message is a continuation, not a new topic. "
                    "Resolve pronouns/references against recent context — " + "; ".join(refs) + "."
                )
            elif st.last_topic:
                hints.append(f"FOLLOW-UP TURN continuing previous topic: {st.last_topic}")

        # R3 — short reply = confirmation/correction of last exchange
        if analysis["is_short_reply"] and st.recent_turns:
            last = st.recent_turns[-1]
            hints.append(
                "SHORT REPLY: user is confirming/correcting your last message — "
                f"last user said: «{last['user'][:120]}» / you answered: «{last['assistant'][:120]}». "
                "Interpret accordingly (yes→proceed, no→adjust, stop→halt)."
            )

        # R4 — model mention resolution (the DB knows what's actually usable)
        for hit in analysis.get("model_hits", []):
            status_note = "verified working" if hit["status"] == "active" else f"status={hit['status']}"
            hints.append(
                f"User mentioned model {hit['key']} — catalog status: {status_note}. "
                "If relevant, prefer model_db/model_council tools for live truth."
            )

        # R5 — cancel intent
        if analysis["wants_cancel"]:
            hints.append("USER REQUESTED STOP/CANCEL — acknowledge and halt the current line of action.")

        # R6 — pending clarification tracking
        if st.pending_clarification:
            hints.append(f"You previously asked the user to clarify: {st.pending_clarification}")

        if not hints:
            return ""
        return "Conversation understanding (auto-derived, do not quote verbatim):\n" + "\n".join(
            f"- {h}" for h in hints
        )

    # ── state update after a turn ─────────────────────────────────────────
    def update(self, user_text: str, analysis: dict[str, Any], assistant_text: str = "", intent: str = "") -> None:
        st = self.state
        st.language = analysis["language"]
        st.turn_count += 1
        if intent:
            st.last_intent = intent
        st.last_action = (assistant_text or "")[:200]
        st.push_turn(user_text, assistant_text)

        # entity extraction → memory
        for u in analysis.get("urls", []):
            st.add_entity("urls", u)
        for p in analysis.get("paths", []):
            st.add_entity("paths", p)
        for h in analysis.get("model_hits", []):
            st.add_entity("models", h["key"])
        for t in analysis.get("modelish", [])[:3]:
            st.add_entity("names", t)

        # topic: first ~8 words of non-followup user text
        if not analysis["is_followup"] and analysis["qtype"] in ("question", "command"):
            words = re.findall(r"\w+", user_text)[:8]
            if words:
                st.last_topic = " ".join(words)

        # detect if assistant asked a clarifying question → mark pending
        if assistant_text and re.search(r"(which|do you mean|could you clarify|تقصد|أي واحد|وضح more|please specify)", assistant_text, re.I):
            st.pending_clarification = assistant_text[:160]
        elif analysis["is_followup"]:
            st.pending_clarification = ""

    def reset(self) -> None:
        self.state = TurnState()
