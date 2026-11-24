"""Dataset parsers + chunked seeder for the atlas store.

Sources (all free, no key, no account):

1. **Natural Earth** — ``ne_10m_populated_places`` GeoJSON, public
   domain. ~7,300 populated places: name, coordinates, population,
   country, capital flags. This is the backbone for "all cities".
2. **world-countries** (``mledoze/countries``, ODbL 1.0) — a static
   JSON mirror of the classic REST Countries dataset: 250 countries
   with capital, population, area, languages, currencies, flag,
   region/subregion. REST Countries' own v1–v4 API was taken down and
   v5 now requires an account + API key, so the seeder uses this
   static mirror of the *same data* instead — still free, still no key.

Seeding is chunked (``executemany`` in batches) and resumable: rows are
inserted with ``INSERT OR REPLACE`` / ``INSERT OR IGNORE``, so
re-running the seeder after an interruption just continues where it
stopped instead of duplicating or wiping anything.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from .store import GeoStore

NATURAL_EARTH_PLACES_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_10m_populated_places.geojson"
)
COUNTRIES_URL = (
    "https://raw.githubusercontent.com/mledoze/countries/master/countries.json"
)

COUNTRIES_SOURCE = "mledoze/countries (ODbL 1.0) — static REST Countries data"
PLACES_SOURCE = "Natural Earth ne_10m_populated_places (public domain)"

# Natural Earth feature classes that count as a national capital.
_CAPITAL_FEATURES = {"Admin-0 capital", "Admin-0 capital alt"}

CHUNK_SIZE = 500


def flag_emoji(cca2: str) -> str:
    """Flag emoji derived from an ISO alpha-2 code — no download needed."""
    code = (cca2 or "").strip().upper()
    if len(code) != 2 or not code.isalpha():
        return ""
    return "".join(chr(0x1F1E6 + ord(ch) - ord("A")) for ch in code)


def parse_countries(raw: list[dict]) -> list[dict]:
    """Normalise the world-countries JSON shape into store rows."""
    out = []
    for item in raw or []:
        name = item.get("name") or {}
        capital = item.get("capital") or []
        latlng = item.get("latlng") or []
        languages = item.get("languages") or {}
        currencies = item.get("currencies") or {}
        code = (item.get("cca2") or "").strip().upper()
        if not code:
            continue
        out.append({
            "code": code,
            "code3": (item.get("cca3") or "").strip().upper(),
            "name": name.get("common") or "",
            "official_name": name.get("official") or "",
            "capital": capital[0] if capital else "",
            "region": item.get("region") or "",
            "subregion": item.get("subregion") or "",
            "population": item.get("population"),
            "area": item.get("area"),
            "languages": sorted(set(languages.values())),
            "currencies": [
                {"code": k, "name": v.get("name", ""),
                 "symbol": v.get("symbol", "")}
                for k, v in sorted(currencies.items())
            ],
            "flag": item.get("flag") or flag_emoji(code),
            "lat": latlng[0] if len(latlng) > 0 else None,
            "lon": latlng[1] if len(latlng) > 1 else None,
            "independent": 1 if item.get("independent") else 0,
        })
    return out


def parse_places(geojson: dict, cca3_to_cca2: dict[str, str] | None = None
                 ) -> list[dict]:
    """Normalise Natural Earth populated places into store rows.

    Natural Earth carries the alpha-3 country code (``ADM0_A3``) and an
    alpha-2 (``ISO_A2``) that is ``-99`` for places whose country has no
    ISO code in the file (e.g. Kosovo, Somaliland). The alpha-3 → alpha-2
    map from the countries dataset resolves most of those; the rest keep
    their alpha-3 code so the row is never dropped.
    """
    cca3_to_cca2 = cca3_to_cca2 or {}
    out = []
    for feature in (geojson or {}).get("features") or []:
        props = feature.get("properties") or {}
        geom = feature.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            continue
        lon, lat = coords[0], coords[1]
        try:
            lat = float(lat)
            lon = float(lon)
        except (TypeError, ValueError):
            continue
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
            continue
        name = (props.get("NAME") or "").strip()
        if not name:
            continue
        name_ascii = (props.get("NAMEASCII") or name).strip()
        a3 = (props.get("ADM0_A3") or "").strip().upper()
        a2 = (props.get("ISO_A2") or "").strip().upper()
        if len(a2) != 2 or a2 == "-99":
            a2 = cca3_to_cca2.get(a3, a3)
        pop = props.get("POP_MAX")
        try:
            pop = int(pop) if pop is not None else None
        except (TypeError, ValueError):
            pop = None
        out.append({
            "name": name,
            "name_ascii": name_ascii,
            "country_code": a2,
            "country_name": (props.get("ADM0NAME") or "").strip(),
            "lat": lat,
            "lon": lon,
            "population": pop,
            "is_capital": 1 if props.get("FEATURECLA") in _CAPITAL_FEATURES else 0,
            "timezone": (props.get("TIMEZONE") or "").strip(),
            "feature": (props.get("FEATURECLA") or "").strip(),
        })
    return out


def _insert_countries(store: GeoStore, countries: list[dict],
                      progress=None) -> int:
    sql = (
        "INSERT INTO countries(code, code3, name, official_name, capital, "
        "region, subregion, population, area, languages, currencies, flag, "
        "lat, lon, independent, source, updated_at) "
        "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(code) DO UPDATE SET code3=excluded.code3, "
        "name=excluded.name, official_name=excluded.official_name, "
        "capital=excluded.capital, region=excluded.region, "
        "subregion=excluded.subregion, population=excluded.population, "
        "area=excluded.area, languages=excluded.languages, "
        "currencies=excluded.currencies, flag=excluded.flag, "
        "lat=excluded.lat, lon=excluded.lon, "
        "independent=excluded.independent, source=excluded.source, "
        "updated_at=excluded.updated_at"
    )
    now = time.time()
    done = 0
    with store._conn() as c:
        for i in range(0, len(countries), CHUNK_SIZE):
            chunk = countries[i:i + CHUNK_SIZE]
            c.executemany(sql, [(
                row["code"], row["code3"], row["name"], row["official_name"],
                row["capital"], row["region"], row["subregion"],
                row["population"], row["area"],
                json.dumps(row["languages"], ensure_ascii=False),
                json.dumps(row["currencies"], ensure_ascii=False),
                row["flag"], row["lat"], row["lon"], row["independent"],
                COUNTRIES_SOURCE, now,
            ) for row in chunk])
            done += len(chunk)
            if progress:
                progress("countries", done, len(countries))
    return done


def _insert_cities(store: GeoStore, cities: list[dict], progress=None) -> int:
    sql = (
        "INSERT OR IGNORE INTO cities(name, name_ascii, country_code, "
        "country_name, lat, lon, population, is_capital, timezone, feature, "
        "source) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    done = 0
    with store._conn() as c:
        for i in range(0, len(cities), CHUNK_SIZE):
            chunk = cities[i:i + CHUNK_SIZE]
            c.executemany(sql, [(
                row["name"], row["name_ascii"], row["country_code"],
                row["country_name"], row["lat"], row["lon"],
                row["population"], row["is_capital"], row["timezone"],
                row["feature"], PLACES_SOURCE,
            ) for row in chunk])
            done += len(chunk)
            if progress:
                progress("cities", done, len(cities))
    return done


def seed_store(store: GeoStore, countries_raw: list[dict],
               places_geojson: dict, progress=None) -> dict:
    """Parse both datasets and write them into ``store`` (chunked).

    Returns the counts. Safe to re-run: countries upsert, cities ignore
    duplicates, meta is rewritten at the end.
    """
    countries = parse_countries(countries_raw)
    cca3_to_cca2 = {c["code3"]: c["code"] for c in countries if c["code3"]}
    cities = parse_places(places_geojson, cca3_to_cca2)
    n_countries = _insert_countries(store, countries, progress)
    n_cities = _insert_cities(store, cities, progress)
    store.set_meta("seeded_at", str(time.time()))
    store.set_meta("sources", f"{COUNTRIES_SOURCE} | {PLACES_SOURCE}")
    store.set_meta("countries_url", COUNTRIES_URL)
    store.set_meta("places_url", NATURAL_EARTH_PLACES_URL)
    return {
        "ok": True,
        "countries_parsed": len(countries),
        "cities_parsed": len(cities),
        "countries_written": n_countries,
        "cities_written": n_cities,
        **store.counts(),
    }


def load_json_file(path: str | Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)
