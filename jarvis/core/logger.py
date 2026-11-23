"""Logging setup. Rich console handler + rotating file handler + structured
action log for every tool invocation (for auditing).
"""
from __future__ import annotations

import json
import logging
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from rich.logging import RichHandler

from ..config import Config

_configured = False


def setup_logging(cfg: Config) -> logging.Logger:
    global _configured

    log_file = cfg.abs_path(cfg.logging.file)
    log_file.parent.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger("jarvis")
    root.setLevel(cfg.logging.level)

    if not _configured:
        rich_handler = RichHandler(
            rich_tracebacks=True,
            show_time=True,
            show_path=False,
            markup=True,
        )
        rich_handler.setLevel(cfg.logging.level)
        rich_handler.setFormatter(logging.Formatter("%(message)s"))

        file_handler = RotatingFileHandler(
            log_file, maxBytes=2_000_000, backupCount=5, encoding="utf-8"
        )
        file_handler.setLevel(cfg.logging.level)
        file_handler.setFormatter(
            logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
        )

        root.addHandler(rich_handler)
        root.addHandler(file_handler)
        root.propagate = False

        # Silence noisy 3rd-party loggers that don't carry actionable signal:
        #   - libav.* / pyav — partial Opus packet headers from short browser
        #     MediaRecorder clips (Whisper still transcribes fine).
        #   - huggingface_hub — model-download progress chatter.
        #   - asyncio — Windows Proactor pending-task debug spew.
        for name in (
            "libav", "libav.opus", "libav.aac", "libav.matroska",
            "libav.mov,mp4,m4a,3gp,3g2,mj2",
            "av", "av.opus", "av.aac",
            "huggingface_hub",
        ):
            logging.getLogger(name).setLevel(logging.ERROR + 10)  # effectively off
        logging.getLogger("asyncio").setLevel(logging.WARNING)

        _configured = True

    return root


class ActionLog:
    """Append-only JSON-lines log of every action JARVIS performs."""

    def __init__(self, cfg: Config):
        self.path: Path = cfg.abs_path(cfg.logging.action_log)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def record(self, action: str, **fields: Any) -> None:
        entry = {"ts": time.time(), "action": action, **fields}
        try:
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, default=str) + "\n")
        except OSError:
            # never let logging crash the assistant
            pass


    def recent(self, n: int = 100, only_failed: bool = False) -> list[dict]:
        """Last `n` action-log entries (newest first).

        Phase 4: failures are visible here — ``only_failed=True`` returns
        entries whose action is ``failed``/``denied`` or whose ``ok`` is
        False. A missing/unreadable log file returns [].
        """
        try:
            lines = self.path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []
        out: list[dict] = []
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if only_failed:
                if entry.get("action") not in ("failed", "denied") and entry.get("ok") is not False:
                    continue
            out.append(entry)
            if len(out) >= n:
                break
        return out
