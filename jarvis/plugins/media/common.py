"""Shared helpers for the media plugin package (Phase 2).

Paths, hashing, aspect fitting, the __JARVIS_MEDIA__ payload envelope.
No model loading here.
"""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger("jarvis.mediagen")

MEDIA_PREFIX = "__JARVIS_MEDIA__"

def _images_dir(cfg) -> Path:
    p = cfg.abs_path("data/generated/images")
    p.mkdir(parents=True, exist_ok=True)
    return p


def _models_dir(cfg) -> Path:
    p = cfg.abs_path("data/generated/models3d")
    p.mkdir(parents=True, exist_ok=True)
    return p


def _local_models_dir(cfg) -> Path:
    p = cfg.abs_path("data/models")
    p.mkdir(parents=True, exist_ok=True)
    return p

def _select_device() -> str:
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def _short_hash(s: str, n: int = 8) -> str:
    return hashlib.sha1(s.encode()).hexdigest()[:n]


def _fit_size_to_aspect(src_w: int, src_h: int, max_w: int, max_h: int, multiple: int = 16) -> tuple[int, int]:
    if src_w <= 0 or src_h <= 0:
        return max_w, max_h
    max_w = max(multiple, int(max_w))
    max_h = max(multiple, int(max_h))
    scale = min(max_w / src_w, max_h / src_h)
    out_w = max(multiple, int(round((src_w * scale) / multiple)) * multiple)
    out_h = max(multiple, int(round((src_h * scale) / multiple)) * multiple)
    if out_w > max_w:
        out_w = max(multiple, (max_w // multiple) * multiple)
    if out_h > max_h:
        out_h = max(multiple, (max_h // multiple) * multiple)
    return out_w, out_h


def _emit_media(kind: str, items: list[dict], summary: str) -> str:
    return MEDIA_PREFIX + json.dumps(
        {"kind": kind, "items": items, "summary": summary},
        ensure_ascii=False,
    )
