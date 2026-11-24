"""JARVIS — Real-time LiveLog Streaming Engine.

Inspired by Harness (Gitness) livelog architecture.
Provides ring-buffered, in-memory live line streaming for sub-agents,
tool runs, and background tasks, broadcasting lines in real time over WebSockets.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import asdict, dataclass
from typing import Any, Callable

log = logging.getLogger("jarvis.livelog")


@dataclass
class LogLine:
    pos: int
    stream_id: str
    text: str
    timestamp: float
    level: str = "info"  # "info", "warn", "error", "thought", "action"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class LiveLogStream:
    """A single buffered log stream with subscriber broadcasting."""

    def __init__(self, stream_id: str, max_lines: int = 500):
        self.stream_id = stream_id
        self.max_lines = max_lines
        self.lines: deque[LogLine] = deque(maxlen=max_lines)
        self._pos_counter: int = 0
        self._subscribers: set[asyncio.Queue[LogLine]] = set()

    def write(self, text: str, level: str = "info") -> LogLine:
        """Append a line to the stream and broadcast to all active subscribers."""
        self._pos_counter += 1
        line = LogLine(
            pos=self._pos_counter,
            stream_id=self.stream_id,
            text=text,
            timestamp=time.time(),
            level=level,
        )
        self.lines.append(line)

        # Notify subscribers without blocking
        dead: list[asyncio.Queue[LogLine]] = []
        for q in self._subscribers:
            try:
                q.put_nowait(line)
            except asyncio.QueueFull:
                pass
            except Exception:
                dead.append(q)
        for d in dead:
            self._subscribers.discard(d)

        return line

    def subscribe(self) -> asyncio.Queue[LogLine]:
        """Subscribe to live lines from this stream."""
        q: asyncio.Queue[LogLine] = asyncio.Queue(maxsize=200)
        # Pre-seed with existing lines if any
        for l in self.lines:
            try:
                q.put_nowait(l)
            except asyncio.QueueFull:
                break
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[LogLine]) -> None:
        self._subscribers.discard(q)

    def get_lines(self) -> list[dict[str, Any]]:
        return [l.to_dict() for l in self.lines]


class LiveLogManager:
    """Manages active live streams across subagents and tasks."""

    _instance: LiveLogManager | None = None

    def __init__(self):
        self._streams: dict[str, LiveLogStream] = {}
        self._broadcaster: Callable[[dict[str, Any]], None] | None = None

    @classmethod
    def get_instance(cls) -> LiveLogManager:
        if cls._instance is None:
            cls._instance = LiveLogManager()
        return cls._instance

    def set_broadcaster(self, fn: Callable[[dict[str, Any]], None]) -> None:
        """Register a callback to emit live lines to WebSockets / event loops."""
        self._broadcaster = fn

    def get_or_create(self, stream_id: str) -> LiveLogStream:
        if stream_id not in self._streams:
            self._streams[stream_id] = LiveLogStream(stream_id)
        return self._streams[stream_id]

    def log(self, stream_id: str, text: str, level: str = "info") -> LogLine:
        stream = self.get_or_create(stream_id)
        line = stream.write(text, level=level)

        # Broadcast via event hook if configured
        if self._broadcaster:
            try:
                self._broadcaster({
                    "type": "livelog",
                    "stream_id": stream_id,
                    "pos": line.pos,
                    "text": line.text,
                    "level": line.level,
                    "timestamp": line.timestamp,
                })
            except Exception as e:
                log.debug("LiveLog broadcast failed: %s", e)

        return line

    def get_history(self, stream_id: str) -> list[dict[str, Any]]:
        if stream_id in self._streams:
            return self._streams[stream_id].get_lines()
        return []

    def close_stream(self, stream_id: str) -> None:
        self._streams.pop(stream_id, None)


# Global singleton instance
livelog = LiveLogManager.get_instance()
