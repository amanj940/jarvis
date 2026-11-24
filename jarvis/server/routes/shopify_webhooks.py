"""Shopify webhook HTTP route — receive-and-record ONLY.

Exposes ``POST /webhooks/shopify`` (mounted under ``/api`` by
:mod:`jarvis.server.routes`, so the public path is
``POST /api/webhooks/shopify``). All verification and cache work is done
by :mod:`jarvis.plugins.ecommerce.webhooks` — this module only adapts
HTTP to that helper, following the same ``_services`` /
``cfg.abs_path("data/...")`` pattern as the geo routes:

* missing/invalid/tampered ``X-Shopify-Hmac-Sha256`` signature → 401
* ``SHOPIFY_WEBHOOK_SECRET`` not configured → 503 (fail closed: an
  unverifiable webhook is refused, never accepted)
* unknown topic / malformed payload → 400
* valid ``orders/create``, ``orders/updated`` or ``products/update``
  payload → upserted into the local ``EcommerceStore`` cache
  (``data/ecommerce.db``), 200

Deliberately no fulfilment, order placement, charges, refunds,
payouts, or customer contact — a webhook is an inbound notification,
not an instruction. No network calls are made here.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ...plugins.ecommerce.store import EcommerceStore
from ...plugins.ecommerce.webhooks import (
    WebhookNotConfigured,
    WebhookPayloadError,
    WebhookVerificationError,
    handle_webhook,
)
from .common import _services

log = logging.getLogger("jarvis.server.routes.shopify_webhooks")

router = APIRouter()


def _store(request: Request) -> EcommerceStore:
    """Local ecommerce cache, resolved through the app config."""
    cfg, *_ = _services(request)
    return EcommerceStore(cfg.abs_path("data/ecommerce.db"))


@router.post("/webhooks/shopify")
async def shopify_webhook(request: Request) -> JSONResponse:
    """Receive a Shopify webhook, verify it, and cache the change."""
    raw_body = await request.body()
    topic = request.headers.get("X-Shopify-Topic", "")
    signature = request.headers.get("X-Shopify-Hmac-Sha256")
    shop = request.headers.get("X-Shopify-Shop-Domain", "")
    try:
        result = handle_webhook(
            raw_body, topic, signature, _store(request), shop=shop
        )
    except WebhookNotConfigured as exc:
        # Fail closed: without a secret nothing can be verified.
        log.warning("shopify webhook refused: secret not configured")
        return JSONResponse(status_code=503, content={"detail": str(exc)})
    except WebhookVerificationError:
        log.warning("shopify webhook refused: bad or missing signature")
        return JSONResponse(
            status_code=401,
            content={"detail": "invalid or missing webhook signature"},
        )
    except WebhookPayloadError as exc:
        log.warning("shopify webhook refused: %s", exc)
        return JSONResponse(status_code=400, content={"detail": str(exc)})
    log.info(
        "shopify webhook %s cached: %s id=%s",
        result["topic"], result["kind"], result["remote_id"],
    )
    return JSONResponse(status_code=200, content=result)
