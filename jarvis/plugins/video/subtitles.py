"""SRT subtitle generation for the video builder — pure text, no ffmpeg.

The render pipeline writes one subtitle entry per scene: the scene's
narration text, timed to the scene's place in the *final* video (after
crossfade transitions shorten the timeline — see ``assemble.py``).

Arabic is the default language of Jarvis narration, so subtitles are
auto-enabled when any scene narration contains Arabic script. The .srt
file is UTF-8; ffmpeg accepts it directly for the ``mov_text`` track.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable

# Arabic script ranges (incl. presentation forms, which Edge-TTS output
# and user scripts sometimes contain).
_ARABIC_RE = re.compile(
    r"[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]"
)

# (start_seconds, end_seconds, text)
Timing = tuple[float, float, str]


def contains_arabic(text: str) -> bool:
    """True when *text* contains any Arabic-script character."""
    return bool(text) and _ARABIC_RE.search(text) is not None


def format_srt_time(seconds: float) -> str:
    """Seconds -> SRT timestamp ``HH:MM:SS,mmm`` (rounded to the ms)."""
    total_ms = int(round(max(0.0, float(seconds)) * 1000))
    hours, total_ms = divmod(total_ms, 3_600_000)
    minutes, total_ms = divmod(total_ms, 60_000)
    secs, ms = divmod(total_ms, 1_000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def build_srt(timings: Iterable[Timing]) -> str:
    """Build an SRT document from (start, end, text) timings.

    Empty-text entries are skipped (silent scenes get no cue) and an
    end that is not after its start is stretched to start + 0.5s so no
    cue is zero-length. Entries are numbered from 1 in timeline order.
    """
    blocks: list[str] = []
    for start, end, text in timings:
        text = (text or "").strip()
        if not text:
            continue
        start = max(0.0, float(start))
        end = max(float(end), start + 0.5)
        blocks.append(
            f"{len(blocks) + 1}\n"
            f"{format_srt_time(start)} --> {format_srt_time(end)}\n"
            f"{text}\n"
        )
    return "\n".join(blocks)


def write_srt(path: str | Path, timings: Iterable[Timing]) -> Path:
    """Write *timings* as an SRT file (UTF-8) and return its path."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build_srt(timings), encoding="utf-8")
    return out
