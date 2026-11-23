"""Unit tests for the e-commerce team agent — no network, no live APIs,
no real keys. HTTP clients are exercised through httpx.MockTransport."""
from __future__ import annotations

import asyncio
import base64
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarvis.plugins.ecommerce.shopify import (  # noqa: E402
    ShopifyClient, ShopifyNotConfigured, parse_customers, parse_orders,
    parse_products,
)
from jarvis.plugins.ecommerce.store import EcommerceStore  # noqa: E402
from jarvis.plugins.ecommerce.stripe import (  # noqa: E402
    StripeClient, StripeNotConfigured, parse_balance, parse_charges,
    parse_payment, summarize_charges,
)


# ---- fixtures (shapes as the real APIs return them) ----

SHOPIFY_PRODUCTS = {
    "products": [
        {"id": 1, "title": "Hoodie", "vendor": "Acme", "product_type": "Apparel",
         "status": "active",
         "variants": [{"price": "49.99", "inventory_quantity": 3},
                      {"price": "54.99", "inventory_quantity": 2}]},
        {"id": 2, "title": "Mug", "vendor": "Acme", "product_type": "",
         "status": "draft", "variants": []},
    ]
}
SHOPIFY_ORDERS = {
    "orders": [
        {"id": 10, "name": "#1001", "order_number": 1001, "total_price": "99.98",
         "currency": "USD", "financial_status": "paid",
         "fulfillment_status": "fulfilled", "email": "a@example.com",
         "customer": {"first_name": "Ada", "last_name": "Lovelace"},
         "line_items": [{}, {}]},
        {"id": 11, "name": "#1002", "order_number": 1002, "total_price": "20.00",
         "currency": "USD", "financial_status": "pending",
         "fulfillment_status": None, "email": "b@example.com",
         "customer": None, "line_items": [{}]},
    ]
}
SHOPIFY_CUSTOMERS = {
    "customers": [
        {"id": 5, "first_name": "Ada", "last_name": "Lovelace",
         "email": "a@example.com", "orders_count": 3, "total_spent": "149.97",
         "currency": "USD"},
        {"id": 6, "first_name": "Grace", "last_name": "Hopper",
         "email": "g@example.com", "orders_count": 1, "total_spent": "20.00",
         "currency": "USD"},
    ]
}
STRIPE_BALANCE = {
    "available": [{"amount": 12345, "currency": "usd"}],
    "pending": [{"amount": 500, "currency": "usd"},
                {"amount": 2000, "currency": "eur"}],
}
STRIPE_CHARGES = {
    "data": [
        {"id": "ch_1", "amount": 5000, "currency": "usd", "status": "succeeded",
         "amount_refunded": 1000, "description": "Hoodie",
         "receipt_email": "a@example.com", "created": 1700000000},
        {"id": "ch_2", "amount": 2000, "currency": "eur", "status": "succeeded",
         "amount_refunded": 0, "description": "", "customer": "cus_9",
         "created": 1700000100},
        {"id": "ch_3", "amount": 9999, "currency": "usd", "status": "failed",
         "amount_refunded": 0, "created": 1700000200},
    ]
}


# ---- Shopify parsing ----

def test_parse_products_price_and_stock():
    products = parse_products(SHOPIFY_PRODUCTS)
    assert len(products) == 2
    hoodie = products[0]
    assert hoodie["remote_id"] == "1"
    assert hoodie["price"] == 49.99  # first variant
    assert hoodie["inventory"] == 5  # 3 + 2 across variants
    assert hoodie["variants"] == 2
    mug = products[1]
    assert mug["price"] == 0.0 and mug["inventory"] == 0  # no variants: degrades


def test_parse_orders_list_and_single_shapes():
    orders = parse_orders(SHOPIFY_ORDERS)
    assert len(orders) == 2
    assert orders[0]["customer_name"] == "Ada Lovelace"
    assert orders[0]["total"] == 99.98
    assert orders[0]["line_items"] == 2
    assert orders[1]["customer_name"] == ""  # customer None: degrades
    assert orders[1]["fulfillment_status"] == ""
    single = parse_orders({"order": SHOPIFY_ORDERS["orders"][0]})
    assert len(single) == 1 and single[0]["remote_id"] == "10"


