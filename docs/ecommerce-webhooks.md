# E-commerce webhooks — Shopify, receive-and-record only

Shopify can push a notification to Jarvis the moment an order is
created/updated or a product changes, instead of Jarvis polling. The
helpers in `jarvis/plugins/ecommerce/webhooks.py` verify that the
notification really came from Shopify and record it in the local
SQLite cache (`data/ecommerce.db`). That is all they do.

## Setup

1. Set the webhook secret in the environment (never in the repo):

   ```bash
   setx SHOPIFY_WEBHOOK_SECRET "<secret from Shopify admin>"
   ```

   The secret is shown once when you create the webhook in
   **Shopify admin → Settings → Notifications → Webhooks**. If the
   secret is missing, every webhook is refused with
   `WebhookNotConfigured` — nothing is cached unverified.

2. In the same Shopify admin screen, create one webhook per topic,
   all pointing at the same URL (the HTTP route is a small follow-up
   and is not wired yet — see below):

   | Topic | What happens |
   |---|---|
   | `orders/create` | Order is upserted into the local cache |
   | `orders/updated` | Same order row is updated in place (no duplicate) |
   | `products/update` | Product is upserted into the local cache |

   API version: same as the rest of the plugin (`2024-10`).

3. Restart the backend so the secret is picked up.

## What is recorded

- Orders: id, order number, total, currency, payment status,
  fulfilment status, customer name/email, line-item count.
- Products: id, title, vendor, type, status, price (first variant),
  inventory (sum of variants), variant count.
- Each record keeps the full original payload in the `payload`
  column, and `synced_at` is refreshed on every upsert.
- The shop domain (from the `X-Shopify-Shop-Domain` header) is stored
  beside each row, so one cache can hold several shops.

Read the cache with the existing tools: `ecommerce_get_order`,
`ecommerce_list_products`, `ecommerce_list_customers`,
`ecommerce_revenue_summary`.

## What is explicitly NEVER done

A webhook is an inbound notification, not an instruction. These
helpers contain no code path for any of the following, and the test
suite fails if one is ever added:

- fulfilment, order placement, charges, refunds, payouts
- contacting a customer (email, SMS, anything)
- any network call back to Shopify or anywhere else

If a payload ever implied one of those actions, it would be recorded
as data and nothing would happen. Anything beyond caching needs a
human to review the cache first and act deliberately.

## Verification

Every request is checked before anything is written:

1. `SHOPIFY_WEBHOOK_SECRET` must be set.
2. The `X-Shopify-Hmac-Sha256` header must be a valid base64
   HMAC-SHA256 of the **raw request body** (not a re-serialised dict),
   compared in constant time. A missing, malformed, or mismatched
   signature is rejected and nothing is cached.
3. The body must be a JSON object with an `id`, for a supported topic.

## Not yet wired (deliberate)

There is no HTTP route yet — `handle_webhook()` is a pure helper the
route will call with `(raw_body, topic, signature, store, shop)`.
Adding `POST /api/ecommerce/webhooks` to the server routes layer is a
separate small step; it must pass the raw body bytes (Shopify signs
the raw body), return 401 on verification failure, and 200 with the
summary dict on success. It must never trigger fulfilment or any
other store action.
