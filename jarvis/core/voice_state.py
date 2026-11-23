"""Unified voice state machine (Phase 4).

Before Phase 4 the frontend orb (`web/src/lib/store/types.ts`,
``OrbState = "idle" | "listening" | "thinking" | "speaking"``) and the
backend each tracked voice state ad-hoc: the frontend set its orb from
TTS/mic code, the backend had no voice state at all, and a user talking
over JARVIS (barge-in) had no defined backend behaviour.

This module is the single source of truth both sides agree on. States:

    idle -> listening -> thinking -> speaking -> idle
                    ___________ interrupted ________/

* ``listening``  — mic open / STT in progress.
* ``thinking``   — LLM turn running (orchestrator).
* ``speaking``   — TTS audio playing (set by ``/api/tts`` and by the
  frontend reporting back via ``POST /api/voice/state``).
* ``interrupted`` — the user barged in (spoke / pressed cancel) while
  JARVIS was speaking or thinking. Transient: the next
  ``begin_listening`` / ``to_idle`` moves out of it.
* ``idle``       — nothing happening.

Illegal transitions are rejected (``transition()`` returns ``False`` and
logs) instead of silently corrupting state. ``barge_in()`` is the one
blessed shortcut: speaking/listening/thinking -> interrupted -> listening.
"""
from __future__ import annotations

import logging
import threading
import time
from enum import Enum
from typing import Callable

log = logging.getLogger("jarvis.voice_state")


class VoiceState(str, Enum):
    IDLE = "idle"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"
    INTERRUPTED = "interrupted"


_ALLOWED: dict[VoiceState, frozenset[VoiceState]] = {
    VoiceState.IDLE: frozenset({VoiceState.LISTENING, VoiceState.THINKING, VoiceState.SPEAKING}),
    VoiceState.LISTENING: frozenset({VoiceState.THINKING, VoiceState.INTERRUPTED, VoiceState.IDLE, VoiceState.SPEAKING}),
    VoiceState.THINKING: frozenset({VoiceState.SPEAKING, VoiceState.INTERRUPTED, VoiceState.IDLE, VoiceState.LISTENING}),
    VoiceState.SPEAKING: frozenset({VoiceState.INTERRUPTED, VoiceState.IDLE, VoiceState.LISTENING}),
    VoiceState.INTERRUPTED: frozenset({VoiceState.IDLE, VoiceState.LISTENING, VoiceState.THINKING}),
}


class VoiceStateMachine:
    """Thread-safe voice state machine with a transition history."""

    def __init__(self, initial: VoiceState = VoiceState.IDLE):
        self._state = initial
        self._lock = threading.Lock()
        self._history: list[dict] = [{"state": initial.value, "ts": time.time(), "reason": "init"}]
        self._listeners: list[Callable[[VoiceState, str], None]] = []

    @property
    def state(self) -> VoiceState:
        return self._state

    @property
    def value(self) -> str:
        return self._state.value

    def add_listener(self, fn: Callable[[VoiceState, str], None]) -> None:
        self._listeners.append(fn)

    def transition(self, target: VoiceState | str, reason: str = "") -> bool:
        target = VoiceState(target) if isinstance(target, str) else target
        with self._lock:
            if target is self._state:
                return True  # idempotent re-entry is not an error
            if target not in _ALLOWED.get(self._state, frozenset()):
                log.warning("voice: illegal transition %s -> %s (%s) — rejected",
                            self._state.value, target.value, reason)
                return False
            old = self._state
            self._state = target
            self._history.append({"state": target.value, "ts": time.time(), "reason": reason})
            self._history = self._history[-50:]
        log.debug("voice: %s -> %s (%s)", old.value, target.value, reason)
        for fn in list(self._listeners):
            try:
                fn(target, reason)
            except Exception:  # noqa: BLE001
                pass
        return True

    # -- named transitions -------------------------------------------------
    def begin_listening(self, reason: str = "") -> bool:
        return self.transition(VoiceState.LISTENING, reason or "mic open")

    def begin_thinking(self, reason: str = "") -> bool:
        return self.transition(VoiceState.THINKING, reason or "llm turn")

    def begin_speaking(self, reason: str = "") -> bool:
        return self.transition(VoiceState.SPEAKING, reason or "tts playing")

    def to_idle(self, reason: str = "") -> bool:
        return self.transition(VoiceState.IDLE, reason or "done")

    def interrupt(self, reason: str = "user barge-in") -> bool:
        """User spoke / cancelled while JARVIS was busy."""
        if self._state is VoiceState.IDLE:
            return True
        return self.transition(VoiceState.INTERRUPTED, reason)

    def barge_in(self, reason: str = "user spoke over tts") -> bool:
        """Barge-in: speaking/listening/thinking -> interrupted -> listening.

        Returns False when there was nothing to interrupt (already idle).
        """
        if self._state is VoiceState.IDLE:
            return False
        if self._state is VoiceState.INTERRUPTED:
            return self.transition(VoiceState.LISTENING, reason)
        if not self.transition(VoiceState.INTERRUPTED, reason):
            return False
        return self.transition(VoiceState.LISTENING, reason)

    def cancel(self, reason: str = "cancelled") -> bool:
        if self._state is VoiceState.IDLE:
            return True
        # INTERRUPTED is not in IDLE's allowed set from SPEAKING etc. directly
        # in one hop for every state, so go via interrupt when needed.
        if self._state in (VoiceState.SPEAKING, VoiceState.LISTENING, VoiceState.THINKING):
            self.transition(VoiceState.INTERRUPTED, reason)
        return self.transition(VoiceState.IDLE, reason)

    def history(self) -> list[dict]:
        return list(self._history)

    def to_dict(self) -> dict:
        return {"state": self._state.value, "history": self.history()[-10:]}
