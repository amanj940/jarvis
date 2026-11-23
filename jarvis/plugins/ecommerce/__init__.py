"""E-commerce plugin package.

``register()`` lives in :mod:`jarvis.plugins.ecommerce.tools`; the registry
discovers this subpackage via ``pkgutil.iter_modules`` and imports it,
so this ``__init__`` only re-exports the entry point.
"""
from __future__ import annotations

from .tools import register

__all__ = ["register"]
