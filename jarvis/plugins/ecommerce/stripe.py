"""Stripe client — read-only, config-gated, no keys in code.

The secret key comes from the ``STRIPE_API_KEY`` environment variable
only. Nothing in this module contains a key, and nothing here logs one.

Read-only by construction: this module only ever issues ``GET``
requests. There is no ``create_charge``, ``create_refund`` or payout
method anywhere — Jarvis can look at money, it can never move it.
Use Stripe test-mode keys (``sk_test_...``) while trying things out.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import httpx

log = logging.getLogger("jarvis.ecommerce.stripe")

BASE_URL = "https://api.stripe.com/v1"


class StripeNotConfigured(RuntimeError):
    """Raised when STRIPE_API_KEY is missing."""


def api_key_from_env() -> str:
    return os.environ.get("STRIPE_API_KEY", "").strip()


def _int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


# ----------------------------------------------------------------------
# Pure parsing helpers — unit-testable without any network.
# ----------------------------------------------------------------------
def parse_balance(payload: dict) -> dict:
    """Parse a ``GET /balance`` response into available/pending buckets.

    Amounts stay in the smallest currency unit (cents) exactly as Stripe
    returns them; conversion to major units happens in
    :func:`summarize_charges` / the tools, never silently here.
    """
    def _bucket(items: Any) -> list[dict]:
        return [
            {"amount": _int(b.get("amount")), "currency": (b.get("currency") or "").upper()}
            for b in (items or [])
            if isinstance(b, dict)
        ]

    return {
        "available": _bucket(payload.get("available")),
        "pending": _bucket(payload.get("pending")),
    }


def parse_payment(payload: dict) -> dict:
    """Parse a PaymentIntent (or Charge) object into a flat dict.

    PaymentIntents carry ``amount``/``currency``/``status``; charges carry
    the same plus ``amount_refunded`` and ``receipt_email``. Both shapes
    are handled.
    """
    receipt_email = payload.get("receipt_email") or ""
    if not receipt_email and isinstance(payload.get("customer"), dict):
        receipt_email = (payload.get("customer") or {}).get("email", "")
    return {
        "id": payload.get("id", ""),
        "amount": _int(payload.get("amount")),
        "currency": (payload.get("currency") or "").upper(),
        "status": payload.get("status", ""),
        "amount_refunded": _int(payload.get("amount_refunded")),
        "description": payload.get("description") or "",
        "receipt_email": receipt_email,
        "created": _int(payload.get("created")),
    }


def parse_charges(payload: dict) -> list[dict]:
    """Parse a ``GET /charges`` list response into flat charge dicts."""
    return [parse_payment(item) for item in payload.get("data") or []
            if isinstance(item, dict)]


def summarize_charges(charges: list[dict]) -> dict:
    """Summarise charges into net revenue per currency.

    Only ``succeeded`` charges count; refunded amounts are subtracted.
    Returns amounts in major units (dollars/euros/...) with the raw cent
    totals kept alongside for auditability.
    """
    totals: dict[str, dict[str, Any]] = {}
    for charge in charges:
        if charge.get("status") != "succeeded":
            continue
        cur = (charge.get("currency") or "").upper() or "UNKNOWN"
        bucket = totals.setdefault(cur, {
            "currency": cur, "count": 0, "gross_cents": 0,
            "refunded_cents": 0, "net_cents": 0, "net": 0.0,
        })
        bucket["count"] += 1
        bucket["gross_cents"] += _int(charge.get("amount"))
        bucket["refunded_cents"] += _int(charge.get("amount_refunded"))
        bucket["net_cents"] = bucket["gross_cents"] - bucket["refunded_cents"]
        bucket["net"] = round(bucket["net_cents"] / 100, 2)
    return {"ok": True, "by_currency": sorted(totals.values(),
                                              key=lambda b: b["currency"])}


# ----------------------------------------------------------------------
# Client
# ----------------------------------------------------------------------
class StripeClient:
    """Thin async wrapper around the Stripe API (read-only GETs only).

    ``transport`` exists for tests (``httpx.MockTransport``) — production
    code never passes one. Every call raises :class:`StripeNotConfigured`
    when no API key is set, instead of making an unauthenticated request.
    """

    def __init__(
        self,
        api_key: str | None = None,
        transport: httpx.BaseTransport | None = None,
    ):
        self.api_key = (api_key if api_key is not None else api_key_from_env()).strip()
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _require_key(self) -> None:
        if not self.api_key:
            raise StripeNotConfigured(
                "STRIPE_API_KEY is not set — see docs/ecommerce.md. "
                "No Stripe calls can be made without it."
            )

    def _client(self) -> httpx.AsyncClient:
        # Stripe uses HTTP Basic auth: secret key as username, blank password.
        return httpx.AsyncClient(
            transport=self._transport, timeout=30,
            auth=(self.api_key, ""),
        )

    async def _get(self, path: str, params: dict | None = None) -> dict:
        self._require_key()
        async with self._client() as client:
            resp = await client.get(f"{BASE_URL}{path}", params=params or {})
            if resp.status_code == 401:
                raise RuntimeError(
                    "Stripe returned 401 — API key invalid. Use a test-mode "
                    "key (sk_test_...) while trying things out."
                )
            resp.raise_for_status()
            return resp.json()

    async def balance(self) -> dict:
        return parse_balance(await self._get("/balance"))

    async def get_payment_intent(self, payment_intent_id: str) -> dict:
        payload = await self._get(f"/payment_intents/{payment_intent_id}")
        return parse_payment(payload)

    async def list_charges(self, limit: int = 100) -> list[dict]:
        payload = await self._get("/charges", {
            "limit": max(1, min(100, limit)),
        })
        return parse_charges(payload)

    async def revenue_summary(self, limit: int = 100) -> dict:
        """Net revenue per currency from recent succeeded charges."""
        return summarize_charges(await self.list_charges(limit=limit))
