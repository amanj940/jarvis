"""Local atlas store (SQLite).

``GeoStore`` is the read-mostly database behind the Jarvis map system:
every country and every city the globe can show, seeded once from free
public datasets (see ``loaders.py`` / ``scripts/seed_geo.py``) and then
read locally — no API key, no network at query time, tiny on disk.

Tables
------
``countries`` — one row per country (ISO 3166-1 alpha-2 key): name,
official name, capital, region/subregion, population, area, languages
and currencies (JSON), flag emoji, centroid, independence flag.

``cities`` — one row per populated place from Natural Earth
(``ne_10m_populated_places``): name, ASCII name for searching, country
code + name, coordinates, population, capital flag, timezone, feature
class. ~7,300 rows, ~1–2 MB on disk.

``meta`` — seeding provenance: source names/URLs, row counts, time.

``geocode_cache`` — Nominatim results, so an address is only ever
looked up on the network once (see ``geocode.py``).

The store never calls the network itself. All queries are local SQLite;
weather and geocoding live in their own modules and are only used when
a caller explicitly asks for them.
"""
from __future__ import annotations

import json
import math
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS countries (
    code TEXT PRIMARY KEY,
    code3 TEXT,
    name TEXT NOT NULL,
    official_name TEXT,
    capital TEXT,
    region TEXT,
    subregion TEXT,
    population INTEGER,
    area REAL,
    languages TEXT,
    currencies TEXT,
    flag TEXT,
    lat REAL,
    lon REAL,
    independent INTEGER NOT NULL DEFAULT 0,
    source TEXT,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS cities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_ascii TEXT NOT NULL,
    country_code TEXT NOT NULL,
    country_name TEXT,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    population INTEGER,
    is_capital INTEGER NOT NULL DEFAULT 0,
    timezone TEXT,
    feature TEXT,
    source TEXT,
    UNIQUE(name, country_code, lat, lon)
);
CREATE INDEX IF NOT EXISTS idx_cities_name ON cities(name_ascii);
CREATE INDEX IF NOT EXISTS idx_cities_country ON cities(country_code, population DESC);
CREATE INDEX IF NOT EXISTS idx_cities_pop ON cities(population DESC);
CREATE INDEX IF NOT EXISTS idx_cities_latlon ON cities(lat, lon);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS geocode_cache (
    query TEXT PRIMARY KEY,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    display_name TEXT,
    fetched_at REAL NOT NULL
);
"""

# Hard caps so a chat/HTTP caller can never ask for the whole table.
MAX_SEARCH_LIMIT = 100
MAX_TOP_LIMIT = 1000
DEFAULT_SEARCH_LIMIT = 20


def valid_coords(lat, lon) -> bool:
    """True when lat/lon are numbers inside the valid ranges."""
    try:
        lat = float(lat)
        lon = float(lon)
    except (TypeError, ValueError):
        return False
    return -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres between two points."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = (math.sin(dphi / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2)
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _clamp_limit(limit, default: int, maximum: int) -> int:
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        return default
    return max(1, min(limit, maximum))


class GeoStore:
    """SQLite atlas: countries + cities + seeding meta + geocode cache."""

    def __init__(self, db_path: str | Path):
        self.path = Path(db_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # ---- meta / seeding state -------------------------------------------
    def set_meta(self, key: str, value: str) -> None:
        with self._conn() as c:
            c.execute(
                "INSERT INTO meta(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )

    def get_meta(self, key: str, default: str | None = None) -> str | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default

    def is_seeded(self) -> bool:
        """True once the seeder has written at least one country + city."""
        return self.counts()["cities"] > 0 and self.counts()["countries"] > 0

    def counts(self) -> dict:
        with self._conn() as c:
            countries = c.execute("SELECT COUNT(*) FROM countries").fetchone()[0]
            cities = c.execute("SELECT COUNT(*) FROM cities").fetchone()[0]
        return {
            "countries": int(countries),
            "cities": int(cities),
            "seeded_at": self.get_meta("seeded_at"),
            "sources": self.get_meta("sources"),
        }

    def summary(self) -> dict:
        """Counts + sources for tools/routes. Always succeeds, even empty."""
        data = self.counts()
        return {
            "ok": True,
            "seeded": data["cities"] > 0 and data["countries"] > 0,
            **data,
        }

    # ---- countries --------------------------------------------------------
    @staticmethod
    def _country_row(row: sqlite3.Row) -> dict:
        return {
            "code": row["code"],
            "code3": row["code3"],
            "name": row["name"],
            "official_name": row["official_name"],
            "capital": row["capital"],
            "region": row["region"],
            "subregion": row["subregion"],
            "population": row["population"],
            "area": row["area"],
            "languages": json.loads(row["languages"] or "[]"),
            "currencies": json.loads(row["currencies"] or "[]"),
            "flag": row["flag"],
            "lat": row["lat"],
            "lon": row["lon"],
            "independent": bool(row["independent"]),
        }

    def country_info(self, code_or_name: str) -> dict | None:
        """One country by ISO alpha-2/alpha-3 code or by (partial) name."""
        key = (code_or_name or "").strip()
        if not key:
            return None
        with self._conn() as c:
            row = c.execute(
                "SELECT * FROM countries WHERE code=? COLLATE NOCASE "
                "OR code3=? COLLATE NOCASE",
                (key, key),
            ).fetchone()
            if row is None:
                row = c.execute(
                    "SELECT * FROM countries WHERE name LIKE ? COLLATE NOCASE "
                    "ORDER BY population DESC LIMIT 1",
                    (f"%{key}%",),
                ).fetchone()
        return self._country_row(row) if row else None

    def list_countries(self, region: str | None = None,
                       limit: int = 300) -> list[dict]:
        limit = _clamp_limit(limit, 300, 300)
        with self._conn() as c:
            if region:
                rows = c.execute(
                    "SELECT * FROM countries WHERE region=? COLLATE NOCASE "
                    "ORDER BY name",
                    (region.strip(),),
                ).fetchall()
            else:
                rows = c.execute(
                    "SELECT * FROM countries ORDER BY name").fetchall()
        return [self._country_row(r) for r in rows[:limit]]

    # ---- cities -----------------------------------------------------------
    @staticmethod
    def _city_row(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "country_code": row["country_code"],
            "country_name": row["country_name"],
            "lat": row["lat"],
            "lon": row["lon"],
            "population": row["population"],
            "is_capital": bool(row["is_capital"]),
            "timezone": row["timezone"],
            "feature": row["feature"],
        }

    def search_cities(self, q: str, country: str | None = None,
                      limit: int = DEFAULT_SEARCH_LIMIT,
                      min_population: int = 0) -> list[dict]:
        """Cities matching a name fragment, biggest first.

        Exact matches sort first, then prefix matches, then anything
        containing the text — so "Tehran" finds Tehran before any
        smaller place that merely contains those letters.
        """
        q = (q or "").strip().lower()
        if not q:
            return []
        limit = _clamp_limit(limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT)
        try:
            min_population = max(0, int(min_population))
        except (TypeError, ValueError):
            min_population = 0
        params: list = [q, f"{q}%"]
        where = ("(name_ascii LIKE ? OR name LIKE ?) "
                 "AND COALESCE(population, 0) >= ?")
        args: list = [f"%{q}%", f"%{q}%", min_population]
        if country:
            where += " AND country_code=? COLLATE NOCASE"
            args.append(country.strip())
        with self._conn() as c:
            rows = c.execute(
                f"SELECT * FROM cities WHERE {where} "
                "ORDER BY CASE WHEN name_ascii=? THEN 0 "
                "WHEN name_ascii LIKE ? THEN 1 ELSE 2 END, "
                "population DESC LIMIT ?",
                (*args, *params, limit),
            ).fetchall()
        return [self._city_row(r) for r in rows]

    def city_info(self, name: str, country: str | None = None) -> dict | None:
        """One city by exact name (case-insensitive), else best prefix match.

        Returns the city plus its country row (when the country is in the
        store), so callers get capital/population/area/languages in one call.
        """
        name = (name or "").strip()
        if not name:
            return None
        with self._conn() as c:
            row = None
            if country:
                row = c.execute(
                    "SELECT * FROM cities WHERE name_ascii=? COLLATE NOCASE "
                    "AND country_code=? COLLATE NOCASE "
                    "ORDER BY population DESC LIMIT 1",
                    (name.lower(), country.strip()),
                ).fetchone()
            if row is None:
                row = c.execute(
                    "SELECT * FROM cities WHERE name_ascii=? COLLATE NOCASE "
                    "ORDER BY population DESC LIMIT 1",
                    (name.lower(),),
                ).fetchone()
            if row is None:
                args: list = [f"{name.lower()}%"]
                where = "name_ascii LIKE ? COLLATE NOCASE"
                if country:
                    where += " AND country_code=? COLLATE NOCASE"
                    args.append(country.strip())
                row = c.execute(
                    f"SELECT * FROM cities WHERE {where} "
                    "ORDER BY population DESC LIMIT 1",
                    args,
                ).fetchone()
        if row is None:
            return None
        city = self._city_row(row)
        city["country"] = self.country_info(city["country_code"])
        return city

    def top_cities(self, limit: int = 200, min_population: int = 0,
                   bbox: tuple[float, float, float, float] | None = None
                   ) -> list[dict]:
        """Biggest cities first — what the globe renders.

        ``bbox`` is (min_lon, min_lat, max_lon, max_lat); it lets the
        globe ask only for the cities in the visible hemisphere later.
        """
        limit = _clamp_limit(limit, 200, MAX_TOP_LIMIT)
        try:
            min_population = max(0, int(min_population))
        except (TypeError, ValueError):
            min_population = 0
        where = "COALESCE(population, 0) >= ?"
        args: list = [min_population]
        if bbox is not None:
            min_lon, min_lat, max_lon, max_lat = bbox
            where += " AND lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?"
            args += [min_lon, max_lon, min_lat, max_lat]
        with self._conn() as c:
            rows = c.execute(
                f"SELECT * FROM cities WHERE {where} "
                "ORDER BY population DESC LIMIT ?",
                (*args, limit),
            ).fetchall()
        return [self._city_row(r) for r in rows]

    def nearby_cities(self, lat: float, lon: float, radius_km: float = 100,
                      limit: int = 10) -> list[dict]:
        """Cities within ``radius_km`` of a point, nearest first."""
        if not valid_coords(lat, lon):
            raise ValueError("lat must be -90..90 and lon -180..180")
        try:
            radius_km = float(radius_km)
        except (TypeError, ValueError):
            raise ValueError("radius_km must be a number")
        if radius_km <= 0 or radius_km > 20000:
            raise ValueError("radius_km must be 0..20000")
        limit = _clamp_limit(limit, 10, MAX_SEARCH_LIMIT)
        lat = float(lat)
        lon = float(lon)
        # Bounding-box pre-filter in SQL, exact haversine in Python —
        # cheap even on the full 7k-city table.
        d_lat = radius_km / 111.0
        d_lon = radius_km / max(1.0, 111.0 * abs(math.cos(math.radians(lat))))
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM cities WHERE lat BETWEEN ? AND ? "
                "AND lon BETWEEN ? AND ?",
                (lat - d_lat, lat + d_lat, lon - d_lon, lon + d_lon),
            ).fetchall()
        scored = []
        for row in rows:
            city = self._city_row(row)
            city["distance_km"] = round(
                haversine_km(lat, lon, city["lat"], city["lon"]), 1)
            if city["distance_km"] <= radius_km:
                scored.append(city)
        scored.sort(key=lambda x: x["distance_km"])
        return scored[:limit]

    # ---- geocode cache ------------------------------------------------------
    def geocode_cached(self, query: str) -> dict | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT lat, lon, display_name FROM geocode_cache "
                "WHERE query=?",
                ((query or "").strip().lower(),),
            ).fetchone()
        if row is None:
            return None
        return {"lat": row["lat"], "lon": row["lon"],
                "display_name": row["display_name"], "cached": True}

    def cache_geocode(self, query: str, lat: float, lon: float,
                      display_name: str = "") -> None:
        with self._conn() as c:
            c.execute(
                "INSERT INTO geocode_cache(query, lat, lon, display_name, "
                "fetched_at) VALUES(?, ?, ?, ?, ?) "
                "ON CONFLICT(query) DO UPDATE SET lat=excluded.lat, "
                "lon=excluded.lon, display_name=excluded.display_name, "
                "fetched_at=excluded.fetched_at",
                ((query or "").strip().lower(), float(lat), float(lon),
                 display_name or "", time.time()),
            )
