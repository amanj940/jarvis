"""Shared helpers for the business plugins (bounty, opportunity, ...).

This is a *library* subpackage, not a plugin: it has no ``register()``,
so the plugin registry logs a warning and skips it on ``load_all()``.
Helpers live in modules such as :mod:`jarvis.plugins.common.urls`.
"""
from __future__ import annotations

from .urls import TRACKING_PARAMS, normalize_shop_domain, normalize_url

__all__ = ["TRACKING_PARAMS", "normalize_shop_domain", "normalize_url"]
