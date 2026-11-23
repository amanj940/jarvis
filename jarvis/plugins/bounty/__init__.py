"""Bug-bounty plugin package.

``register()`` lives in :mod:`jarvis.plugins.bounty.tools`; the registry
discovers this subpackage via ``pkgutil.iter_modules`` and imports it,
so this ``__init__`` only re-exports the entry point.
"""
from __future__ import annotations

from .tools import register

__all__ = ["register"]
