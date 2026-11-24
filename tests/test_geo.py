"""Geo/Atlas tests — no network, no keys, no live server.

Covers the dataset parsers (Natural Earth places + world-countries),
the chunked/resumable seeder, the SQLite store (search, city/country
info, nearby, top-cities + bbox), the weather + geocode clients with
stubbed HTTP, the tools, the HTTP route handlers (in-process
TestClient), and plugin discovery. Live Open-Meteo / Nominatim calls
are never made here — the seeder's real downloads are verified by
hand, not by this suite.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarvis.plugins.geo.loaders import (  # noqa: E402
    parse_countries,
    parse_places,
    seed_store,
)
from jarvis.plugins.geo.store import GeoStore, haversine_km, valid_coords  # noqa: E402

# ---- tiny fixtures (same shapes as the real datasets) ---------------------

COUNTRIES_FIXTURE = [
    {
        "name": {"common": "Iran", "official": "Islamic Republic of Iran"},
        "cca2": "IR", "cca3": "IRN", "independent": True,
        "capital": ["Tehran"], "region": "Asia", "subregion": "Southern Asia",
        "population": 88550563, "area": 1648195.0,
        "languages": {"fas": "Persian"},
        "currencies": {"IRR": {"name": "Iranian rial", "symbol": "﷼"}},
        "flag": "🇮🇷", "latlng": [32.0, 53.0],
    },
    {
        "name": {"common": "Iraq", "official": "Republic of Iraq"},
        "cca2": "IQ", "cca3": "IRQ", "independent": True,
        "capital": ["Baghdad"], "region": "Asia", "subregion": "Western Asia",
        "population": 43896205, "area": 438317.0,
        "languages": {"ara": "Arabic"},
        "currencies": {"IQD": {"name": "Iraqi dinar", "symbol": "ع.د"}},
        "flag": "🇮🇶", "latlng": [33.0, 44.0],
    },
    {
        "name": {"common": "France", "official": "French Republic"},
        "cca2": "FR", "cca3": "FRA", "independent": True,
        "capital": ["Paris"], "region": "Europe", "subregion": "Western Europe",
        "population": 68172590, "area": 551695.0,
        "languages": {"fra": "French"},
        "currencies": {"EUR": {"name": "Euro", "symbol": "€"}},
        "flag": "🇫🇷", "latlng": [46.0, 2.0],
    },
    {
        "name": {"common": "United States", "official": "United States of America"},
        "cca2": "US", "cca3": "USA", "independent": True,
        "capital": ["Washington, D.C."], "region": "Americas",
        "subregion": "North America",
        "population": 334914895, "area": 9372610.0,
        "languages": {"eng": "English"},
        "currencies": {"USD": {"name": "United States dollar", "symbol": "$"}},
        "flag": "🇺🇸", "latlng": [38.0, -97.0],
    },
]


def _place(name, name_ascii, a3, a2, lat, lon, pop, feature="Populated place",
           admin=""):
    return {
        "type": "Feature",
        "properties": {
            "NAME": name, "NAMEASCII": name_ascii, "ADM0NAME": admin,
            "ADM0_A3": a3, "ISO_A2": a2, "POP_MAX": pop,
            "FEATURECLA": feature, "TIMEZONE": "Asia/Tehran",
        },
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
    }


PLACES_FIXTURE = {
    "type": "FeatureCollection",
    "features": [
        _place("Tehran", "Tehran", "IRN", "IR", 35.7, 51.4, 8693700,
               "Admin-0 capital", "Iran"),
        _place("Karaj", "Karaj", "IRN", "IR", 35.84, 50.94, 1592492,
               "Populated place", "Iran"),
        _place("Baghdad", "Baghdad", "IRQ", "IQ", 33.31, 44.36, 7212160,
               "Admin-0 capital", "Iraq"),
        _place("Paris", "Paris", "FRA", "FR", 48.86, 2.35, 2148000,
               "Admin-0 capital", "France"),
        # ISO_A2 is "-99" here on purpose: the A3→A2 map must resolve it.
        _place("Lyon", "Lyon", "FRA", "-99", 45.76, 4.84, 515695,
               "Populated place", "France"),
        _place("Paris", "Paris", "USA", "US", 33.66, -95.56, 25171,
               "Populated place", "United States"),
        _place("Reykjavik", "Reykjavik", "ISL", "-99", 64.15, -21.94, 131136,
               "Admin-0 capital", "Iceland"),
    ],
}


class _FakeCfg:
    def __init__(self, root: Path):
        self._root = root
        self.plugins = {}

    def abs_path(self, p):
        return self._root / p


def _seeded(tmp_path) -> GeoStore:
    store = GeoStore(tmp_path / "data" / "geo.sqlite")
    result = seed_store(store, COUNTRIES_FIXTURE, PLACES_FIXTURE)
    assert result["ok"] is True
    return store


# ---- parsers ----

def test_parse_countries_shape():
    rows = parse_countries(COUNTRIES_FIXTURE)
    assert len(rows) == 4
    iran = next(r for r in rows if r["code"] == "IR")
    assert iran["name"] == "Iran"
    assert iran["official_name"] == "Islamic Republic of Iran"
    assert iran["capital"] == "Tehran"
    assert iran["population"] == 88550563
    assert iran["languages"] == ["Persian"]
    assert iran["currencies"] == [
        {"code": "IRR", "name": "Iranian rial", "symbol": "﷼"}]
    assert iran["flag"] == "🇮🇷"
    assert iran["lat"] == 32.0 and iran["lon"] == 53.0


def test_flag_emoji_derived_when_missing():
    from jarvis.plugins.geo.loaders import flag_emoji

    assert flag_emoji("ir") == "🇮🇷"
    assert flag_emoji("US") == "🇺🇸"
    assert flag_emoji("") == ""
    assert flag_emoji("X") == ""


def test_parse_places_a3_to_a2_and_capitals():
    rows = parse_places(PLACES_FIXTURE, {"FRA": "FR", "IRN": "IR",
                                         "IRQ": "IQ", "USA": "US"})
    by_name = {r["name"]: r for r in rows}
    assert len(rows) == 7
    assert by_name["Tehran"]["country_code"] == "IR"
    assert by_name["Tehran"]["is_capital"] == 1
    assert by_name["Tehran"]["population"] == 8693700
    assert by_name["Karaj"]["is_capital"] == 0
    # Lyon's ISO_A2 was "-99": the A3 map must have resolved it to FR.
    assert by_name["Lyon"]["country_code"] == "FR"
    # Unknown A3 with no map entry keeps the A3 code, row is not dropped.
    assert by_name["Reykjavik"]["country_code"] == "ISL"


def test_parse_places_skips_bad_rows():
    bad = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"NAME": ""},
         "geometry": {"type": "Point", "coordinates": [0, 0]}},
        {"type": "Feature", "properties": {"NAME": "Nowhere"},
         "geometry": {"type": "Point", "coordinates": [500, 500]}},
        {"type": "Feature", "properties": {"NAME": "Good"},
         "geometry": {"type": "Point", "coordinates": [10, 20]}},
    ]}
    rows = parse_places(bad, {})
    assert [r["name"] for r in rows] == ["Good"]


# ---- seeder / store ----

def test_seed_counts_and_resumable(tmp_path):
    store = GeoStore(tmp_path / "data" / "geo.sqlite")
    first = seed_store(store, COUNTRIES_FIXTURE, PLACES_FIXTURE)
    assert first["countries"] == 4 and first["cities"] == 7
    assert store.is_seeded() is True
    # Re-running must not duplicate anything.
    second = seed_store(store, COUNTRIES_FIXTURE, PLACES_FIXTURE)
    assert second["countries"] == 4 and second["cities"] == 7
    assert store.counts()["seeded_at"] is not None


def test_empty_store_is_not_seeded(tmp_path):
    store = GeoStore(tmp_path / "data" / "geo.sqlite")
    assert store.is_seeded() is False
    assert store.summary()["seeded"] is False
    assert store.search_cities("tehran") == []
    assert store.city_info("Tehran") is None


def test_search_cities_case_insensitive_and_ranked(tmp_path):
    store = _seeded(tmp_path)
    results = store.search_cities("paris")
    # Exact-name Paris (France, 2.1M) before Paris, Texas (25k).
    assert [r["name"] for r in results] == ["Paris", "Paris"]
    assert results[0]["country_code"] == "FR"
    assert results[1]["country_code"] == "US"
    assert store.search_cities("TEHRAN")[0]["name"] == "Tehran"
    assert store.search_cities("ehr")[0]["name"] == "Tehran"
    assert store.search_cities("xyz-no-such-city") == []


def test_search_cities_country_and_population_filters(tmp_path):
    store = _seeded(tmp_path)
    assert [r["country_code"] for r in store.search_cities("paris", country="US")] == ["US"]
    assert store.search_cities("paris", min_population=1_000_000) != []
    assert store.search_cities("paris", min_population=3_000_000) == []


def test_city_info_exact_and_country_disambiguation(tmp_path):
    store = _seeded(tmp_path)
    tehran = store.city_info("Tehran")
    assert tehran["lat"] == 35.7 and tehran["lon"] == 51.4
    assert tehran["is_capital"] is True
    assert tehran["country"]["name"] == "Iran"
    assert tehran["country"]["capital"] == "Tehran"
    assert tehran["country"]["languages"] == ["Persian"]
    # Two cities named Paris — the country filter picks the right one.
    assert store.city_info("Paris", country="US")["country_code"] == "US"
    assert store.city_info("Paris", country="FR")["country_code"] == "FR"
    # Prefix fallback when there is no exact match.
    assert store.city_info("Teh")["name"] == "Tehran"
    assert store.city_info("No Such City") is None


def test_country_info_by_code_and_name(tmp_path):
    store = _seeded(tmp_path)
    assert store.country_info("ir")["name"] == "Iran"
    assert store.country_info("IRN")["name"] == "Iran"
    assert store.country_info("france")["code"] == "FR"
    assert store.country_info("ZZ") is None
    countries = store.list_countries()
    assert len(countries) == 4
    assert [c["name"] for c in store.list_countries(region="Asia")] == [
        "Iran", "Iraq"]


def test_top_cities_limit_population_bbox(tmp_path):
    store = _seeded(tmp_path)
    top = store.top_cities(limit=3)
    assert [c["name"] for c in top] == ["Tehran", "Baghdad", "Paris"]
    big = store.top_cities(min_population=5_000_000)
    assert {c["name"] for c in big} == {"Tehran", "Baghdad"}
    # Bbox around Tehran/Karaj only.
    near_tehran = store.top_cities(bbox=(50.0, 35.0, 52.0, 36.5))
    assert {c["name"] for c in near_tehran} == {"Tehran", "Karaj"}
    assert store.top_cities(bbox=(0.0, 0.0, 1.0, 1.0)) == []


def test_nearby_cities_distance_order(tmp_path):
    store = _seeded(tmp_path)
    near = store.nearby_cities(35.7, 51.4, radius_km=100)
    assert [c["name"] for c in near] == ["Tehran", "Karaj"]
    assert near[0]["distance_km"] == 0.0
    # Karaj is ~40 km from Tehran.
    assert 30 < near[1]["distance_km"] < 60
    assert store.nearby_cities(35.7, 51.4, radius_km=10) == [
        c for c in near if c["name"] == "Tehran"]
    with pytest.raises(ValueError, match="lat"):
        store.nearby_cities(100, 0)
    with pytest.raises(ValueError, match="radius"):
        store.nearby_cities(35.7, 51.4, radius_km=0)


def test_valid_coords_and_haversine():
    assert valid_coords(35.7, 51.4) is True
    assert valid_coords(91, 0) is False
    assert valid_coords("x", 0) is False
    # Tehran–Karaj ≈ 43 km; Tehran–Baghdad ≈ 700 km.
    assert 40 < haversine_km(35.7, 51.4, 35.84, 50.94) < 50
    assert 650 < haversine_km(35.7, 51.4, 33.31, 44.36) < 750


# ---- weather (stubbed HTTP) ----

def _weather_stub(url, timeout=10):
    assert "api.open-meteo.com" in url
    assert "latitude=35.7" in url
    payload = {
        "timezone": "Asia/Tehran",
        "current": {
            "time": "2026-11-24T06:15",
            "temperature_2m": 9.8,
            "weather_code": 0,
            "wind_speed_10m": 7.0,
            "relative_humidity_2m": 47,
        },
    }
    return json.dumps(payload)


def test_weather_stub_and_cache(monkeypatch):
    from jarvis.plugins.geo import weather as w

    calls = {"n": 0}

    def counting(url, timeout=10):
        calls["n"] += 1
        return _weather_stub(url, timeout)

    w.clear_weather_cache()
    first = w.fetch_current_weather(35.7, 51.4, http_get=counting)
    assert first["ok"] is True
    assert first["temperature_c"] == 9.8
    assert first["weather"] == "clear sky"
    assert first["wind_kmh"] == 7.0
    assert first["humidity_pct"] == 47
    # Second call is served from the 10-minute cache: no second request.
    second = w.fetch_current_weather(35.7, 51.4, http_get=counting)
    assert second == first and calls["n"] == 1
    assert w.fetch_current_weather(100, 0)["ok"] is False
    assert w.fetch_current_weather(35.7, 51.4,
                                   http_get=lambda u, t: (_ for _ in ()).throw(
                                       RuntimeError("down")))["ok"] is True  # cached
    w.clear_weather_cache()
    assert w.fetch_current_weather(
        35.7, 51.4,
        http_get=lambda u, t: (_ for _ in ()).throw(
            RuntimeError("down")))["ok"] is False


# ---- geocode (stubbed HTTP + cache) ----

def test_geocode_cache_first_then_live_once(tmp_path):
    from jarvis.plugins.geo.geocode import geocode

    store = GeoStore(tmp_path / "data" / "geo.sqlite")
    calls = {"n": 0}

    def stub(url, timeout=10):
        calls["n"] += 1
        assert "nominatim.openstreetmap.org" in url
        return json.dumps([{
            "lat": "35.6892523", "lon": "51.3896004",
            "display_name": "Tehran, Iran",
        }])

    no_sleep = lambda s: None  # noqa: E731
    first = geocode("Tehran", store, http_get=stub, sleep=no_sleep)
    assert first["ok"] is True
    assert abs(first["lat"] - 35.689) < 0.01
    assert first["cached"] is False
    # Second call hits the SQLite cache — the stub is not called again.
    second = geocode("Tehran", store, http_get=stub, sleep=no_sleep)
    assert second["cached"] is True and calls["n"] == 1
    assert geocode("", store)["ok"] is False
    assert geocode("Nowhere At All", store,
                   http_get=lambda u, t: "[]",
                   sleep=no_sleep)["ok"] is False


# ---- tools + discovery ----

def _registered_registry(tmp_path):
    from jarvis.plugins.geo.tools import register
    from jarvis.plugins.registry import PluginRegistry

    registry = PluginRegistry(_FakeCfg(tmp_path))
    register(registry)
    return registry


def test_tools_registered_safe_and_work(tmp_path):
    _seeded(tmp_path)
    registry = _registered_registry(tmp_path)
    for name in ("geo_search_city", "geo_city_info", "geo_country_info",
                 "geo_nearby_cities", "geo_weather", "geo_geocode",
                 "geo_summary"):
        tool = registry.get(name)
        assert tool is not None, name
        assert tool.permission.name == "SAFE", name
    found = json.loads(registry.get("geo_search_city").handler("paris"))
    assert found["ok"] is True and found["count"] == 2
    city = json.loads(registry.get("geo_city_info").handler("Tehran"))
    assert city["ok"] is True
    assert city["city"]["country"]["name"] == "Iran"
    country = json.loads(registry.get("geo_country_info").handler("IR"))
    assert country["country"]["capital"] == "Tehran"
    near = json.loads(registry.get("geo_nearby_cities").handler(35.7, 51.4))
    assert [c["name"] for c in near["cities"]] == ["Tehran", "Karaj"]
    summary = json.loads(registry.get("geo_summary").handler())
    assert summary["countries"] == 4 and summary["cities"] == 7


def test_tools_unseeded_answer_honestly(tmp_path):
    registry = _registered_registry(tmp_path)
    payload = json.loads(registry.get("geo_search_city").handler("Tehran"))
    assert payload["ok"] is False and payload["seeded"] is False
    assert "seed_geo.py" in payload["error"]


def test_geo_weather_tool_uses_store_then_stub(monkeypatch, tmp_path):
    from jarvis.plugins.geo import tools as geo_tools

    _seeded(tmp_path)
    monkeypatch.setattr(
        geo_tools, "fetch_current_weather",
        lambda lat, lon: {"ok": True, "temperature_c": 9.8,
                          "weather": "clear sky"})
    registry = _registered_registry(tmp_path)
    out = json.loads(registry.get("geo_weather").handler(city="Tehran"))
    assert out["ok"] is True and out["temperature_c"] == 9.8
    assert out["place"] == "Tehran"
    bad = json.loads(registry.get("geo_weather").handler(city="Nope"))
    assert bad["ok"] is False
    nocoords = json.loads(registry.get("geo_weather").handler())
    assert nocoords["ok"] is False


def test_load_all_discovers_geo(tmp_path):
    from jarvis.plugins.registry import PluginRegistry

    registry = PluginRegistry(_FakeCfg(tmp_path))
    registry.load_all()
    assert "geo" in [p.name for p in registry.plugins()]
    assert registry.get("geo_search_city") is not None


# ---- HTTP routes (in-process TestClient, no server) ----

def _client(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from jarvis.server.routes import router

    app = FastAPI()
    app.state.cfg = _FakeCfg(tmp_path)
    app.state.orchestrator = None
    app.state.registry = None
    app.state.memory = None
    app.state.agents = None
    app.include_router(router, prefix="/api")
    return TestClient(app)


def test_geo_routes_serve(tmp_path, monkeypatch):
    from jarvis.plugins.geo import weather as w

    _seeded(tmp_path)
    # Pre-cache a geocode result so the route needs no network.
    store = GeoStore(tmp_path / "data" / "geo.sqlite")
    store.cache_geocode("eiffel tower", 48.8584, 2.2945, "Eiffel Tower, Paris")
    monkeypatch.setattr(
        w, "fetch_current_weather",
        lambda lat, lon: {"ok": True, "temperature_c": 12.0,
                          "weather": "partly cloudy"})
    # The routes module imported its own reference — patch it too.
    import jarvis.server.routes.geo as geo_routes

    monkeypatch.setattr(
        geo_routes, "fetch_current_weather",
        lambda lat, lon: {"ok": True, "temperature_c": 12.0,
                          "weather": "partly cloudy"})

    with _client(tmp_path) as client:
        summary = client.get("/api/geo/summary")
        assert summary.status_code == 200
        assert summary.json()["cities"] == 7

        cities = client.get("/api/geo/cities", params={"q": "paris"})
        assert cities.status_code == 200
        assert cities.json()["count"] == 2

        top = client.get("/api/geo/cities",
                         params={"min_population": 5000000})
        assert {c["name"] for c in top.json()["cities"]} == {
            "Tehran", "Baghdad"}

        city = client.get("/api/geo/city/Tehran", params={"weather": 1})
        assert city.status_code == 200
        assert city.json()["city"]["country"]["code"] == "IR"
        assert city.json()["weather"]["temperature_c"] == 12.0

        missing = client.get("/api/geo/city/Nowhere")
        assert missing.json()["ok"] is False

        country = client.get("/api/geo/country/IR")
        assert country.json()["country"]["capital"] == "Tehran"

        countries = client.get("/api/geo/countries",
                               params={"region": "Asia"})
        assert [c["code"] for c in countries.json()["countries"]] == [
            "IR", "IQ"]

        nearby = client.get("/api/geo/nearby",
                            params={"lat": 35.7, "lon": 51.4,
                                    "radius_km": 100})
        assert [c["name"] for c in nearby.json()["cities"]] == [
            "Tehran", "Karaj"]

        weather = client.get("/api/geo/weather",
                             params={"city": "Tehran"})
        assert weather.json()["temperature_c"] == 12.0

        geo = client.get("/api/geo/geocode", params={"q": "eiffel tower"})
        assert geo.json()["ok"] is True
        assert geo.json()["cached"] is True

        bad_bbox = client.get("/api/geo/cities",
                              params={"bbox": "not-a-bbox"})
        assert bad_bbox.status_code == 200  # bad bbox is ignored, not fatal


def test_geo_routes_unseeded(tmp_path):
    GeoStore(tmp_path / "data" / "geo.sqlite")
    with _client(tmp_path) as client:
        r = client.get("/api/geo/summary")
        assert r.json()["seeded"] is False
        r = client.get("/api/geo/cities", params={"q": "paris"})
        assert r.json()["ok"] is False and r.json()["seeded"] is False
