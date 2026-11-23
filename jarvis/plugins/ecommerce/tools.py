"""E-commerce tools for JARVIS (Shopify + Stripe).

Safety rules, baked in — not just documented:
* Reads come from the local SQLite cache unless a tool says otherwise.
* The sync tool is a DRAFT/plan operation: it pulls from Shopify into
  the local cache and reports what changed. It never pushes anything
  back to Shopify, and the clients have no write methods at all.
* Stripe is read-only: balance, payment lookup, revenue summary. There
  is no charge, refund, or payout call anywhere in this plugin.
* Nothing here places an order, charges a card, or contacts a customer.
* Credentials come from the environment only (see docs/ecommerce.md).
"""
from __future__ import annotations

from ..base import PluginInfo, tool
from ...core.permissions import Permission
from .shopify import ShopifyClient, ShopifyNotConfigured
from .store import EcommerceStore
from .stripe import StripeClient, StripeNotConfigured


def _store(registry) -> EcommerceStore:
    store = registry.services.get("ecommerce_store")
    if store is None:
        store = EcommerceStore(registry.cfg.abs_path("data/ecommerce.db"))
        registry.services["ecommerce_store"] = store
    return store


def register(registry):
    store = _store(registry)

    @tool(
        name="ecommerce_list_products",
        description="List products from the local e-commerce cache (populated by ecommerce_sync_catalog). Read-only.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["active", "draft", "archived"]},
                "limit": {"type": "integer", "default": 20},
            },
        },
    )
    def ecommerce_list_products(status: str | None = None, limit: int = 20) -> str:
        products = store.list_products(status=status, limit=limit)
        if not products:
            return ("no products in the local cache — run ecommerce_sync_catalog "
                    "first (needs SHOPIFY_SHOP_URL + SHOPIFY_ACCESS_TOKEN).")
        lines = []
        for p in products:
            price = f"{p['price']:.2f}" if p["price"] else "n/a"
            lines.append(
                f"#{p['remote_id']} {p['title']} — {p['vendor']} "
                f"[{p['status']}] price {price}, stock {p['inventory']}")
        return "\n".join(lines)

    @tool(
        name="ecommerce_get_order",
        description="Look up one order from the local e-commerce cache, by Shopify order id or order number. Read-only.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "order_id": {"type": "string"},
                "order_number": {"type": "string"},
            },
        },
    )
    def ecommerce_get_order(order_id: str | None = None,
                            order_number: str | None = None) -> str:
        order = None
        if order_id:
            order = store.get_order(order_id)
        elif order_number:
            order = store.get_order_by_number(order_number)
        if order is None:
            return ("order not found in the local cache — run "
                    "ecommerce_sync_catalog first, or check the id/number.")
        return (
            f"order {order['name'] or '#' + order['order_number']} "
            f"(id {order['remote_id']}): total {order['total']:.2f} "
            f"{order['currency']}, payment {order['financial_status']}, "
            f"fulfilment {order['fulfillment_status'] or 'unknown'}, "
            f"customer {order['customer_name'] or '-'} "
            f"<{order['customer_email'] or '-'}>, "
            f"{order['line_items']} line items."
        )

    @tool(
        name="ecommerce_list_customers",
        description="List customers from the local e-commerce cache, best spenders first. Read-only.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {"limit": {"type": "integer", "default": 20}},
        },
    )
    def ecommerce_list_customers(limit: int = 20) -> str:
        customers = store.list_customers(limit=limit)
        if not customers:
            return ("no customers in the local cache — run ecommerce_sync_catalog "
                    "first (needs SHOPIFY_SHOP_URL + SHOPIFY_ACCESS_TOKEN).")
        return "\n".join(
            f"#{c['remote_id']} {c['first_name']} {c['last_name']} "
            f"<{c['email'] or '-'}> — {c['orders_count']} orders, "
            f"spent {c['total_spent']:.2f} {c['currency']}"
            for c in customers
        )

    @tool(
        name="ecommerce_revenue_summary",
        description="Net revenue per currency. Live from Stripe when STRIPE_API_KEY is set, otherwise from paid orders in the local cache. Read-only; never moves money.",
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {}},
    )
    async def ecommerce_revenue_summary() -> str:
        stripe = StripeClient()
        if stripe.configured:
            try:
                summary = await stripe.revenue_summary()
            except (StripeNotConfigured, RuntimeError) as e:
                return f"Stripe lookup failed: {e}"
            rows = summary["by_currency"]
            if not rows:
                return "Stripe: no succeeded charges found."
            lines = ["Revenue (live from Stripe, succeeded charges minus refunds):"]
            for b in rows:
                lines.append(
                    f"  {b['currency']}: {b['count']} charges, "
                    f"net {b['net']:.2f} (gross {b['gross_cents'] / 100:.2f}, "
                    f"refunded {b['refunded_cents'] / 100:.2f})")
            return "\n".join(lines)
        rows = store.revenue_by_currency()
        if not rows:
            return ("no Stripe key and no paid orders in the local cache — "
                    "set STRIPE_API_KEY for live revenue, or run "
                    "ecommerce_sync_catalog to cache Shopify orders.")
        lines = ["Revenue (from paid orders in the local cache — Stripe not configured):"]
        for r in rows:
            lines.append(f"  {r['currency']}: {r['count']} paid orders, "
                         f"total {r['total']:.2f}")
        return "\n".join(lines)

    @tool(
        name="ecommerce_sync_catalog",
        description="DRAFT sync: pull products, orders and customers from Shopify into the local cache only. Never pushes changes to Shopify. Needs SHOPIFY_SHOP_URL + SHOPIFY_ACCESS_TOKEN.",
        permission=Permission.CAUTION,
        parameters={
            "type": "object",
            "properties": {"limit": {"type": "integer", "default": 50}},
        },
        preview=lambda a: "ecommerce sync (draft, local cache only)",
    )
    async def ecommerce_sync_catalog(limit: int = 50) -> str:
        client = ShopifyClient()
        if not client.configured:
            return ("Shopify is not configured — set SHOPIFY_SHOP_URL and "
                    "SHOPIFY_ACCESS_TOKEN (see docs/ecommerce.md). "
                    "Nothing was synced.")
        try:
            products = await client.list_products(limit=limit)
            orders = await client.list_orders(limit=limit)
            customers = await client.list_customers(limit=limit)
        except (ShopifyNotConfigured, RuntimeError) as e:
            return f"Shopify sync failed: {e}"
        shop = client.shop_url
        for p in products:
            store.upsert_product(p, shop=shop)
        for o in orders:
            store.upsert_order(o, shop=shop)
        for c in customers:
            store.upsert_customer(c, shop=shop)
        store.set_sync_state(shop, "products", len(products))
        store.set_sync_state(shop, "orders", len(orders))
        store.set_sync_state(shop, "customers", len(customers))
        counts = store.counts()
        return (
            f"DRAFT SYNC complete for {shop} — local cache only, "
            "nothing was pushed to Shopify:\n"
            f"  products cached: {len(products)} (total in cache: {counts['products']})\n"
            f"  orders cached: {len(orders)} (total in cache: {counts['orders']})\n"
            f"  customers cached: {len(customers)} (total in cache: {counts['customers']})\n"
            "Review the cached data with ecommerce_list_products / "
            "ecommerce_get_order / ecommerce_list_customers before acting on it."
        )

    registry.add_pending("ecommerce")
    registry.register_plugin(PluginInfo(
        name="ecommerce",
        description="Shopify + Stripe read-only store view with a local cache. Draft sync only; never charges, refunds, or modifies a store.",
        permissions_needed=[Permission.CAUTION],
    ))
