"""Geo/Atlas routes: the atlas over HTTP for the globe + HUD.

Read-only. Every endpoint reads the local SQLite store
(``data/geo.sqlite``) — no key, no paid service. Only the weather and
geocode endpoints touch the network, and only the free ones
(Open-Meteo, Nominatim), with the same caching as the tools.

When the store was never seeded (``python scripts/seed_geo.py``), the
endpoints answer ``{ok: false, seeded: false}`` with HTTP 200 — the
globe treats that as "fall back to the built-in 69 cities" instead of
erroring out.
"""
from __future__ import annotations

from fastapi import APIRouter, Request

from ...plugins.geo.geocode import geocode as _geocode
from ...plugins.geo.store import GeoStore, valid_coords
from ...plugins.geo.weather import fetch_current_weather
from .common import _services

router = APIRouter()

_UNSEEDED = {
    "ok": False,
    "seeded": False,
    "error": "geo store is empty — run: python scripts/seed_geo.py",
}


def _store(request: Request) -> GeoStore:
    cfg, *_ = _services(request)
    return GeoStore(cfg.abs_path("data/geo.sqlite"))


def _parse_bbox(raw: str | None):
    """'min_lon,min_lat,max_lon,max_lat' → tuple or None (bad input → None)."""
    if not raw:
        return None
    try:
        parts = [float(x) for x in raw.split(",")]
        if len(parts) != 4:
            return None
        min_lon, min_lat, max_lon, max_lat = parts
    except ValueError:
        return None
    if not (valid_coords(min_lat, min_lon) and valid_coords(max_lat, max_lon)):
        return None
    return (min_lon, min_lat, max_lon, max_lat)


@router.get("/geo/summary")
async def geo_summary(request: Request):
    return _store(request).summary()


@router.get("/geo/countries")
async def geo_countries(request: Request, region: str | None = None,
                        limit: int = 300):
    store = _store(request)
    if not store.is_seeded():
        return _UNSEEDED
    countries = store.list_countries(region=region, limit=limit)
    return {"ok": True, "seeded": True, "count": len(countries),
            "countries": countries}


@router.get("/geo/country/{code}")
async def geo_country(request: Request, code: str):
    store = _store(request)
    if not store.is_seeded():
        return _UNSEEDED
    country = store.country_info(code)
    if country is None:
        return {"ok": False, "seeded": True,
                "error": f"country not found: {code!r}"}
    return {"ok": True, "seeded": True, "country": country}


@router.get("/geo/cities")
async def geo_cities(request: Request, q: str | None = None,
                     country: str | None = None, limit: int = 50,
                     min_population: int = 0, bbox: str | None = None):
    """Search cities (``q``) or list the biggest ones (no ``q``).

    The globe calls this with ``min_population`` + ``limit`` (and
    optionally ``bbox``) so it only ever renders the cities that fit on
    screen; the full 7k+ set stays searchable through ``q``.
    """
    store = _store(request)
    if not store.is_seeded():
        return _UNSEEDED
    parsed_bbox = _parse_bbox(bbox)
    if q:
        cities = store.search_cities(q, country=country, limit=limit,
                                     min_population=min_population)
    else:
        cities = store.top_cities(limit=limit,
                                  min_population=min_population,
                                  bbox=parsed_bbox)
    return {"ok": True, "seeded": True, "count": len(cities),
            "cities": cities}


@router.get("/geo/city/{name}")
async def geo_city(request: Request, name: str, country: str | None = None,
                   weather: int = 0):
    store = _store(request)
    if not store.is_seeded():
        return _UNSEEDED
    city = store.city_info(name, country=country)
    if city is None:
        return {"ok": False, "seeded": True,
                "error": f"city not found: {name!r}"}
    payload: dict = {"ok": True, "seeded": True, "city": city}
    if weather:
        payload["weather"] = fetch_current_weather(city["lat"], city["lon"])
    return payload


@router.get("/geo/nearby")
async def geo_nearby(request: Request, lat: float, lon: float,
                     radius_km: float = 100, limit: int = 10):
    store = _store(request)
    if not store.is_seeded():
        return _UNSEEDED
    try:
        cities = store.nearby_cities(lat, lon, radius_km, limit)
    except ValueError as e:
        return {"ok": False, "seeded": True, "error": str(e)}
    return {"ok": True, "seeded": True, "count": len(cities),
            "cities": cities}


@router.get("/geo/weather")
async def geo_weather(request: Request, city: str | None = None,
                      lat: float | None = None, lon: float | None = None):
    store = _store(request)
    if city:
        if not store.is_seeded():
            return _UNSEEDED
        info = store.city_info(city)
        if info is None:
            return {"ok": False, "seeded": True,
                    "error": f"city not found: {city!r}"}
        lat, lon = info["lat"], info["lon"]
        place = info["name"]
    elif valid_coords(lat, lon):
        place = f"{lat},{lon}"
    else:
        return {"ok": False,
                "error": "geo_weather needs a city name or lat+lon"}
    result = fetch_current_weather(float(lat), float(lon))  # type: ignore[arg-type]
    return {"ok": result.get("ok", False), "place": place,
            **{k: v for k, v in result.items() if k != "ok"}}


@router.get("/geo/geocode")
async def geo_geocode(request: Request, q: str):
    return _geocode(q, _store(request))
