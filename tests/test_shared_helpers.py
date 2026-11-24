"""Unit tests for the shared helpers dedupe (worker G) — no network.

Covers the three pieces that were split across the codebase:

* ``jarvis.plugins.common.urls.normalize_url`` — the single URL
  normaliser. The cases pinned by the old bounty tests must behave
  identically; the extras pin the divergences the old copies disagreed
  on (root path, query order, junk input).
* The bounty platform list — one source of truth
  (``programs.PROGRAMS``), used by both ``programs`` and
  ``programs_sync``.
* The partial/resumable ecommerce sync — a failed resource or a bad
  item no longer aborts the sync, progress is persisted per resource,
  and a re-run resumes without duplicating rows.
"""
from __future__ import annotations

import asyncio
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarvis.plugins.bounty import programs as bounty_programs  # noqa: E402
from jarvis.plugins.bounty import programs_sync as bounty_sync  # noqa: E402
from jarvis.plugins.bounty.programs_sync import (  # noqa: E402
    parse_search_results, sync_programs,
)
from jarvis.plugins.bounty.store import BountyStore  # noqa: E402
from jarvis.plugins.common.urls import (  # noqa: E402
    normalize_shop_domain, normalize_url,
)
from jarvis.plugins.ecommerce.shopify import parse_customers, parse_orders, parse_products  # noqa: E402
from jarvis.plugins.ecommerce.store import EcommerceStore  # noqa: E402
from jarvis.plugins.registry import PluginRegistry  # noqa: E402


# ----------------------------------------------------------------------
# normalize_url — must match every input the old copies covered.
# ----------------------------------------------------------------------

def test_normalize_url_matches_old_bounty_cases():
    # Pinned by the old tests/test_bounty_sync.py::test_normalize_url.
    assert normalize_url("HTTPS://HackerOne.COM/Acme/?utm_source=x#frag") == \
        "https://hackerone.com/Acme"
    assert normalize_url("https://example.com/a/?fbclid=1&x=2") == \
        "https://example.com/a?x=2"
    assert normalize_url("not a url") == ""
    assert normalize_url("") == ""


def test_normalize_url_reexported_by_programs_sync():
    # Old import path keeps working; it is the same function object.
    assert bounty_sync.normalize_url is normalize_url
    assert bounty_sync.normalize_url("https://EXAMPLE.com/X/?gclid=1") == \
        "https://example.com/X"


def test_normalize_url_extras():
    # Root path collapses (bounty semantics, not leads' "/").
    assert normalize_url("https://example.com") == "https://example.com"
    assert normalize_url("https://example.com/") == "https://example.com"
    assert normalize_url("https://example.com/?utm_campaign=c") == \
        "https://example.com"
    # Surviving query params keep their original order (not sorted).
    assert normalize_url("https://example.com/?b=2&a=1") == \
        "https://example.com?b=2&a=1"
    # Path case is preserved; hosts are not.
    assert normalize_url("HTTPS://Example.COM/Acme/Program") == \
        "https://example.com/Acme/Program"
    # Tracking-param matching is case-insensitive; other params survive.
    assert normalize_url("https://example.com/?UTM_SOURCE=x&y=1") == \
        "https://example.com?y=1"
    # Fragment always dropped; non-http(s) and junk return "".
    assert normalize_url("https://example.com/a#section") == \
        "https://example.com/a"
    assert normalize_url("ftp://example.com/a") == ""
    assert normalize_url(None) == ""  # type: ignore[arg-type]
    assert normalize_url("   ") == ""


def test_normalize_shop_domain():
    assert normalize_shop_domain("test.myshopify.com") == "test.myshopify.com"
    assert normalize_shop_domain("  MyStore.MyShopify.com  ") == \
        "mystore.myshopify.com"
    assert normalize_shop_domain("https://MyStore.myshopify.com/") == \
        "mystore.myshopify.com"
    assert normalize_shop_domain("http://shop.example.com/admin") == \
        "shop.example.com"
    assert normalize_shop_domain("") == ""


# ----------------------------------------------------------------------
# Bounty platforms — one source of truth.
# ----------------------------------------------------------------------

