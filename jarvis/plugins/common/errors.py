"""Structured errors shared by the business plugins.

Provider and store failures used to surface to the user as raw tracebacks
(``429 Too Many Requests``, ``500`` from a provider, socket timeouts, or a
locked SQLite file). Everything in this module funnels those into one
shape — a short, safe message plus a machine-readable ``code`` — so callers
can show the message and branch on the code without ever printing a
traceback or leaking provider internals (URLs, keys, raw bodies).

Single entry point: :func:`normalize_provider_error`. It takes any
exception and returns a :class:`StructuredError`; already-structured
errors pass through untouched.
"""
from __future__ import annotations

import asyncio

__all__ = [
    "StructuredError",
    "OutOfScopeError",
    "ProviderError",
    "RateLimitedError",
    "ProviderTimeoutError",
    "ProviderUnavailableError",
    "StoreError",
    "normalize_provider_error",
    "is_retryable",
    "to_error_dict",
]


class StructuredError(Exception):
    """Base structured error: ``code`` + safe ``message`` + ``details``.

    ``details`` carries only safe, machine-readable facts (provider name,
    HTTP status, the refused target, the scope that refused it). It never
    carries raw exception text, tracebacks, URLs with credentials, or
    provider response bodies.
    """

    code = "error"
    retryable = False

    def __init__(self, message: str, *, code: str | None = None,
                 details: dict | None = None, retryable: bool | None = None):
        super().__init__(message)
        if code is not None:
            self.code = code
        self.message = message
        self.details = dict(details or {})
        if retryable is not None:
            self.retryable = retryable

    def to_dict(self) -> dict:
        """JSON-safe shape for tool results: ``{"ok": False, "error": ...}``."""
        return {
            "ok": False,
            "error": {
                "code": self.code,
                "message": self.message,
                "retryable": bool(self.retryable),
                "details": dict(self.details),
            },
        }


class OutOfScopeError(StructuredError):
    """A store read/write was refused: its target is outside the declared scope.

    Raised by the store layer (not just the tool layer) so a direct store
    call cannot bypass the scope a program / allowlist declares.
    """

    code = "out_of_scope"

    def __init__(self, message: str, *, target: str | None = None,
                 scope: list | None = None, details: dict | None = None):
        merged = dict(details or {})
        if target is not None:
            merged["target"] = str(target)
        if scope is not None:
            merged["scope"] = list(scope)
        super().__init__(message, details=merged)


class ProviderError(StructuredError):
    """A provider (or the local store) failed in a way the user can retry later."""

    code = "provider_error"


class RateLimitedError(ProviderError):
    """HTTP 429 — the provider throttled us. Always retryable (after a wait)."""

    code = "rate_limited"
    retryable = True


class ProviderTimeoutError(ProviderError):
    """The provider did not answer in time. Always retryable."""

    code = "timeout"
    retryable = True


class ProviderUnavailableError(ProviderError):
    """Could not reach the provider at all (connection failure). Retryable."""

    code = "provider_unavailable"
    retryable = True


class StoreError(StructuredError):
    """The local SQLite store failed (locked, corrupt, unreadable)."""

    code = "store_error"


def _http_status(exc: BaseException) -> int | None:
    """Best-effort HTTP status from httpx/requests-style exceptions.

    Reads ``status_code`` / ``status`` on the exception itself or on its
    ``response`` — no provider library is imported, so this works for
    httpx, requests, aiohttp-style errors and hand-rolled fakes alike.
    """
    for attr in ("status_code", "status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    response = getattr(exc, "response", None)
    if response is not None:
        value = getattr(response, "status_code", None)
        if isinstance(value, int):
            return value
    return None


def _is_timeout(exc: BaseException) -> bool:
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
        return True
    name = type(exc).__name__
    return "Timeout" in name or "Timeout" in type(exc).__module__


def _is_connection_failure(exc: BaseException) -> bool:
    if isinstance(exc, ConnectionError):
        return True
    name = type(exc).__name__
    return "Connect" in name or "Connection" in name


def normalize_provider_error(exc: BaseException, *,
                             provider: str = "provider") -> StructuredError:
    """Map any exception to a structured error — no tracebacks, no leaks.

    Mapping (first match wins):

    * already a :class:`StructuredError` → returned unchanged;
    * HTTP 429 → :class:`RateLimitedError` (``rate_limited``, retryable);
    * HTTP 5xx → :class:`ProviderError` (``provider_error``, retryable);
    * other HTTP 4xx → :class:`ProviderError` (``provider_error``);
    * timeout (``TimeoutError`` / ``*Timeout*`` type) → ``timeout``, retryable;
    * connection failure → ``provider_unavailable``, retryable;
    * ``sqlite3`` errors → :class:`StoreError` (``store_unavailable`` when
      the DB is locked/busy and therefore retryable, else ``store_error``);
    * anything else → generic :class:`ProviderError`.

    Messages are built from the status / failure kind only. The original
    exception text is never copied into the message: it may contain
    request URLs, keys, or provider internals.
    """
    if isinstance(exc, StructuredError):
        return exc
    label = (provider or "provider").strip() or "provider"

    status = _http_status(exc)
    if status is not None:
        if status == 429:
            return RateLimitedError(
                f"{label} is rate-limited (HTTP 429). Try again shortly.",
                details={"provider": label, "status": 429})
        if 500 <= status <= 599:
            return ProviderError(
                f"{label} returned HTTP {status}. Try again shortly.",
                details={"provider": label, "status": status}, retryable=True)
        if 400 <= status <= 499:
            return ProviderError(
                f"{label} rejected the request (HTTP {status}).",
                details={"provider": label, "status": status})

    if _is_timeout(exc):
        return ProviderTimeoutError(
            f"{label} timed out. Try again shortly.",
            details={"provider": label})
    if _is_connection_failure(exc):
        return ProviderUnavailableError(
            f"{label} is unreachable. Try again shortly.",
            details={"provider": label})

    if getattr(type(exc), "__module__", "") == "sqlite3":
        text = str(exc).lower()
        if "locked" in text or "busy" in text:
            return StoreError(
                "The local store is busy. Try again shortly.",
                code="store_unavailable", retryable=True,
                details={"provider": "store"})
        return StoreError(
            "The local store failed. No data was changed.",
            details={"provider": "store"})

    return ProviderError(
        f"{label} request failed. Try again shortly.",
        details={"provider": label})


def is_retryable(exc: BaseException) -> bool:
    """True when the failure is worth retrying (429 / 5xx / timeout / ...)."""
    if isinstance(exc, StructuredError):
        return bool(exc.retryable)
    return normalize_provider_error(exc).retryable


def to_error_dict(exc: BaseException, *, provider: str = "provider") -> dict:
    """Normalize *exc* and return its ``{"ok": False, "error": ...}`` dict."""
    return normalize_provider_error(exc, provider=provider).to_dict()
