"""Unit tests for Shopify webhook receive-and-record helpers.

No network, no live APIs, no real secrets. HMACs are computed locally
with a throwaway test secret, exactly as Shopify computes them.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarvis.plugins.ecommerce import webhooks  # noqa: E402
from jarvis.plugins.ecommerce.store import EcommerceStore  # noqa: E402
from jarvis.plugins.ecommerce.webhooks import (  # noqa: E402
    SUPPORTED_TOPICS, WebhookNotConfigured, WebhookPayloadError,
    WebhookVerificationError, handle_webhook, parse_webhook_payload,
    verify_signature,
)

SECRET = "test-webhook-secret-do-not-use"


def _sign(body: bytes, secret: str = SECRET) -> str:
    digest = hmac.new(secret.encode(), body, hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


ORDER_BODY = json.dumps({
    "id": 10, "name": "#1001", "order_number": 1001,
    "total_price": "99.98", "currency": "USD", "financial_status": "paid",
    "fulfillment_status": "fulfilled", "email": "a@example.com",
    "customer": {"first_name": "Ada", "last_name": "Lovelace"},
    "line_items": [{}, {}],
}).encode()

UPDATED_ORDER_BODY = json.dumps({
    "id": 10, "name": "#1001", "order_number": 1001,
    "total_price": "120.00", "currency": "USD",
    "financial_status": "refunded", "fulfillment_status": "fulfilled",
    "email": "a@example.com",
    "customer": {"first_name": "Ada", "last_name": "Lovelace"},
    "line_items": [{}, {}],
}).encode()

PRODUCT_BODY = json.dumps({
    "id": 1, "title": "Hoodie", "vendor": "Acme",
    "product_type": "Apparel", "status": "active",
    "variants": [{"price": "49.99", "inventory_quantity": 3}],
}).encode()


@pytest.fixture()
def store(tmp_path):
    return EcommerceStore(tmp_path / "ecommerce.db")


# ---- HMAC verification ----

def test_valid_hmac_accepted():
    assert verify_signature(ORDER_BODY, _sign(ORDER_BODY), SECRET) is True


def test_bad_hmac_rejected():
    assert verify_signature(ORDER_BODY, _sign(b"tampered body"), SECRET) is False


def test_wrong_secret_rejected():
    assert verify_signature(ORDER_BODY, _sign(ORDER_BODY, "other-secret"),
                            SECRET) is False


def test_missing_signature_rejected():
    assert verify_signature(ORDER_BODY, None, SECRET) is False
    assert verify_signature(ORDER_BODY, "", SECRET) is False


def test_missing_secret_rejected(monkeypatch):
    monkeypatch.delenv("SHOPIFY_WEBHOOK_SECRET", raising=False)
    assert verify_signature(ORDER_BODY, _sign(ORDER_BODY)) is False


def test_garbage_signature_rejected():
    assert verify_signature(ORDER_BODY, "not-base64!!!", SECRET) is False


# ---- orders/create: verify + cache ----

def test_orders_create_caches_order(store):
    result = handle_webhook(ORDER_BODY, "orders/create",
                            _sign(ORDER_BODY), store,
                            shop="acme.myshopify.com", secret=SECRET)
    assert result == {"topic": "orders/create", "remote_id": "10",
                      "kind": "order", "action": "cached"}
    order = store.get_order("10")
    assert order is not None
    assert order["order_number"] == "1001"
    assert order["total"] == 99.98
    assert order["financial_status"] == "paid"
    assert order["customer_name"] == "Ada Lovelace"
    assert order["shop"] == "acme.myshopify.com"


def test_bad_hmac_rejected_and_nothing_cached(store):
    with pytest.raises(WebhookVerificationError):
        handle_webhook(ORDER_BODY, "orders/create",
                       _sign(b"tampered body"), store, secret=SECRET)
    assert store.get_order("10") is None
    assert store.counts() == {"products": 0, "orders": 0, "customers": 0}


def test_missing_secret_refuses_and_nothing_cached(store, monkeypatch):
    monkeypatch.delenv("SHOPIFY_WEBHOOK_SECRET", raising=False)
    with pytest.raises(WebhookNotConfigured):
        handle_webhook(ORDER_BODY, "orders/create", _sign(ORDER_BODY), store)
    assert store.counts()["orders"] == 0


# ---- orders/updated: upsert, not duplicate ----

def test_orders_updated_upserts_existing_row(store):
    handle_webhook(ORDER_BODY, "orders/create", _sign(ORDER_BODY),
                   store, secret=SECRET)
    result = handle_webhook(UPDATED_ORDER_BODY, "orders/updated",
                            _sign(UPDATED_ORDER_BODY), store, secret=SECRET)
    assert result["action"] == "cached"
    assert store.counts()["orders"] == 1  # same row, updated in place
    order = store.get_order("10")
    assert order["total"] == 120.00
    assert order["financial_status"] == "refunded"


# ---- products/update ----

def test_products_update_caches_product(store):
    result = handle_webhook(PRODUCT_BODY, "products/update",
                            _sign(PRODUCT_BODY), store, secret=SECRET)
    assert result == {"topic": "products/update", "remote_id": "1",
                      "kind": "product", "action": "cached"}
    products = store.list_products()
    assert len(products) == 1
    assert products[0]["title"] == "Hoodie"
    assert products[0]["price"] == 49.99
    assert products[0]["inventory"] == 3


# ---- malformed payloads ----

def test_malformed_json_rejected(store):
    body = b"{not json"
    with pytest.raises(WebhookPayloadError):
        handle_webhook(body, "orders/create", _sign(body), store,
                       secret=SECRET)
    assert store.counts()["orders"] == 0


def test_non_object_json_rejected(store):
    body = b"[1, 2, 3]"
    with pytest.raises(WebhookPayloadError):
        handle_webhook(body, "orders/create", _sign(body), store,
                       secret=SECRET)


def test_payload_without_id_rejected(store):
    body = json.dumps({"name": "#1001"}).encode()
    with pytest.raises(WebhookPayloadError):
        handle_webhook(body, "orders/create", _sign(body), store,
                       secret=SECRET)
    assert store.counts()["orders"] == 0


def test_unknown_topic_rejected(store):
    body = json.dumps({"id": 99}).encode()
    with pytest.raises(WebhookPayloadError):
        handle_webhook(body, "orders/cancelled", _sign(body), store,
                       secret=SECRET)
    assert store.counts() == {"products": 0, "orders": 0, "customers": 0}


def test_supported_topics_are_exactly_the_three():
    assert SUPPORTED_TOPICS == {
        "orders/create", "orders/updated", "products/update",
    }


# ---- parse helper (no store, no verification) ----

def test_parse_webhook_payload_order():
    parsed = parse_webhook_payload("orders/create", json.loads(ORDER_BODY))
    assert parsed["kind"] == "order"
    assert parsed["record"]["remote_id"] == "10"


def test_parse_webhook_payload_product():
    parsed = parse_webhook_payload("products/update",
                                   json.loads(PRODUCT_BODY))
    assert parsed["kind"] == "product"
    assert parsed["record"]["title"] == "Hoodie"


# ---- refusal by design: no write actions exist ----

def test_no_write_methods_exist():
    """The module must expose no fulfilment/charge/refund/order API.

    A webhook is an inbound notification, not an instruction — if a
    future edit adds a write action here, this test must fail first.
    Docstrings may *describe* the refusal, so this checks the actual
    public names and imports, not prose.
    """
    public_names = [n for n in dir(webhooks) if not n.startswith("_")]
    for name in public_names:
        lowered = name.lower()
        for forbidden in ("fulfil", "charge", "refund", "payout",
                          "place_order", "create_order", "contact"):
            assert forbidden not in lowered, f"forbidden write API: {name}"
    source = Path(webhooks.__file__).read_text()
    for line in source.splitlines():
        stripped = line.strip()
        if stripped.startswith(("import ", "from ")):
            assert "httpx" not in stripped and "requests" not in stripped, (
                f"network import in webhooks module: {stripped}")
    for name in ("fulfil_order", "place_order", "charge_card",
                 "issue_refund", "contact_customer"):
        assert not hasattr(webhooks, name)


def test_webhook_does_not_touch_the_network(monkeypatch, tmp_path):
    """handle_webhook must work with all network access disabled."""
    import httpx

    def _boom(*args, **kwargs):
        raise AssertionError("network call attempted")

    monkeypatch.setattr(httpx.AsyncClient, "__init__", _boom)
    s = EcommerceStore(tmp_path / "ecommerce.db")
    result = handle_webhook(ORDER_BODY, "orders/create",
                            _sign(ORDER_BODY), s, secret=SECRET)
    assert result["action"] == "cached"
    assert s.get_order("10") is not None
