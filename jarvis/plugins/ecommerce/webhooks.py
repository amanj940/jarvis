"""Shopify webhook helpers — receive-and-record ONLY.

A webhook lets Shopify tell Jarvis that something changed, instead of
Jarvis polling. These helpers verify the request really came from
Shopify and record the change in the local SQLite cache — nothing more.

What this module DOES:
* Verify the ``X-Shopify-Hmac-Sha256`` header with HMAC-SHA256. The
  secret comes from the environment only (``SHOPIFY_WEBHOOK_SECRET``);
  it is never stored in the repo, never logged, and never written to
  the cache.
* Parse ``orders/create``, ``orders/updated`` and ``products/update``
  payloads and upsert them into the existing :class:`EcommerceStore`
  cache, using the same parsers as the read-only sync tool.
* Refuse anything else by design (see below).

What this module NEVER does — there is deliberately no code path for it:
* fulfilment, order placement, charges, refunds, payouts, or any
  customer contact. A webhook is an inbound notification, not an
  instruction to act on the store. If a payload ever asked for one of
  those, it would be recorded as data and nothing would happen.
* Any network call. Verification and parsing are pure functions of the
  raw request body; only the local SQLite cache is written.

Wiring note: there is intentionally no HTTP route in this file. The
route (e.g. ``POST /api/ecommerce/webhooks``) belongs to the server
routes layer and is a separate, small follow-up; these helpers are what
it should call. See ``docs/ecommerce-webhooks.md``.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import logging
import os
from typing import Any

from .shopify import parse_orders, parse_products
from .store import EcommerceStore

log = logging.getLogger("jarvis.ecommerce.webhooks")

SUPPORTED_TOPICS = frozenset({"orders/create", "orders/updated", "products/update"})

# Actions this module refuses, by design. A webhook payload is data, not
# an instruction — if Shopify ever sent one of these as an action, the
# correct behaviour is to record nothing and do nothing.
REFUSED_ACTIONS = frozenset({
    "fulfilment", "fulfillment", "order_placement", "charge",
    "refund", "payout", "customer_contact",
})


class WebhookNotConfigured(RuntimeError):
    """Raised when SHOPIFY_WEBHOOK_SECRET is not set."""


class WebhookVerificationError(ValueError):
    """Raised when the HMAC signature is missing or does not match."""


class WebhookPayloadError(ValueError):
    """Raised when the body is not a valid webhook payload for its topic."""


def webhook_secret_from_env() -> str:
    """Read the webhook secret from the environment only."""
    return os.environ.get("SHOPIFY_WEBHOOK_SECRET", "").strip()


def verify_signature(
    raw_body: bytes,
    signature: str | None,
    secret: str | None = None,
) -> bool:
    """Check Shopify's ``X-Shopify-Hmac-Sha256`` header.

    ``secret`` defaults to ``SHOPIFY_WEBHOOK_SECRET`` from the
    environment. Returns ``False`` (never raises) when the secret or
    the signature is missing, empty, or not valid base64, or when the
    digest does not match. Comparison is constant-time.
    """
    if secret is None:
        secret = webhook_secret_from_env()
    if not secret or not signature:
        return False
    try:
        expected = base64.b64decode(signature.strip(), validate=True)
    except (binascii.Error, ValueError):
        return False
    actual = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).digest()
    return hmac.compare_digest(actual, expected)


def _require_verified(raw_body: bytes, signature: str | None,
                      secret: str | None) -> None:
    if secret is None:
        secret = webhook_secret_from_env()
    if not secret:
        raise WebhookNotConfigured(
            "SHOPIFY_WEBHOOK_SECRET is not set — webhook signatures cannot "
            "be verified, so the payload is refused. See "
            "docs/ecommerce-webhooks.md."
        )
    if not verify_signature(raw_body, signature, secret):
        raise WebhookVerificationError(
            "HMAC signature missing or does not match — refusing payload."
        )


def _decode_body(raw_body: bytes) -> dict:
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise WebhookPayloadError(f"webhook body is not valid JSON: {e}")
    if not isinstance(payload, dict):
        raise WebhookPayloadError(
            "webhook body must be a JSON object, "
            f"got {type(payload).__name__}."
        )
    return payload


def parse_webhook_payload(topic: str, payload: dict) -> dict:
    """Turn a verified webhook payload into a flat cache record.

    Returns ``{"kind": "order" | "product", "record": {...}}`` using the
    same parsers as the read-only sync tool. Raises
    :class:`WebhookPayloadError` for unknown topics, or for payloads
    without an ``id``. No store is touched here.
    """
    if topic not in SUPPORTED_TOPICS:
        raise WebhookPayloadError(
            f"unsupported webhook topic {topic!r} — supported topics: "
            f"{sorted(SUPPORTED_TOPICS)}."
        )
    if not payload.get("id"):
        raise WebhookPayloadError(
            f"webhook payload for {topic!r} has no 'id' — refusing to cache."
        )
    if topic.startswith("orders/"):
        parsed = parse_orders({"order": payload})
        if not parsed:
            raise WebhookPayloadError(
                f"could not parse orders payload for {topic!r}."
            )
        return {"kind": "order", "record": parsed[0]}
    parsed = parse_products({"products": [payload]})
    if not parsed:
        raise WebhookPayloadError(
            f"could not parse products payload for {topic!r}."
        )
    return {"kind": "product", "record": parsed[0]}


def handle_webhook(
    raw_body: bytes,
    topic: str,
    signature: str | None,
    store: EcommerceStore,
    shop: str = "",
    secret: str | None = None,
) -> dict:
    """Verify a Shopify webhook and record it in the local cache.

    ``raw_body`` is the exact request bytes (Shopify signs the raw
    body, not a re-serialised dict). ``topic`` is the
    ``X-Shopify-Topic`` header, ``signature`` the
    ``X-Shopify-Hmac-Sha256`` header, ``shop`` the
    ``X-Shopify-Shop-Domain`` header. Returns a summary dict::

        {"topic": ..., "remote_id": ..., "kind": "order"|"product",
         "action": "cached"}

    Raises :class:`WebhookNotConfigured` (no secret),
    :class:`WebhookVerificationError` (bad/missing signature) or
    :class:`WebhookPayloadError` (bad topic or payload). On any raise,
    nothing is written to the cache. The only write this function ever
    performs is the cache upsert — no fulfilment, no order placement,
    no charge, no refund, no customer contact.
    """
    _require_verified(raw_body, signature, secret)
    payload = _decode_body(raw_body)
    parsed = parse_webhook_payload(topic, payload)
    record = parsed["record"]
    if parsed["kind"] == "order":
        store.upsert_order(record, shop=shop)
    else:
        store.upsert_product(record, shop=shop)
    log.info("webhook %s cached: %s id=%s",
             topic, parsed["kind"], record.get("remote_id"))
    return {
        "topic": topic,
        "remote_id": record.get("remote_id", ""),
        "kind": parsed["kind"],
        "action": "cached",
    }
