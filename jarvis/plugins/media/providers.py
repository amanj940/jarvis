"""ONE media-provider interface for image->3D backends (Phase 2).

The old ``_run_image_to_3d`` dispatcher (env-var switch buried in a
1,464-line file) is now an explicit interface: every 3D backend is an
:class:`Image3DProvider` with ``name`` / ``kind`` / ``generate()``, and
:func:`resolve_3d_provider` picks one from ``JARVIS_3D_BACKEND``
(``trellis2-fp8`` default, ``hunyuan``/``hy3d``/``hunyuan3d``/``hunyuan3d-2gp``
for the Hunyuan3D path). The ``image_to_3d`` tool only ever talks to this
interface — adding a backend means adding a provider class, not editing
the tool. ``generate()`` returns ``(kind, out_path, device)``.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol

from . import hunyuan3d, trellis


class Image3DProvider(Protocol):
    """A backend that turns one image into a GLB file."""

    name: str
    kind: str

    def generate(
        self, cfg, image_path: Path, out_path: Path
    ) -> tuple[str, Path, str]:
        """Return (kind, out_path, device) for the generated GLB."""
        ...


class Trellis2Provider:
    """TRELLIS.2 FP8 textured — default backend (isolated worker)."""

    name = "trellis2-fp8"
    kind = trellis._TRELLIS2_KIND

    def generate(self, cfg, image_path: Path, out_path: Path) -> tuple[str, Path, str]:
        return trellis.run_trellis2_image_to_3d(cfg, image_path, out_path)


class Hunyuan3DProvider:
    """Hunyuan3D-2GP Mini Turbo — in-process shape model."""

    name = "hunyuan3d"
    kind = hunyuan3d._HY3D_KIND

    def generate(self, cfg, image_path: Path, out_path: Path) -> tuple[str, Path, str]:
        kind, out = hunyuan3d.run_hunyuan_image_to_3d(cfg, image_path, out_path)
        return kind, out, hunyuan3d._sf3d_device or "cuda"


_HY3D_ALIASES = {"hunyuan", "hy3d", "hunyuan3d", "hunyuan3d-2gp"}


def resolve_3d_provider(cfg=None) -> Image3DProvider:
    """Pick the image->3D backend from JARVIS_3D_BACKEND (default trellis2)."""
    backend = os.getenv("JARVIS_3D_BACKEND", "trellis2-fp8").strip().lower()
    if backend in _HY3D_ALIASES:
        return Hunyuan3DProvider()
    return Trellis2Provider()


def run_image_to_3d(cfg, image_path: Path, out_path: Path) -> tuple[str, Path, str]:
    """Backwards-compatible dispatcher: resolve the provider and generate."""
    return resolve_3d_provider(cfg).generate(cfg, image_path, out_path)