def test_parse_customers():
    customers = parse_customers(SHOPIFY_CUSTOMERS)
    assert customers[0]["total_spent"] == 149.97
    assert customers[0]["orders_count"] == 3
    assert customers[1]["email"] == "g@example.com"


# ---- Shopify client (MockTransport, no network) ----

def _shopify_transport(seen: dict):
    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("X-Shopify-Access-Token")
        seen["url"] = str(request.url)
        if request.url.path.endswith("/products.json"):
            return httpx.Response(200, json=SHOPIFY_PRODUCTS)
        if request.url.path.endswith("/orders.json"):
            return httpx.Response(200, json=SHOPIFY_ORDERS)
        if request.url.path.endswith("/customers.json"):
            return httpx.Response(200, json=SHOPIFY_CUSTOMERS)
        return httpx.Response(404, json={"error": "not found"})
    return httpx.MockTransport(handler)


def test_shopify_client_uses_token_header_and_parses(monkeypatch):
    monkeypatch.setenv("SHOPIFY_SHOP_URL", "test.myshopify.com")
    monkeypatch.setenv("SHOPIFY_ACCESS_TOKEN", "tok-test")
    seen: dict = {}
    client = ShopifyClient(transport=_shopify_transport(seen))
    assert client.configured is True
    products = asyncio.run(client.list_products())
    assert seen["auth"] == "tok-test"
    assert "test.myshopify.com/admin/api/2024-10/products.json" in seen["url"]
    assert [p["title"] for p in products] == ["Hoodie", "Mug"]
    orders = asyncio.run(client.list_orders())
    assert orders[0]["order_number"] == "1001"


def test_shopify_client_refuses_without_config(monkeypatch):
    monkeypatch.delenv("SHOPIFY_SHOP_URL", raising=False)
    monkeypatch.delenv("SHOPIFY_ACCESS_TOKEN", raising=False)
    client = ShopifyClient(transport=_shopify_transport({}))
    assert client.configured is False
    with pytest.raises(ShopifyNotConfigured):
        asyncio.run(client.list_products())


def test_shopify_client_has_no_write_methods():
    # Safety invariant: the client must not be able to change a store.
    for name in ("create_product", "update_product", "delete_product",
                 "create_order", "update_order", "cancel_order",
                 "create_customer", "update_customer"):
        assert not hasattr(ShopifyClient, name), name


# ---- Stripe parsing ----

def test_parse_balance():
    b = parse_balance(STRIPE_BALANCE)
    assert b["available"] == [{"amount": 12345, "currency": "USD"}]
    assert b["pending"][1] == {"amount": 2000, "currency": "EUR"}


def test_parse_payment_charge_and_customer_shapes():
    ch = parse_charges(STRIPE_CHARGES)
    assert len(ch) == 3
    assert ch[0]["amount_refunded"] == 1000
    assert ch[0]["receipt_email"] == "a@example.com"
    # customer as a plain id string must not crash or leak into the email
    assert ch[1]["receipt_email"] == ""
    assert ch[1]["currency"] == "EUR"
    pi = parse_payment({"id": "pi_1", "amount": 2500, "currency": "gbp",
                        "status": "requires_payment_method",
                        "customer": {"email": "c@example.com"}})
    assert pi["receipt_email"] == "c@example.com"
    assert pi["amount_refunded"] == 0


def test_summarize_charges_only_succeeded_minus_refunds():
    summary = summarize_charges(parse_charges(STRIPE_CHARGES))
    assert summary["ok"] is True
    by_cur = {b["currency"]: b for b in summary["by_currency"]}
    assert by_cur["USD"]["count"] == 1  # the failed charge is excluded
    assert by_cur["USD"]["gross_cents"] == 5000
    assert by_cur["USD"]["refunded_cents"] == 1000
    assert by_cur["USD"]["net"] == 40.00
    assert by_cur["EUR"]["net"] == 20.00


def test_summarize_charges_empty():
    assert summarize_charges([])["by_currency"] == []


# ---- Stripe client (MockTransport, no network) ----

