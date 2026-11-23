# E-commerce team — Shopify + Stripe (read-only)

Jarvis can look at your store, it can never change it or move money.

## What it does

- **Shopify (read-only):** list products, look up orders, list customers.
  Data is pulled into a local SQLite cache (`data/ecommerce.db`) by the
  draft sync tool and read from there afterwards.
- **Stripe (read-only):** available/pending balance, payment lookup,
  net revenue per currency (succeeded charges minus refunds).
- **Local cache:** products, orders, customers, sync state. Upserts are
  keyed by remote id, so re-syncing updates rows instead of duplicating.

## Setup

No keys in code, config, or docs — everything comes from the environment:

```bash
# Shopify custom app (Admin API, read-only scopes:
# read_products, read_orders, read_customers)
export SHOPIFY_SHOP_URL="mystore.myshopify.com"   # no https://, no path
export SHOPIFY_ACCESS_TOKEN="shpat_..."

# Stripe (use a test-mode key sk_test_... while trying things out)
export STRIPE_API_KEY="sk_test_..."
```

Without these, the tools say so and do nothing: `ecommerce_sync_catalog`
reports "not configured", `ecommerce_revenue_summary` falls back to the
local cache, and the list/get tools read the cache (or say it is empty).

## Tools

| Tool | Permission | What it does |
|---|---|---|
| `ecommerce_list_products` | SAFE | Products from the local cache, optional `status` filter |
| `ecommerce_get_order` | SAFE | One order from the cache, by `order_id` or `order_number` |
| `ecommerce_list_customers` | SAFE | Customers from the cache, best spenders first |
| `ecommerce_revenue_summary` | SAFE | Net revenue per currency — live from Stripe when configured, else paid orders in the cache |
| `ecommerce_sync_catalog` | CAUTION | **DRAFT sync:** pulls products/orders/customers from Shopify into the local cache only |

## Workflow

1. Set the env vars above.
2. Run `ecommerce_sync_catalog` — it reports how many rows were cached
   and states explicitly that nothing was pushed to Shopify.
3. Ask about the store: "what are my best sellers?", "show order #1001",
   "how much revenue this month?" (revenue uses Stripe charges when a
   key is set; otherwise paid cached orders).

## Safety rules

1. **Read-only clients.** `ShopifyClient` only issues `GET`; `StripeClient`
   only issues `GET`. Neither class has a create/update/delete, charge,
   refund, or payout method — verified by unit tests.
2. **Draft sync only.** The sync tool writes to the local SQLite cache.
   It never pushes changes to Shopify or Stripe.
3. **No real transactions.** Nothing in this plugin places an order,
   charges a card, issues a refund, or contacts a customer. Anything
   like that needs a human doing it in the Shopify/Stripe dashboard.
4. **Keys stay out of the repo.** Env vars only. Prefer Stripe test-mode
   keys until the workflow is trusted.
5. **Cache is a cache.** Prices/totals are snapshots from the last sync;
   re-run `ecommerce_sync_catalog` before acting on numbers that matter.
