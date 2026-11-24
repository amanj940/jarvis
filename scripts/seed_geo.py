#!/usr/bin/env python3
"""Seed the Jarvis atlas store (data/geo.sqlite) — one-time setup.

    python scripts/seed_geo.py

Downloads two free datasets (no key, no account) and builds the local
SQLite atlas the globe, the geo tools and the /api/geo routes read:

* Natural Earth ``ne_10m_populated_places`` GeoJSON (public domain)
  — ~7,300 populated places: name, coordinates, population, country,
  capital flags. (~19 MB download)
* world-countries JSON (``mledoze/countries``, ODbL 1.0) — 250
  countries: capital, population, area, languages, currencies, flag,
  region/subregion. (~1.4 MB download)

  (This is a static mirror of the classic REST Countries dataset.
  REST Countries' own v1–v4 API was taken down and v5 now needs an
  account + API key, so the seeder uses the mirror instead — still
  free, still no key.)

Downloads go to ``data/geo-seed/`` first and are reused on re-runs
(resumable: a failed run just continues). The store itself is written
in 500-row chunks; re-running is safe — countries upsert, cities
ignore duplicates. The downloaded raw files are gitignored; only the
SQLite store lives on the machine (``data/`` is gitignored too).

Usage
-----
    python scripts/seed_geo.py [--db data/geo.sqlite]
                               [--countries-file FILE] [--places-file FILE]
                               [--no-download] [--force]

``--no-download`` seeds from already-downloaded files in
``data/geo-seed/`` (offline re-seed). ``--force`` re-downloads even
when the files are already present.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarvis.plugins.geo.loaders import (  # noqa: E402
    COUNTRIES_URL,
    NATURAL_EARTH_PLACES_URL,
    load_json_file,
    seed_store,
)
from jarvis.plugins.geo.store import GeoStore  # noqa: E402

USER_AGENT = "JarvisGeo/1.0 (local-first assistant; free dataset download)"
CHUNK_SIZE = 1024 * 1024
# Sanity hints only (upstream may republish): a mismatch warns, never fails.
MIN_PLACES_BYTES = 1_000_000
MIN_COUNTRIES_BYTES = 100_000


class SeedError(RuntimeError):
    """Raised when the atlas cannot be downloaded or seeded."""


def download(url: str, dest: Path, force: bool = False) -> Path:
    """Download ``url`` to ``dest`` (temp file + move; skips if present)."""
    if dest.exists() and not force:
        print(f"  reuse {dest} ({dest.stat().st_size:,} bytes)")
        return dest
    print(f"  downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp, \
                open(tmp, "wb") as f:
            while True:
                chunk = resp.read(CHUNK_SIZE)
                if not chunk:
                    break
                f.write(chunk)
    except urllib.error.URLError as e:
        tmp.unlink(missing_ok=True)
        raise SeedError(f"download failed for {url}: {e}") from e
    tmp.replace(dest)
    print(f"  saved {dest} ({dest.stat().st_size:,} bytes)")
    return dest


def _progress(kind: str, done: int, total: int) -> None:
    if done % 1000 == 0 or done == total:
        print(f"  {kind}: {done:,}/{total:,}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default="data/geo.sqlite",
                        help="SQLite atlas path (default: data/geo.sqlite)")
    parser.add_argument("--seed-dir", default="data/geo-seed",
                        help="Where raw downloads are kept")
    parser.add_argument("--countries-file", default=None,
                        help="Use a local countries JSON instead of downloading")
    parser.add_argument("--places-file", default=None,
                        help="Use a local Natural Earth GeoJSON instead of downloading")
    parser.add_argument("--no-download", action="store_true",
                        help="Seed from files already in --seed-dir (offline)")
    parser.add_argument("--force", action="store_true",
                        help="Re-download even when files are already present")
    args = parser.parse_args(argv)

    root = Path(__file__).resolve().parents[1]
    seed_dir = (root / args.seed_dir) if not Path(args.seed_dir).is_absolute() \
        else Path(args.seed_dir)
    seed_dir.mkdir(parents=True, exist_ok=True)
    db_path = (root / args.db) if not Path(args.db).is_absolute() \
        else Path(args.db)

    countries_path = Path(args.countries_file) if args.countries_file \
        else seed_dir / "countries.json"
    places_path = Path(args.places_file) if args.places_file \
        else seed_dir / "ne_10m_populated_places.geojson"

    try:
        if args.no_download:
            for p in (countries_path, places_path):
                if not p.exists():
                    raise SeedError(
                        f"{p} not found — run without --no-download once "
                        "to fetch the free datasets")
        else:
            download(COUNTRIES_URL, countries_path, force=args.force)
            download(NATURAL_EARTH_PLACES_URL, places_path, force=args.force)

        if countries_path.stat().st_size < MIN_COUNTRIES_BYTES:
            print(f"  WARNING: {countries_path} looks small "
                  f"({countries_path.stat().st_size:,} bytes) — continuing anyway")
        if places_path.stat().st_size < MIN_PLACES_BYTES:
            print(f"  WARNING: {places_path} looks small "
                  f"({places_path.stat().st_size:,} bytes) — continuing anyway")

        print("  parsing datasets…")
        countries_raw = load_json_file(countries_path)
        places_geojson = load_json_file(places_path)
        if not isinstance(countries_raw, list) or not countries_raw:
            raise SeedError(f"{countries_path} did not parse as a country list")
        if not isinstance(places_geojson, dict) \
                or not places_geojson.get("features"):
            raise SeedError(f"{places_path} did not parse as GeoJSON places")

        print(f"  seeding {db_path} …")
        store = GeoStore(db_path)
        result = seed_store(store, countries_raw, places_geojson,
                            progress=_progress)
    except SeedError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as e:
        print(f"ERROR: downloaded file is not valid JSON: {e}",
              file=sys.stderr)
        return 1

    print("done.")
    print(f"  countries: {result['countries']:,} "
          f"(parsed {result['countries_parsed']:,})")
    print(f"  cities:    {result['cities']:,} "
          f"(parsed {result['cities_parsed']:,})")
    print(f"  store: {db_path}")
    print("  restart the backend, then open the globe — city markers now "
          "come from the atlas.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
