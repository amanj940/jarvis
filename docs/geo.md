# Geo/Atlas — a real map system for the Jarvis globe

All cities and all countries, from **free sources only — no paid API,
no API key, no account**. Data lives in a local SQLite store
(`data/geo.sqlite`, ~2 MB for 250 countries + 7,342 cities) built once
by `scripts/seed_geo.py`, then read offline. The globe loads its city
markers from `GET /api/geo/cities`; if the backend is down or the
store was never seeded, it falls back to the built-in 69 cities in
`web/src/components/Globe/cities.ts`.

## Sources (all free, no key)

| Data | Source | Licence | Notes |
| --- | --- | --- | --- |
| Cities (~7,342) | Natural Earth `ne_10m_populated_places` GeoJSON | Public domain | Name, coordinates, population, country, capital flags |
| Countries (250) | `mledoze/countries` `countries.json` (static mirror of the classic REST Countries dataset) | ODbL 1.0 | Capital, population, area, languages, currencies, flag, region/subregion |
| Weather (live) | Open-Meteo `api.open-meteo.com` | Free, no key | Current temperature / WMO code / wind / humidity; cached 10 min in memory |
| Geocoding (live) | Nominatim (OpenStreetMap) | ODbL 1.0 | Free-text address → coordinates; cached forever in SQLite; throttled to 1 req/s per the usage policy |

**Why not REST Countries directly?** Its v1–v4 API was taken down
and v5 now requires an account + API key — which breaks the "no keys"
rule. The seeder uses the static ODbL mirror of the *same dataset*
instead: same fields, no account, no key. If REST Countries ever
restores a keyless endpoint, the seeder can point back at it with a
one-line URL change (`COUNTRIES_URL` in
`jarvis/plugins/geo/loaders.py`).

## Try it

```bash
# One-time: download the two free datasets and build the store (~20 MB download, ~10 s)
python scripts/seed_geo.py
# → countries: 250, cities: 7,342, store: data/geo.sqlite (~2 MB)

# Restart the backend, then open the HUD.
# Raw downloads are kept in data/geo-seed/ and reused on re-runs;
# re-running the seeder is safe (countries upsert, cities ignore duplicates).
python scripts/seed_geo.py --no-download   # re-seed offline from data/geo-seed/
python scripts/seed_geo.py --force         # re-download even if files exist
```

From chat (all SAFE, read-only):

- `geo_search_city("Tehran")` / `geo_search_city("Paris", country="US")`
- `geo_city_info("Tehran", weather=True)` — city + country + live weather
- `geo_country_info("IR")` or `geo_country_info("France")`
- `geo_nearby_cities(lat=35.7, lon=51.4, radius_km=100)`
- `geo_weather(city="Tehran")` or `geo_weather(lat=…, lon=…)`
- `geo_geocode("Eiffel Tower, Paris")` — Nominatim, cached
- `geo_summary()` — counts + seeded state + sources

HTTP (same data, for the globe/HUD): `GET /api/geo/summary`,
`GET /api/geo/countries?region=&limit=`,
`GET /api/geo/cities?q=&country=&limit=&min_population=&bbox=`,
`GET /api/geo/city/<name>?country=&weather=1`,
`GET /api/geo/country/<code>`, `GET /api/geo/nearby?lat=&lon=&radius_km=`,
`GET /api/geo/weather?city=` (or `?lat=&lon=`),
`GET /api/geo/geocode?q=`. Unseeded, every endpoint answers
`{ok: false, seeded: false}` with HTTP 200 — the globe falls back
instead of erroring.

## What the globe shows

- **City dots** come from `GET /api/geo/cities?min_population=100000&limit=1200`
  — the ~1,200 biggest cities. Dots are cheap (one shared geometry);
  labels still appear only when zoomed in, only for the facing
  hemisphere (same hysteresis as before).
- **Click a city dot** → an info panel opens on the globe: name,
  country, population, capital flag, coordinates, and current weather
  (Open-Meteo, when online). Clicking a dot never toggles the mic
  (same stop-propagation guard as marker clicks).
- **Fallback:** if the fetch fails or the store is unseeded, the globe
  keeps the built-in 69 cities (`cities.ts`) — nothing disappears.

## Files

- `jarvis/plugins/geo/store.py` — `GeoStore` (SQLite): countries,
  cities, meta, geocode cache; search / nearby (haversine) / top /
  bbox queries.
- `jarvis/plugins/geo/loaders.py` — dataset parsers + chunked,
  resumable seeder; source URLs live here.
- `jarvis/plugins/geo/weather.py` — Open-Meteo client (10-min cache).
- `jarvis/plugins/geo/geocode.py` — Nominatim client (SQLite cache,
  1 req/s throttle).
- `jarvis/plugins/geo/tools.py` — the 7 `geo_*` tools (all SAFE).
- `jarvis/server/routes/geo.py` — the `/api/geo/*` endpoints.
- `scripts/seed_geo.py` — one-time seeder (chunked, resumable).
- `web/src/components/Globe/EarthGlobe.tsx` — city loading from the
  API + click info panel (the only globe file touched; the 69-city
  fallback in `cities.ts` is untouched).
- `tests/test_geo.py` — parsers, seeder, store, weather/geocode with
  stubbed HTTP, tools, routes, discovery. No network, no keys.

## Limits (deliberate, first slice)

- **Globe renders the top ~1,200 cities (pop ≥ 100k), not all 7,342.**
  All 7,342 are in the store and searchable via the API/tools — but
  7,342 dots + labels would clutter the globe and cost GPU time on a
  weak laptop. The `bbox` parameter on `/api/geo/cities` is there so a
  later slice can load cities per visible hemisphere instead.
- **No country polygons/borders on the globe.** Natural Earth ships
  admin-0 polygons, but drawing 250 country outlines as 3D geometry
  is a separate, heavier slice. Country info is available by clicking
  its cities, or via `geo_country_info` / `GET /api/geo/country/<code>`.
- **No live traffic, no routing, no satellite tiles.** The globe is a
  data globe, not a slippy map. Those need tile servers and are out of
  scope for this slice.
- **Weather/geocode need internet** (free endpoints). Offline, the
  atlas still answers everything except weather and uncached addresses
  — and says so honestly instead of inventing data.
- **Natural Earth populations are estimates** (`POP_MAX`, vintage
  ~2020s). Good enough for ranking and display; not census data.
- **A few places keep an alpha-3 country code** (e.g. Somaliland
  `SOL`) where no ISO alpha-2 exists. They are never dropped; their
  country name is always stored.

## Future ideas (not built here)

- Country polygons from Natural Earth `ne_10m_admin_0_countries` as a
  toggleable globe layer (borders on hover/click).
- Per-hemisphere city loading via the `bbox` parameter as you zoom.
- Public/open street cameras on the map (user's idea, 2026-11-24):
  only public sources, as a separate layer — needs a source survey
  first (which public camera directories allow embedding, and their
  terms).
