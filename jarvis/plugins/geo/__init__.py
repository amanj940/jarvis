"""Geo/Atlas plugin — a real map system for the Jarvis globe.

All countries and all cities from free sources only (no paid API, no
keys): Natural Earth populated places for cities, a static ODbL mirror
of the REST Countries dataset for countries, Open-Meteo for weather,
Nominatim for geocoding. Data lives in a local SQLite store
(``data/geo.sqlite``) built once by ``scripts/seed_geo.py``.
See docs/geo.md.
"""
from __future__ import annotations

from .geocode import geocode
from .loaders import parse_countries, parse_places, seed_store
from .store import GeoStore, haversine_km, valid_coords
from .tools import register
from .weather import fetch_current_weather

__all__ = [
    "GeoStore",
    "fetch_current_weather",
    "geocode",
    "haversine_km",
    "parse_countries",
    "parse_places",
    "register",
    "seed_store",
    "valid_coords",
]
