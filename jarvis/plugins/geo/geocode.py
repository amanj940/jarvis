"""Geocoding via Nominatim (OpenStreetMap) — free, no key.

Nominatim's usage policy asks for at most 1 request per second and a
descriptive User-Agent, so this module:

- checks the local ``geocode_cache`` table first (an address is only
  ever looked up on the network once),
- throttles live calls to one per second (sleeps when needed),
- sends the required ``JarvisGeo/1.0`` User-Agent.

It is only used for free-text addresses a user types ("Eiffel Tower,
Paris"). City/country lookups never touch it — they read the local
SQLite atlas in ``store.py`` instead.

``http_get`` is injectable so tests can stub the network: it must take
``(url, timeout)`` and return an object with a ``read()`` method or a
``str``/``bytes`` body. ``sleep`` is injectable so tests never wait.
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request

from .store import GeoStore, valid_coords

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "JarvisGeo/1.0 (local-first assistant; free Nominatim use)"
TIMEOUT_S = 10
MIN_INTERVAL_S = 1.0

_last_call: float = 0.0


def _default_http_get(url: str, timeout: float = TIMEOUT_S):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(req, timeout=timeout)


def _read_body(resp) -> str:
    if isinstance(resp, (str, bytes)):
        return resp.decode("utf-8") if isinstance(resp, bytes) else resp
    data = resp.read()
    return data.decode("utf-8") if isinstance(data, bytes) else data


def geocode(query: str, store: GeoStore, http_get=None,
            sleep=time.sleep) -> dict:
    """Address → coordinates, cached. Never raises — errors are data."""
    global _last_call
    q = (query or "").strip()
    if not q:
        return {"ok": False, "error": "geocode needs a query"}
    cached = store.geocode_cached(q)
    if cached is not None:
        return {"ok": True, **cached}
    params = urllib.parse.urlencode(
        {"q": q, "format": "json", "limit": 1, "addressdetails": 0})
    url = f"{NOMINATIM_URL}?{params}"
    now = time.time()
    wait = MIN_INTERVAL_S - (now - _last_call)
    if wait > 0:
        sleep(wait)
    try:
        body = _read_body((http_get or _default_http_get)(url, TIMEOUT_S))
        _last_call = time.time()
        results = json.loads(body)
    except Exception as e:  # noqa: BLE001 — network failure is a normal outcome
        return {"ok": False, "error": f"geocode request failed: {e}"}
    if not results:
        return {"ok": False, "error": f"no result for {q!r}"}
    first = results[0]
    try:
        lat = float(first["lat"])
        lon = float(first["lon"])
    except (KeyError, TypeError, ValueError):
        return {"ok": False, "error": "geocoder returned bad coordinates"}
    if not valid_coords(lat, lon):
        return {"ok": False, "error": "geocoder returned bad coordinates"}
    display = str(first.get("display_name") or q)
    store.cache_geocode(q, lat, lon, display)
    return {"ok": True, "lat": lat, "lon": lon,
            "display_name": display, "cached": False}
