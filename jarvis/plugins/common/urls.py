"""Shared URL helpers — the ONE place URL normalisation lives.

Before this module, the same idea was implemented three different ways:

* ``jarvis.plugins.bounty.programs_sync.normalize_url`` — lowercase
  scheme+host, strip fragment + tracking params, strip trailing slash,
  ``""`` for junk, root path becomes ``""``.
* ``jarvis.plugins.opportunity.leads.normalize_url`` — same idea but
  root path becomes ``"/"``, query params are *sorted*, ``ref`` /
  ``referrer`` are also tracking params, and junk input passes through
  instead of returning ``""``. (``leads.py`` is owned by another worker;
  it has NOT been rewired yet — the follow-up is a one-line swap plus a
  decision on those three divergences, because ``url_hash`` values for
  root-path and junk URLs would change. See the note on
  :func:`normalize_url`.)
* ``jarvis.plugins.ecommerce.shopify.shop_url_from_env`` — a shop-domain
  normaliser (strip + lowercase only; a pasted ``https://`` scheme or
  trailing path used to break the API base URL). Now
  :func:`normalize_shop_domain`.

Every plugin that needs a canonical URL must import from here instead
of rolling its own copy.
"""
from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

# Query params that exist only for tracking — they never change what a
# page is, so they must not create a second dedup key for the same URL.
TRACKING_PARAMS = frozenset({
    "utm_source", "utm_medium", "utm_campaign", "utm_term",
    "utm_content", "fbclid", "gclid",
})


def normalize_url(url: str) -> str:
    """Normalize a URL for dedup: lowercase scheme+host, no fragment,
    no tracking params, no trailing slash. Returns ``""`` for junk.

    Semantics are exactly the ones ``bounty.programs_sync`` used (the
    behaviour its tests pin down): the root path normalises to ``""``
    (``https://example.com`` and ``https://example.com/`` are the same
    program page), surviving query params keep their original order,
    and the path keeps its case (``/Acme`` is not ``/acme`` — hosts are
    case-insensitive, paths are not). Tracking-param matching is
    case-insensitive (``UTM_SOURCE`` is still tracking).
    """
    if not url:
        return ""
    try:
        parsed = urlparse(url.strip())
    except ValueError:
        return ""
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""
    query = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
             if k.lower() not in TRACKING_PARAMS]
    path = parsed.path.rstrip("/") or ""
    return urlunparse((
        parsed.scheme.lower(),
        parsed.netloc.lower(),
        path,
        "",
        urlencode(query),
        "",
    ))


def normalize_shop_domain(value: str) -> str:
    """Normalize a Shopify shop domain from config/env.

    Strips whitespace, lowercases, and drops a pasted ``http(s)://``
    scheme plus any trailing path/query/fragment, so
    ``"https://MyStore.myshopify.com/"`` becomes
    ``"mystore.myshopify.com"``. A plain domain is unchanged apart from
    case and surrounding whitespace.
    """
    domain = (value or "").strip().lower()
    for prefix in ("https://", "http://"):
        if domain.startswith(prefix):
            domain = domain[len(prefix):]
            break
    for sep in ("/", "?", "#"):
        domain = domain.split(sep, 1)[0]
    return domain.strip()
