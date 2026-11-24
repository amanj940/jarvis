"""Shopify Admin API client — read-only, config-gated, no keys in code.

Credentials come from the environment only::

    SHOPIFY_SHOP_URL       e.g. ``mystore.myshopify.com`` (no scheme, no path)
    SHOPIFY_ACCESS_TOKEN   Admin API access token (custom app, read scopes)

Nothing in this module contains a token or a credential, and nothing here
logs one. The client only ever issues ``GET`` requests — there is no
create/update/delete method at all, so Jarvis cannot change a store by
accident or by a prompt-injection: the sync tool writes to the local
SQLite cache only, never back to Shopify.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from ..common.urls import normalize_shop_domain

log = logging.getLogger("jarvis.ecommerce.shopify")

API_VERSION = "2024-10"


class ShopifyNotConfigured(RuntimeError):
    """Raised when SHOPIFY_SHOP_URL / SHOPIFY_ACCESS_TOKEN are missing."""


def shop_url_from_env() -> str:
    """Shop domain from the environment, normalised via the shared
    helper (strip + lowercase + drop a pasted scheme/path)."""
    return normalize_shop_domain(os.environ.get("SHOPIFY_SHOP_URL", ""))


def access_token_from_env() -> str:
    return os.environ.get("SHOPIFY_ACCESS_TOKEN", "").strip()


def _money(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


# ----------------------------------------------------------------------
# Pure parsing helpers — unit-testable without any network.
# ----------------------------------------------------------------------
def parse_products(payload: dict) -> list[dict]:
    """Parse a products.json response into flat product dicts.

    Price comes from the first variant; inventory is the sum of all
    variants' ``inventory_quantity``. Missing fields degrade to ``""``/0.
    """
    out: list[dict] = []
    for item in payload.get("products") or []:
        variants = item.get("variants") or []
        first = variants[0] if variants else {}
        out.append({
            "remote_id": str(item.get("id", "")),
            "title": item.get("title", ""),
            "vendor": item.get("vendor", ""),
            "product_type": item.get("product_type", ""),
            "status": item.get("status", ""),
            "price": _money(first.get("price")),
            "currency": "",  # REST products carry no currency; orders do
            "inventory": sum(_int(v.get("inventory_quantity")) for v in variants),
            "variants": len(variants),
        })
    return out


def parse_orders(payload: dict) -> list[dict]:
    """Parse an orders.json response into flat order dicts.

    Accepts both the list shape (``{"orders": [...]}``) and the single
    shape (``{"order": {...}}``) returned by a single-order GET.
    """
    items = payload.get("orders")
    if items is None and payload.get("order"):
        items = [payload["order"]]
    out: list[dict] = []
    for item in items or []:
        customer = item.get("customer") or {}
        first = (customer.get("first_name") or "").strip()
        last = (customer.get("last_name") or "").strip()
        out.append({
            "remote_id": str(item.get("id", "")),
            "order_number": str(item.get("order_number") or item.get("name", "")),
            "name": item.get("name", ""),
            "total": _money(item.get("total_price")),
            "currency": item.get("currency", ""),
            "financial_status": item.get("financial_status", ""),
            "fulfillment_status": item.get("fulfillment_status") or "",
            "customer_name": (first + " " + last).strip(),
            "customer_email": item.get("email") or customer.get("email") or "",
            "line_items": len(item.get("line_items") or []),
        })
    return out


def parse_customers(payload: dict) -> list[dict]:
    """Parse a customers.json response into flat customer dicts."""
    out: list[dict] = []
    for item in payload.get("customers") or []:
        out.append({
            "remote_id": str(item.get("id", "")),
            "first_name": item.get("first_name", ""),
            "last_name": item.get("last_name", ""),
            "email": item.get("email", ""),
            "orders_count": _int(item.get("orders_count")),
            "total_spent": _money(item.get("total_spent")),
            "currency": item.get("currency", ""),
        })
    return out


# ----------------------------------------------------------------------
# Client
# ----------------------------------------------------------------------
class ShopifyClient:
    """Thin async wrapper around the Shopify Admin REST API (read-only).

    ``transport`` exists for tests (``httpx.MockTransport``) — production
    code never passes one. Every call raises :class:`ShopifyNotConfigured`
    when the shop URL or token is missing, instead of making an
    unauthenticated request. Only ``GET`` is used; there are deliberately
    no POST/PUT/DELETE methods on this class.
    """

    def __init__(
        self,
        shop_url: str | None = None,
        access_token: str | None = None,
        transport: httpx.BaseTransport | None = None,
    ):
        self.shop_url = (shop_url if shop_url is not None else shop_url_from_env())
        self.access_token = (
            access_token if access_token is not None else access_token_from_env()
        )
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self.shop_url and self.access_token)

    def _require_config(self) -> None:
        if not self.shop_url or not self.access_token:
            raise ShopifyNotConfigured(
                "SHOPIFY_SHOP_URL and SHOPIFY_ACCESS_TOKEN are not set — "
                "see docs/ecommerce.md. No Shopify calls can be made without them."
            )

    def _base(self) -> str:
        return f"https://{self.shop_url}/admin/api/{API_VERSION}"

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=self._transport,
            timeout=30,
            headers={"X-Shopify-Access-Token": self.access_token},
        )

    async def _get(self, path: str, params: dict | None = None) -> dict:
        self._require_config()
        async with self._client() as client:
            resp = await client.get(f"{self._base()}{path}", params=params or {})
            if resp.status_code == 401:
                raise RuntimeError(
                    "Shopify returned 401 — access token invalid or missing "
                    "the required read scopes."
                )
            resp.raise_for_status()
            return resp.json()

    async def list_products(self, limit: int = 50) -> list[dict]:
        payload = await self._get("/products.json", {
            "limit": max(1, min(250, limit)),
            "fields": "id,title,vendor,product_type,status,variants",
        })
        return parse_products(payload)

    async def list_orders(
        self, limit: int = 50, financial_status: str | None = None,
    ) -> list[dict]:
        params: dict[str, Any] = {
            "limit": max(1, min(250, limit)),
            "status": "any",
            "fields": "id,name,order_number,total_price,currency,"
                      "financial_status,fulfillment_status,email,customer,line_items",
        }
        if financial_status:
            params["financial_status"] = financial_status
        payload = await self._get("/orders.json", params)
        return parse_orders(payload)

    async def get_order(self, order_id: str) -> dict | None:
        payload = await self._get(f"/orders/{order_id}.json")
        orders = parse_orders(payload)
        return orders[0] if orders else None

    async def list_customers(self, limit: int = 50) -> list[dict]:
        payload = await self._get("/customers.json", {
            "limit": max(1, min(250, limit)),
            "fields": "id,first_name,last_name,email,orders_count,total_spent,currency",
        })
        return parse_customers(payload)
