"""Integration test routes.

``POST /api/integrations/test/{type}`` probes one integration and
returns a structured ``{ok, type, configured, ...}`` result; ``GET
/api/integrations`` lists the supported types with their configured
flag (no network call). Supported types: ``youtube``, ``shopify``,
``bounty``.

What each probe does (never more):

* ``youtube`` — config/key presence only, no network: OAuth client
  id/secret from the environment (``YOUTUBE_CLIENT_ID`` /
  ``YOUTUBE_CLIENT_SECRET``) or ``cfg.integrations.youtube``, plus the
  stored token at ``data/youtube_token.json`` (same file the OAuth
  flow writes). ``ok`` requires both configured *and* authorized.
* ``shopify`` — key presence, then a short (5 s) read-only
  ``GET /admin/api/2024-01/shop.json`` against the configured shop
  domain with ``SHOPIFY_ACCESS_TOKEN``. No orders, charges, or writes.
* ``bounty`` — key presence, then a short (5 s) read-only
  ``GET /v1/me`` against api.hackerone.com with
  ``HACKERONE_USERNAME`` / ``HACKERONE_TOKEN`` (HTTP Basic).

Secrets are NEVER returned in a response and NEVER logged: only
booleans (``configured`` / ``authorized``) and safe detail strings
(shop name, HackerOne username from the API response) leave the
server. The HTTP helper is a module-level function so tests can
monkeypatch it — no real network in tests.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ...plugins.youtube.oauth import TokenStore
from .common import _services

log = logging.getLogger("jarvis.server.routes.integrations")

router = APIRouter()

SUPPORTED_TYPES = ("youtube", "shopify", "bounty")
_HTTP_TIMEOUT = 5.0


def _http_get_json(url: str, headers: dict | None = None,
                   auth: tuple[str, str] | None = None,
                   timeout: float = _HTTP_TIMEOUT) -> tuple[int, dict]:
    """GET ``url`` and parse a JSON body. Returns ``(status, data)``.

    Raises ``TimeoutError`` / ``OSError`` on transport failure. Auth
    credentials are passed only in the request header and are never
    logged or included in any exception message.
    """
    req_headers = dict(headers or {})
    if auth is not None:
        raw = f"{auth[0]}:{auth[1]}".encode("utf-8")
        req_headers["Authorization"] = (
            "Basic " + base64.b64encode(raw).decode("ascii"))
    req = urllib.request.Request(url, headers=req_headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            try:
                data = json.loads(body.decode("utf-8", errors="replace"))
            except ValueError:
                data = {}
            return resp.status, data if isinstance(data, dict) else {}
    except urllib.error.HTTPError as e:
        try:
            data = json.loads(e.read().decode("utf-8", errors="replace"))
        except Exception:  # noqa: BLE001
            data = {}
        return e.code, data if isinstance(data, dict) else {}
    except TimeoutError as e:
        raise TimeoutError(f"timed out after {timeout:g}s") from e


def _fail(type_name: str, error: str, **extra) -> dict:
    out = {"ok": False, "type": type_name, "configured": False,
           "error": error}
    out.update(extra)
    return out


# ---------------------------------------------------------------- youtube

def _youtube_status(cfg) -> dict:
    """Presence-only check: OAuth client + stored token. No network."""
    yt = getattr(getattr(cfg, "integrations", None), "youtube", None)
    client_id = (os.environ.get("YOUTUBE_CLIENT_ID", "").strip()
                 or getattr(yt, "client_id", "") or "")
    client_secret = (os.environ.get("YOUTUBE_CLIENT_SECRET", "").strip()
                     or getattr(yt, "client_secret", "") or "")
    configured = bool(client_id and client_secret)
    token = None
    try:
        token = TokenStore(cfg.abs_path("data/youtube_token.json")).load()
    except Exception:  # noqa: BLE001 — unreadable token file = not authorized
        token = None
    authorized = bool(token and token.get("refresh_token"))
    return {"configured": configured, "authorized": authorized,
            "has_token": bool(token)}


def _test_youtube(cfg) -> dict:
    st = _youtube_status(cfg)
    if not st["configured"]:
        return _fail("youtube", "YouTube OAuth is not configured: set "
                     "YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET",
                     authorized=False)
    if not st["authorized"]:
        return _fail("youtube", "YouTube is configured but not authorized: "
                     "complete the OAuth flow at /api/youtube/oauth/start",
                     configured=True, authorized=False)
    return {"ok": True, "type": "youtube", "configured": True,
            "authorized": True,
            "detail": "OAuth token stored; channel calls are authorized"}


# ---------------------------------------------------------------- shopify

def _shopify_creds() -> tuple[str, str]:
    domain = os.environ.get("SHOPIFY_SHOP_DOMAIN", "").strip()
    token = os.environ.get("SHOPIFY_ACCESS_TOKEN", "").strip()
    if "://" in domain:
        domain = urllib.parse.urlparse(domain).netloc
    return domain, token


def _test_shopify(cfg) -> dict:
    domain, token = _shopify_creds()
    if not domain or not token:
        return _fail("shopify", "Shopify API is not configured: set "
                     "SHOPIFY_SHOP_DOMAIN and SHOPIFY_ACCESS_TOKEN",
                     configured=False)
    url = f"https://{domain}/admin/api/2024-01/shop.json"
    try:
        status, data = _http_get_json(
            url, headers={"X-Shopify-Access-Token": token})
    except TimeoutError as e:
        return _fail("shopify", str(e), configured=True)
    except OSError as e:
        return _fail("shopify", f"network error: {e}", configured=True)
    if status == 200:
        shop = data.get("shop") or {}
        name = shop.get("name") or domain
        return {"ok": True, "type": "shopify", "configured": True,
                "detail": f"connected to shop {name!r}"}
    if status == 401:
        return _fail("shopify", "Shopify rejected the credentials (401): "
                     "check SHOPIFY_ACCESS_TOKEN", configured=True)
    return _fail("shopify", f"Shopify returned HTTP {status}",
                 configured=True)


# ----------------------------------------------------------------- bounty

def _test_bounty(cfg) -> dict:
    username = os.environ.get("HACKERONE_USERNAME", "").strip()
    token = os.environ.get("HACKERONE_TOKEN", "").strip()
    if not username or not token:
        return _fail("bounty", "Bounty API is not configured: set "
                     "HACKERONE_USERNAME and HACKERONE_TOKEN",
                     configured=False)
    try:
        status, data = _http_get_json(
            "https://api.hackerone.com/v1/me", auth=(username, token))
    except TimeoutError as e:
        return _fail("bounty", str(e), configured=True)
    except OSError as e:
        return _fail("bounty", f"network error: {e}", configured=True)
    if status == 200:
        who = ((data.get("data") or {}).get("attributes") or {}).get("username")
        return {"ok": True, "type": "bounty", "configured": True,
                "detail": f"authenticated as {who or username!r} on HackerOne"}
    if status == 401:
        return _fail("bounty", "HackerOne rejected the credentials (401): "
                     "check HACKERONE_TOKEN", configured=True)
    return _fail("bounty", f"HackerOne returned HTTP {status}",
                 configured=True)


_TESTERS = {
    "youtube": _test_youtube,
    "shopify": _test_shopify,
    "bounty": _test_bounty,
}


def _configured_flag(cfg, type_name: str) -> bool:
    if type_name == "youtube":
        return _youtube_status(cfg)["configured"]
    if type_name == "shopify":
        domain, token = _shopify_creds()
        return bool(domain and token)
    if type_name == "bounty":
        return bool(os.environ.get("HACKERONE_USERNAME")
                    and os.environ.get("HACKERONE_TOKEN"))
    return False


@router.get("/integrations")
async def integrations_list(request: Request):
    cfg, *_ = _services(request)
    return {
        "ok": True,
        "integrations": [
            {"type": t, "configured": _configured_flag(cfg, t)}
            for t in SUPPORTED_TYPES
        ],
    }


@router.post("/integrations/test/{type_name}")
async def integrations_test(request: Request, type_name: str):
    cfg, *_ = _services(request)
    tester = _TESTERS.get(type_name)
    if tester is None:
        return JSONResponse(
            status_code=404,
            content={"ok": False, "type": type_name,
                     "error": f"unknown integration type: {type_name!r}",
                     "supported": list(SUPPORTED_TYPES)},
        )
    try:
        return tester(cfg)
    except Exception as e:  # noqa: BLE001 — a probe must never 500
        log.warning("integration test %s failed: %s", type_name, e)
        return {"ok": False, "type": type_name, "configured": False,
                "error": f"probe failed: {e}"}
