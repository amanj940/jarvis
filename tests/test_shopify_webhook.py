"""Tests for the Shopify webhook HTTP route (POST /api/webhooks/shopify).

No network, no live APIs, no real secrets. HMACs are computed locally
with a throwaway test secret, exactly as Shopify computes them. The
route runs against the REAL ``handle_webhook`` helper and a REAL
``EcommerceStore`` on a tmp SQLite file, reached through the same
``app.state.cfg.abs_path("data/ecommerce.db")`` wiring the production
server uses — so a passing test proves the verified payload really
lands in the cache, and a rejected one leaves it empty.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarvis.plugins.ecommerce.store import EcommerceStore  # noqa: E402
from jarvis.server.routes import shopify_webhooks  # noqa: E402

SECRET = "test-webhook-secret-do-not-use"

ORDER_PAYLOAD = {
    "id": 450789469,
    "name": "#1001",
    "order_number": 1001,
    "total_price": "100.00",
    "currency": "USD",
    "financial_status": "paid",
    "fulfillment_status": None,
    "email": "buyer@example.com",
    "customer": {"first_name": "Ada", "last_name": "Lovelace"},
    "line_items": [{"id": 1, "product_id": 101, "quantity": 1}],
}

PRODUCT_PAYLOAD = {
    "id": 101,
    "title": "Test Product",
    "vendor": "Test Vendor",
    "product_type": "Widget",
    "status": "active",
    "variants": [{"id": 201, "price": "100.00", "inventory_quantity": 3}],
}


class _Cfg:
    """Minimal stand-in for the app config: abs_path resolves under tmp."""

    def __init__(self, root: Path) -> None:
        self._root = root

    def abs_path(self, rel: str) -> Path:
        return self._root / rel


def _sign(body: bytes, secret: str = SECRET) -> str:
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


@pytest.fixture()
def client(monkeypatch, tmp_path):
    """TestClient with the router mounted at /api and a tmp cache DB."""
    monkeypatch.setenv("SHOPIFY_WEBHOOK_SECRET", SECRET)
    app = FastAPI()
    app.include_router(shopify_webhooks.router, prefix="/api")
    app.state.cfg = _Cfg(tmp_path)
    app.state.orchestrator = None
    app.state.registry = None
    app.state.memory = None
    app.state.agents = None
    with TestClient(app) as test_client:
        test_client.db_path = tmp_path / "data" / "ecommerce.db"  # type: ignore[attr-defined]
        yield test_client


def _store(client) -> EcommerceStore:
    return EcommerceStore(client.db_path)


def _post(client, payload, topic, secret=SECRET, sign_body=None, headers=None):
    body = json.dumps(payload).encode("utf-8")
    hdrs = {
        "X-Shopify-Topic": topic,
        "X-Shopify-Shop-Domain": "test.myshopify.com",
    }
    if secret is not None:
        hdrs["X-Shopify-Hmac-Sha256"] = _sign(
            body if sign_body is None else sign_body, secret
        )
    if headers:
        hdrs.update(headers)
    return client.post("/api/webhooks/shopify", content=body, headers=hdrs)


def test_signed_order_accepted_and_upserted(client):
    resp = _post(client, ORDER_PAYLOAD, "orders/create")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["kind"] == "order"
    assert data["action"] == "cached"
    assert data["topic"] == "orders/create"
    orders = _store(client).list_orders()
    assert len(orders) == 1
    assert orders[0]["remote_id"] == "450789469"
    assert orders[0]["shop"] == "test.myshopify.com"


def test_signed_product_accepted_and_upserted(client):
    resp = _post(client, PRODUCT_PAYLOAD, "products/update")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["kind"] == "product"
    assert data["action"] == "cached"
    products = _store(client).list_products()
    assert len(products) == 1
    assert products[0]["remote_id"] == "101"
    assert products[0]["title"] == "Test Product"


def test_unsigned_rejected(client):
    resp = _post(client, ORDER_PAYLOAD, "orders/create", secret=None)
    assert resp.status_code == 401, resp.text
    assert _store(client).counts() == {"products": 0, "orders": 0, "customers": 0}


def test_tampered_body_rejected(client):
    # Sign one body, send a different one.
    resp = _post(
        client,
        {**ORDER_PAYLOAD, "total_price": "0.01"},
        "orders/create",
        sign_body=json.dumps(ORDER_PAYLOAD).encode("utf-8"),
    )
    assert resp.status_code == 401, resp.text
    assert _store(client).list_orders() == []


def test_wrong_secret_rejected(client):
    resp = _post(client, ORDER_PAYLOAD, "orders/create", secret="wrong-secret")
    assert resp.status_code == 401, resp.text
    assert _store(client).list_orders() == []


def test_bad_signature_encoding_rejected(client):
    resp = _post(
        client,
        ORDER_PAYLOAD,
        "orders/create",
        headers={"X-Shopify-Hmac-Sha256": "!!!not-base64!!!"},
    )
    assert resp.status_code == 401, resp.text
    assert _store(client).list_orders() == []


def test_secret_not_configured_returns_503(monkeypatch, client):
    monkeypatch.delenv("SHOPIFY_WEBHOOK_SECRET")
    resp = _post(client, ORDER_PAYLOAD, "orders/create")
    assert resp.status_code == 503, resp.text
    assert _store(client).list_orders() == []


def test_unsupported_topic_rejected(client):
    resp = _post(client, ORDER_PAYLOAD, "orders/delete")
    assert resp.status_code == 400, resp.text
    assert _store(client).list_orders() == []


def test_invalid_json_rejected(client):
    body = b"{not json"
    resp = client.post(
        "/api/webhooks/shopify",
        content=body,
        headers={
            "X-Shopify-Topic": "orders/create",
            "X-Shopify-Hmac-Sha256": _sign(body),
            "X-Shopify-Shop-Domain": "test.myshopify.com",
        },
    )
    assert resp.status_code == 400, resp.text
    assert _store(client).list_orders() == []