def test_platform_lists_have_single_source():
    specs = bounty_programs.sync_platform_specs()
    # programs_sync derives its list from programs.PROGRAMS, not a copy.
    assert bounty_sync.PLATFORMS == specs
    assert [p["platform"] for p in specs] == bounty_programs.list_platforms()
    assert bounty_programs.list_platforms() == bounty_sync.list_sync_platforms()
    assert bounty_programs.list_platforms() == [
        "hackerone", "bugcrowd", "intigriti", "yeswehack"]
    for spec in specs:
        assert set(spec) == {"platform", "name", "directory_url", "query"}
        assert spec["directory_url"].startswith("https://")
        assert spec["query"].startswith("site:")
    # Specs are fresh dicts — mutating one cannot corrupt PROGRAMS.
    specs[0]["platform"] = "mutated"
    assert bounty_programs.PROGRAMS[0]["platform"] == "hackerone"
    # Static notes still work off the same list.
    notes = bounty_programs.program_notes("hackerone")
    assert notes is not None and notes["url"] == "https://hackerone.com"
    assert bounty_programs.program_notes("not-a-platform") is None


def test_bounty_sync_still_dedups_with_shared_normalizer(tmp_path):
    # A tracking-link duplicate of an already-seen program page is one
    # candidate, not two — the shared normalizer does the dedup.
    text = ("1. Acme Corp — https://hackerone.com/acme?utm_source=x\n"
            "2. Acme Corp — https://hackerone.com/acme/\n")
    assert len(parse_search_results("hackerone", text)) == 1


def test_bounty_sync_end_to_end_with_shared_helpers(tmp_path):
    store = BountyStore(tmp_path / "bounty.db")

    def fake_search(query, max_results=5):
        return ("1. Acme Corp — https://hackerone.com/acme\n"
                "   Scope: *.acme.com.\n"
                "2. Beta Ltd — https://hackerone.com/beta?fbclid=1\n"
                "   Scope: beta.com.\n")

    first = asyncio.run(sync_programs(store, search=fake_search,
                                      platforms=["hackerone"]))
    assert first["added"] == 2 and first["duplicates"] == 0
    # A re-run finds the same two programs and adds nothing.
    second = asyncio.run(sync_programs(store, search=fake_search,
                                       platforms=["hackerone"]))
    assert second["added"] == 0 and second["duplicates"] == 2
    assert len(store.list_programs()) == 2


# ----------------------------------------------------------------------
# Ecommerce sync — partial + resumable.
# ----------------------------------------------------------------------

SHOPIFY_PRODUCTS = {
    "products": [
        {"id": 1, "title": "Hoodie", "vendor": "Acme", "product_type": "Apparel",
         "status": "active",
         "variants": [{"price": "49.99", "inventory_quantity": 3}]},
        {"id": 2, "title": "Mug", "vendor": "Acme", "product_type": "",
         "status": "draft", "variants": []},
    ]
}
SHOPIFY_ORDERS = {
    "orders": [
        {"id": 10, "order_number": "1001", "name": "#1001",
         "total_price": "99.98", "currency": "USD",
         "financial_status": "paid", "fulfillment_status": "fulfilled",
         "email": "ada@example.com",
         "customer": {"first_name": "Ada", "last_name": "Lovelace"},
         "line_items": [{"id": 1}]},
    ]
}
SHOPIFY_CUSTOMERS = {
    "customers": [
        {"id": 100, "first_name": "Ada", "last_name": "Lovelace",
         "email": "ada@example.com", "orders_count": 1,
         "total_spent": "99.98", "currency": "USD"},
    ]
}


class _FakeCfg:
    def __init__(self, root: Path):
        self._root = root
        self.plugins = {}

    def abs_path(self, p):
        return self._root / p


def _registered_registry(tmp_path):
    from jarvis.plugins.ecommerce.tools import register

    registry = PluginRegistry(_FakeCfg(tmp_path))
    register(registry)
    return registry


def _run_sync(registry, **kwargs):
    return asyncio.run(
        registry.get("ecommerce_sync_catalog").invoke(kwargs))


class _FullFakeClient:
    """Returns all fixtures, never touches the network."""
    shop_url = "test.myshopify.com"
    configured = True

    async def list_products(self, limit=50):
        return parse_products(SHOPIFY_PRODUCTS)

    async def list_orders(self, limit=50, financial_status=None):
        return parse_orders(SHOPIFY_ORDERS)

    async def list_customers(self, limit=50):
        return parse_customers(SHOPIFY_CUSTOMERS)


class _OrdersFailClient(_FullFakeClient):
    async def list_orders(self, limit=50, financial_status=None):
        raise RuntimeError("boom: orders endpoint down")