def _stripe_transport(seen: dict):
    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization", "")
        if request.url.path == "/v1/balance":
            return httpx.Response(200, json=STRIPE_BALANCE)
        if request.url.path == "/v1/charges":
            return httpx.Response(200, json=STRIPE_CHARGES)
        return httpx.Response(404, json={"error": "not found"})
    return httpx.MockTransport(handler)


def test_stripe_client_basic_auth_and_balance(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_x")
    seen: dict = {}
    client = StripeClient(transport=_stripe_transport(seen))
    assert client.configured is True
    balance = asyncio.run(client.balance())
    assert balance["available"][0]["amount"] == 12345
    assert seen["auth"] == "Basic " + base64.b64encode(b"sk_test_x:").decode()


def test_stripe_client_revenue_summary(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_x")
    client = StripeClient(transport=_stripe_transport({}))
    summary = asyncio.run(client.revenue_summary())
    assert {b["currency"]: b["net"] for b in summary["by_currency"]} == {
        "USD": 40.00, "EUR": 20.00}


def test_stripe_client_refuses_without_key(monkeypatch):
    monkeypatch.delenv("STRIPE_API_KEY", raising=False)
    client = StripeClient(transport=_stripe_transport({}))
    assert client.configured is False
    with pytest.raises(StripeNotConfigured):
        asyncio.run(client.balance())


def test_stripe_client_has_no_money_moving_methods():
    # Safety invariant: Jarvis can look at money, never move it.
    for name in ("create_charge", "create_payment_intent", "create_refund",
                 "create_payout", "capture_charge"):
        assert not hasattr(StripeClient, name), name


# ---- store ----

def test_store_upsert_and_lists(tmp_path):
    store = EcommerceStore(tmp_path / "ecommerce.db")
    p = store.upsert_product(parse_products(SHOPIFY_PRODUCTS)[0], shop="test")
    assert p["title"] == "Hoodie" and p["inventory"] == 5
    # Upsert again with a changed price: same row, updated in place.
    changed = {**parse_products(SHOPIFY_PRODUCTS)[0], "price": 59.99}
    p2 = store.upsert_product(changed, shop="test")
    assert p2["id"] == p["id"] and p2["price"] == 59.99
    assert len(store.list_products()) == 1
    assert store.list_products(status="draft") == []
    assert store.list_products(status="active")[0]["title"] == "Hoodie"

    for o in parse_orders(SHOPIFY_ORDERS):
        store.upsert_order(o, shop="test")
    assert store.get_order("10")["name"] == "#1001"
    assert store.get_order_by_number("1002")["remote_id"] == "11"
    assert store.get_order("999") is None
    assert len(store.list_orders(financial_status="paid")) == 1

    for c in parse_customers(SHOPIFY_CUSTOMERS):
        store.upsert_customer(c, shop="test")
    customers = store.list_customers()
    assert customers[0]["email"] == "a@example.com"  # best spender first
    assert store.counts() == {"products": 1, "orders": 2, "customers": 2}


def test_store_revenue_counts_only_paid(tmp_path):
    store = EcommerceStore(tmp_path / "ecommerce.db")
    for o in parse_orders(SHOPIFY_ORDERS):
        store.upsert_order(o, shop="test")
    revenue = store.revenue_by_currency()
    assert revenue == [{"currency": "USD", "count": 1, "total": 99.98}]


def test_store_sync_state(tmp_path):
    store = EcommerceStore(tmp_path / "ecommerce.db")
    assert store.get_sync_state("test", "products") is None
    store.set_sync_state("test", "products", 7)
    state = store.get_sync_state("test", "products")
    assert state["last_count"] == 7 and state["last_synced_at"] > 0


# ---- plugin registration + tools ----

class _FakeCfg:
    def __init__(self, root: Path):
        self._root = root
        self.plugins = {}

    def abs_path(self, p):
        return self._root / p


def _registered_registry(tmp_path):
    from jarvis.plugins.ecommerce.tools import register
    from jarvis.plugins.registry import PluginRegistry

    registry = PluginRegistry(_FakeCfg(tmp_path))
    register(registry)
    return registry


def test_plugin_registers_ecommerce_tools(tmp_path):
    registry = _registered_registry(tmp_path)
    for name in ("ecommerce_list_products", "ecommerce_get_order",
                 "ecommerce_list_customers", "ecommerce_revenue_summary",
                 "ecommerce_sync_catalog"):
        assert registry.get(name) is not None, name
    assert registry.get("ecommerce_list_products").permission.name == "SAFE"
    assert registry.get("ecommerce_sync_catalog").permission.name == "CAUTION"


def test_tools_read_from_empty_cache(tmp_path):
    registry = _registered_registry(tmp_path)
    assert "no products" in registry.get("ecommerce_list_products").handler()
    assert "not found" in registry.get("ecommerce_get_order").handler(order_id="1")
    assert "no customers" in registry.get("ecommerce_list_customers").handler()


def test_sync_catalog_refuses_without_config(tmp_path, monkeypatch):
    monkeypatch.delenv("SHOPIFY_SHOP_URL", raising=False)
    monkeypatch.delenv("SHOPIFY_ACCESS_TOKEN", raising=False)
    registry = _registered_registry(tmp_path)
    result = asyncio.run(registry.get("ecommerce_sync_catalog").invoke({}))
    assert "not configured" in result
    assert registry.services["ecommerce_store"].counts() == {
        "products": 0, "orders": 0, "customers": 0}


class _FakeShopifyClient:
    """Stand-in for ShopifyClient: returns fixtures, never touches network."""
    shop_url = "test.myshopify.com"
    configured = True

    async def list_products(self, limit=50):
        return parse_products(SHOPIFY_PRODUCTS)

    async def list_orders(self, limit=50, financial_status=None):
        return parse_orders(SHOPIFY_ORDERS)

    async def list_customers(self, limit=50):
        return parse_customers(SHOPIFY_CUSTOMERS)


def test_sync_catalog_caches_locally_and_pushes_nothing(tmp_path, monkeypatch):
    import jarvis.plugins.ecommerce.tools as tools_mod

    monkeypatch.setattr(tools_mod, "ShopifyClient", _FakeShopifyClient)
    registry = _registered_registry(tmp_path)
    result = asyncio.run(registry.get("ecommerce_sync_catalog").invoke({}))
    assert "DRAFT SYNC" in result
    assert "nothing was pushed to Shopify" in result
    store = registry.services["ecommerce_store"]
    assert store.counts() == {"products": 2, "orders": 2, "customers": 2}
    assert store.get_sync_state("test.myshopify.com", "products")["last_count"] == 2
    # And the cached rows are now readable through the read tools.
    listing = registry.get("ecommerce_list_products").handler()
    assert "Hoodie" in listing and "Mug" in listing
    order = registry.get("ecommerce_get_order").handler(order_number="1001")
    assert "99.98" in order and "Ada Lovelace" in order


class _FakeStripeClient:
    configured = True

    async def revenue_summary(self, limit=100):
        return summarize_charges(parse_charges(STRIPE_CHARGES))


def test_revenue_summary_prefers_live_stripe(tmp_path, monkeypatch):
    import jarvis.plugins.ecommerce.tools as tools_mod

    monkeypatch.setattr(tools_mod, "StripeClient", _FakeStripeClient)
    registry = _registered_registry(tmp_path)
    result = asyncio.run(registry.get("ecommerce_revenue_summary").invoke({}))
    assert "live from Stripe" in result
    assert "USD: 1 charges, net 40.00" in result


def test_revenue_summary_falls_back_to_cache(tmp_path, monkeypatch):
    monkeypatch.delenv("STRIPE_API_KEY", raising=False)
    registry = _registered_registry(tmp_path)
    store = registry.services["ecommerce_store"]
    for o in parse_orders(SHOPIFY_ORDERS):
        store.upsert_order(o, shop="test")
    result = asyncio.run(registry.get("ecommerce_revenue_summary").invoke({}))
    assert "local cache" in result
    assert "USD: 1 paid orders, total 99.98" in result


def test_load_all_discovers_ecommerce(tmp_path):
    from jarvis.plugins.registry import PluginRegistry

    registry = PluginRegistry(_FakeCfg(tmp_path))
    registry.load_all()
    names = [p.name for p in registry.plugins()]
    assert "ecommerce" in names
    assert registry.get("ecommerce_sync_catalog") is not None
