"""Tool registrations for the Geo/Atlas plugin.

All tools are SAFE and read-only against the local atlas
(``data/geo.sqlite``). The only network calls are the two explicitly
free ones — Open-Meteo weather and Nominatim geocoding — and both are
cached (weather 10 min in memory, geocoding forever in SQLite), so a
chat turn never hammers a free service. Nothing here writes to the
atlas, spends money, or needs a key.

When the store has not been seeded yet (``python scripts/seed_geo.py``
was never run), every tool answers with an honest
``{ok: false, seeded: false}`` instead of crashing or inventing data.
"""
from __future__ import annotations

import json

from ...core.permissions import Permission
from ..base import PluginInfo, tool
from .geocode import geocode as _geocode
from .store import GeoStore, valid_coords
from .weather import fetch_current_weather

_UNSEEDED = {
    "ok": False,
    "seeded": False,
    "error": "geo store is empty — run: python scripts/seed_geo.py "
             "(downloads free Natural Earth + country data, no key)",
}


def _store(cfg) -> GeoStore:
    return GeoStore(cfg.abs_path("data/geo.sqlite"))


def _json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


def register(registry):
    cfg = registry.cfg
    toggle = cfg.plugins.get("geo")
    if toggle is not None and not toggle.enabled:
        return

    @tool(
        name="geo_search_city",
        description=(
            "Search the local atlas for cities by name (any country). "
            "Biggest cities first. Read-only, offline."
        ),
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "q": {"type": "string"},
            "country": {"type": "string",
                        "description": "ISO alpha-2 country code, e.g. IR"},
            "limit": {"type": "integer", "default": 10},
        }},
    )
    def geo_search_city(q: str, country: str | None = None,
                        limit: int = 10) -> str:
        store = _store(cfg)
        if not store.is_seeded():
            return _json(_UNSEEDED)
        cities = store.search_cities(q, country=country, limit=limit)
        return _json({"ok": True, "seeded": True, "count": len(cities),
                      "cities": cities})

    @tool(
        name="geo_city_info",
        description=(
            "Full info for one city: coordinates, population, country "
            "(capital, area, languages, currencies) and, when asked, "
            "current weather. Read-only."
        ),
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "name": {"type": "string"},
            "country": {"type": "string",
                        "description": "ISO alpha-2 country code, e.g. IR"},
            "weather": {"type": "boolean", "default": False,
                        "description": "Include live weather (Open-Meteo, free)"},
        }},
    )
    def geo_city_info(name: str, country: str | None = None,
                      weather: bool = False) -> str:
        store = _store(cfg)
        if not store.is_seeded():
            return _json(_UNSEEDED)
        city = store.city_info(name, country=country)
        if city is None:
            return _json({"ok": False, "seeded": True,
                          "error": f"city not found: {name!r}"})
        payload: dict = {"ok": True, "seeded": True, "city": city}
        if weather:
            payload["weather"] = fetch_current_weather(
                city["lat"], city["lon"])
        return _json(payload)

    @tool(
        name="geo_country_info",
        description=(
            "Full info for one country by ISO code (IR, IRN) or name: "
            "capital, population, area, languages, currencies, flag, "
            "region. Read-only, offline."
        ),
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "code_or_name": {"type": "string"},
        }},
    )
    def geo_country_info(code_or_name: str) -> str:
        store = _store(cfg)
        if not store.is_seeded():
            return _json(_UNSEEDED)
        country = store.country_info(code_or_name)
        if country is None:
            return _json({"ok": False, "seeded": True,
                          "error": f"country not found: {code_or_name!r}"})
        return _json({"ok": True, "seeded": True, "country": country})

    @tool(
        name="geo_nearby_cities",
        description=(
            "Cities within a radius (km) of a coordinate, nearest first. "
            "Read-only, offline."
        ),
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "lat": {"type": "number"},
            "lon": {"type": "number"},
            "radius_km": {"type": "number", "default": 100},
            "limit": {"type": "integer", "default": 10},
        }},
    )
    def geo_nearby_cities(lat: float, lon: float, radius_km: float = 100,
                          limit: int = 10) -> str:
        store = _store(cfg)
        if not store.is_seeded():
            return _json(_UNSEEDED)
        try:
            cities = store.nearby_cities(lat, lon, radius_km, limit)
        except ValueError as e:
            return _json({"ok": False, "seeded": True, "error": str(e)})
        return _json({"ok": True, "seeded": True, "count": len(cities),
                      "cities": cities})

    @tool(
        name="geo_weather",
        description=(
            "Current weather for a city name or a coordinate "
            "(Open-Meteo, free, no key). Read-only."
        ),
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "city": {"type": "string"},
            "lat": {"type": "number"},
            "lon": {"type": "number"},
        }},
    )
    def geo_weather(city: str | None = None, lat=None, lon=None) -> str:
        store = _store(cfg)
        if city:
            if not store.is_seeded():
                return _json(_UNSEEDED)
            info = store.city_info(city)
            if info is None:
                return _json({"ok": False, "seeded": True,
                              "error": f"city not found: {city!r}"})
            lat, lon = info["lat"], info["lon"]
            place = info["name"]
        elif valid_coords(lat, lon):
            place = f"{lat},{lon}"
        else:
            return _json({"ok": False,
                          "error": "geo_weather needs a city name or lat+lon"})
        result = fetch_current_weather(float(lat), float(lon))
        return _json({"ok": result.get("ok", False), "place": place,
                      **{k: v for k, v in result.items() if k != "ok"}})

    @tool(
        name="geo_geocode",
        description=(
            "Geocode a free-text address via Nominatim (OpenStreetMap, "
            "free, no key). Results are cached locally, live calls are "
            "throttled to 1/second. Read-only."
        ),
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "query": {"type": "string"},
        }},
    )
    def geo_geocode(query: str) -> str:
        return _json(_geocode(query, _store(cfg)))

    @tool(
        name="geo_summary",
        description=(
            "Atlas status: how many countries and cities are stored, "
            "whether it was seeded, and which free sources were used. "
            "Read-only, offline."
        ),
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {}},
    )
    def geo_summary() -> str:
        return _json(_store(cfg).summary())

    registry.add_pending("geo")
    registry.register_plugin(PluginInfo(
        name="geo",
        description="Geo/Atlas: all countries + cities from free sources "
                    "(Natural Earth, world-countries), weather (Open-Meteo), "
                    "geocoding (Nominatim) — read-only, no keys.",
        permissions_needed=[Permission.SAFE],
    ))