def test_sync_survives_failed_resource_and_persists_progress(
        tmp_path, monkeypatch):
    import jarvis.plugins.ecommerce.tools as tools_mod

    monkeypatch.setattr(tools_mod, "ShopifyClient", _OrdersFailClient)
    registry = _registered_registry(tmp_path)
    result = _run_sync(registry)
    assert "DRAFT SYNC partial" in result
    assert "orders" in result and "FETCH FAILED" in result
    store = registry.services["ecommerce_store"]
    # The healthy resources still cached; the failed one cached nothing.
    assert store.counts() == {"products": 2, "orders": 0, "customers": 1}
    state = store.get_sync_state("test.myshopify.com", "products")
    assert state["last_count"] == 2 and state["last_errors"] == 0
    orders_state = store.get_sync_state("test.myshopify.com", "orders")
    assert orders_state["last_count"] == 0
    assert orders_state["last_errors"] == 1
    assert "boom" in (orders_state["last_error"] or "")


def test_sync_survives_bad_item_and_resumes_without_duplicates(
        tmp_path, monkeypatch):
    import jarvis.plugins.ecommerce.tools as tools_mod

    bad_product = {"remote_id": "2", "title": "Mug", "vendor": "Acme",
                   "product_type": "", "status": "draft",
                   "price": "not-a-number", "currency": "",
                   "inventory": 0, "variants": 0}
    good_product = {"remote_id": "1", "title": "Hoodie", "vendor": "Acme",
                    "product_type": "Apparel", "status": "active",
                    "price": 49.99, "currency": "", "inventory": 3,
                    "variants": 1}

    class _BadItemClient(_FullFakeClient):
        async def list_products(self, limit=50):
            return [good_product, bad_product]

    monkeypatch.setattr(tools_mod, "ShopifyClient", _BadItemClient)
    registry = _registered_registry(tmp_path)
    result = _run_sync(registry)
    assert "DRAFT SYNC partial" in result
    assert "1 item(s) failed" in result
    store = registry.services["ecommerce_store"]
    assert store.counts()["products"] == 1  # good row cached, bad row skipped
    state = store.get_sync_state("test.myshopify.com", "products")
    assert state["last_count"] == 1 and state["last_errors"] == 1
    assert "2" in (state["last_error"] or "")  # failing remote_id recorded

    # Fix the client and re-run: the good row is refreshed, not duplicated,
    # and the previously-failing row now caches too.
    monkeypatch.setattr(tools_mod, "ShopifyClient", _FullFakeClient)
    result2 = _run_sync(registry)
    assert "DRAFT SYNC complete" in result2
    assert store.counts() == {"products": 2, "orders": 1, "customers": 1}
    state2 = store.get_sync_state("test.myshopify.com", "products")
    assert state2["last_count"] == 2 and state2["last_errors"] == 0


def test_sync_resumes_after_mid_run_fetch_failure(tmp_path, monkeypatch):
    import jarvis.plugins.ecommerce.tools as tools_mod

    calls = {"products": 0}

    class _FlakyClient(_FullFakeClient):
        async def list_products(self, limit=50):
            calls["products"] += 1
            if calls["products"] == 1:
                raise RuntimeError("network cut mid-run")
            return parse_products(SHOPIFY_PRODUCTS)

    monkeypatch.setattr(tools_mod, "ShopifyClient", _FlakyClient)
    registry = _registered_registry(tmp_path)
    assert "partial" in _run_sync(registry)
    store = registry.services["ecommerce_store"]
    assert store.counts() == {"products": 0, "orders": 1, "customers": 1}
    # The re-run picks up the missing resource; nothing is duplicated.
    assert "complete" in _run_sync(registry)
    assert store.counts() == {"products": 2, "orders": 1, "customers": 1}
    progress = store.get_sync_progress("test.myshopify.com")
    assert sorted(progress) == ["customers", "orders", "products"]
    assert progress["products"]["last_count"] == 2


def test_sync_state_migrates_old_database(tmp_path):
    # A database created before the error columns existed still opens,
    # gains the columns, and keeps its old rows.
    db_path = tmp_path / "old.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE ecommerce_sync_state (shop TEXT NOT NULL,"
        " resource TEXT NOT NULL, last_synced_at REAL NOT NULL,"
        " last_count INTEGER NOT NULL DEFAULT 0,"
        " PRIMARY KEY (shop, resource))")
    conn.execute(
        "INSERT INTO ecommerce_sync_state VALUES ('shop', 'products', 1, 5)")
    conn.commit()
    conn.close()
    store = EcommerceStore(db_path)
    state = store.get_sync_state("shop", "products")
    assert state["last_count"] == 5
    assert state["last_errors"] == 0 and state["last_error"] == ""
    store.set_sync_state("shop", "products", 6, errors=2, error="x failed")
    state = store.get_sync_state("shop", "products")
    assert state["last_count"] == 6 and state["last_errors"] == 2
    assert state["last_error"] == "x failed"
