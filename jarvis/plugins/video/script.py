"""Scene planning for the video builder — pure logic, no network, no LLM.

A video project is a list of scenes. Each scene is one still image (or a
plain colour background when no image is given) plus one narration line
spoken by the existing TTS path (Edge-TTS, Arabic default).

Two ways to build a plan:
  - ``split_script`` — paste a plain-text script; blank lines split scenes.
  - ``plan_video`` — topic and/or script and/or an explicit scene list.

Nothing here calls a model or the network, so planning is free and instant
on a weak laptop. Rendering (ffmpeg + TTS) lives in ``assemble.py``.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

# Narration speed used to estimate how long a scene lasts. Arabic news-style
# narration is close to this; the estimate is only a default — the real clip
# length follows the spoken audio when it is longer (see assemble.py).
WORDS_PER_MINUTE = 150
MIN_SCENE_SECONDS = 3.0
MAX_SCENE_SECONDS = 60.0
TITLE_WORDS = 6


@dataclass
class Scene:
    """One scene: a title, narration text, a duration, an optional image."""

    title: str
    narration: str
    duration_seconds: float = 5.0
    image: str | None = None
    index: int = 0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict, index: int = 0) -> "Scene":
        return cls(
            title=str(data.get("title", "") or f"Scene {index + 1}"),
            narration=str(data.get("narration", "") or ""),
            duration_seconds=float(data.get("duration_seconds") or 0)
            or estimate_duration_seconds(str(data.get("narration", "") or "")),
            image=data.get("image") or None,
            index=int(data.get("index", index)),
        )


def estimate_duration_seconds(text: str, wpm: int = WORDS_PER_MINUTE) -> float:
    """Rough spoken length of *text* in seconds, clamped to a sane range."""
    words = len((text or "").split())
    if words == 0:
        return MIN_SCENE_SECONDS
    seconds = words / max(1, wpm) * 60.0
    return max(MIN_SCENE_SECONDS, min(MAX_SCENE_SECONDS, round(seconds, 1)))


def _title_for(paragraph: str, index: int) -> str:
    words = paragraph.split()
    if not words:
        return f"Scene {index + 1}"
    head = " ".join(words[:TITLE_WORDS])
    return head + (" …" if len(words) > TITLE_WORDS else "")


def split_script(
    script: str,
    default_duration: float | None = None,
    wpm: int = WORDS_PER_MINUTE,
) -> list[Scene]:
    """Split a plain-text script into scenes on blank lines.

    Each non-empty paragraph becomes one scene; its narration is the
    paragraph text and its duration is estimated from the word count
    (unless *default_duration* is given, which overrides the estimate).
    """
    if not script or not script.strip():
        raise ValueError("script is empty — write at least one scene")
    paragraphs: list[str] = []
    for block in script.split("\n\n"):
        for line in block.split("\n"):
            line = line.strip()
            if line:
                paragraphs.append(line)
    if not paragraphs:
        raise ValueError("script is empty — write at least one scene")
    scenes: list[Scene] = []
    for i, paragraph in enumerate(paragraphs):
        duration = (
            float(default_duration)
            if default_duration
            else estimate_duration_seconds(paragraph, wpm=wpm)
        )
        scenes.append(Scene(
            title=_title_for(paragraph, i),
            narration=paragraph,
            duration_seconds=duration,
            image=None,
            index=i,
        ))
    return scenes


def plan_video(
    topic: str | None = None,
    script: str | None = None,
    scenes: list[dict] | None = None,
    default_duration: float | None = None,
) -> dict:
    """Build a video plan from a topic, a script, or an explicit scene list.

    Returns ``{"topic": ..., "scenes": [scene dicts]}``. Precedence:
    explicit *scenes* win, then *script*, then a single scene from *topic*.
    """
    if scenes:
        planned = [Scene.from_dict(s, index=i).to_dict() for i, s in enumerate(scenes)]
        return {"topic": topic or "", "scenes": planned}
    if script and script.strip():
        return {
            "topic": topic or "",
            "scenes": [s.to_dict() for s in split_script(script, default_duration)],
        }
    if topic and topic.strip():
        return {
            "topic": topic.strip(),
            "scenes": [Scene(
                title=topic.strip(),
                narration=topic.strip(),
                duration_seconds=default_duration
                or estimate_duration_seconds(topic.strip()),
                image=None,
                index=0,
            ).to_dict()],
        }
    raise ValueError("plan_video needs a topic, a script, or a scene list")
