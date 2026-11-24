"""Curated location lookup for the intelligence layer — data only.

No network, no geocoding API, no keys. Coordinates come from two
hand-checked tables:

* ``CITY_COORDS`` — the same 69 capitals + megacities the globe already
  ships in ``web/src/components/Globe/cities.ts`` (so a city the globe
  can label is a city the intel layer can plot), plus a few extra tech
  hubs where bounty programs and startups actually live.
* ``COMPANY_HQ`` — headquarters of well-known companies/platforms, so a
  bug-bounty program named after its company ("Google", "HackerOne")
  can be plotted even though programs carry no location field.

Matching is a deliberately dumb heuristic: a city or company name
appearing as a whole word in the item's text. It will miss places we
do not know and can misfire on words like "Lima" used some other way;
that is documented in ``docs/intel.md`` and the resolver always says
*what* it matched, so a human can spot a bad pin.
"""
from __future__ import annotations

import re
import unicodedata

# lat, lon — same values as web/src/components/Globe/cities.ts.
CITY_COORDS: dict[str, tuple[float, float]] = {
    "tehran": (35.70, 51.40),
    "baghdad": (33.31, 44.36),
    "dubai": (25.20, 55.27),
    "abu dhabi": (24.45, 54.38),
    "doha": (25.29, 51.53),
    "riyadh": (24.71, 46.68),
    "jeddah": (21.49, 39.19),
    "cairo": (30.04, 31.24),
    "istanbul": (41.01, 28.98),
    "ankara": (39.93, 32.86),
    "beirut": (33.89, 35.50),
    "amman": (31.95, 35.93),
    "jerusalem": (31.77, 35.21),
    "kuwait city": (29.38, 47.98),
    "muscat": (23.59, 58.41),
    "london": (51.51, -0.13),
    "paris": (48.86, 2.35),
    "berlin": (52.52, 13.41),
    "madrid": (40.42, -3.70),
    "rome": (41.90, 12.50),
    "amsterdam": (52.37, 4.90),
    "brussels": (50.85, 4.35),
    "vienna": (48.21, 16.37),
    "warsaw": (52.23, 21.01),
    "moscow": (55.76, 37.62),
    "kyiv": (50.45, 30.52),
    "stockholm": (59.33, 18.07),
    "oslo": (59.91, 10.75),
    "copenhagen": (55.68, 12.57),
    "dublin": (53.35, -6.26),
    "lisbon": (38.72, -9.14),
    "athens": (37.98, 23.73),
    "new york": (40.71, -74.01),
    "los angeles": (34.05, -118.24),
    "chicago": (41.88, -87.63),
    "houston": (29.76, -95.37),
    "toronto": (43.65, -79.38),
    "vancouver": (49.28, -123.12),
    "mexico city": (19.43, -99.13),
    "sao paulo": (-23.55, -46.63),
    "rio de janeiro": (-22.91, -43.17),
    "buenos aires": (-34.60, -58.38),
    "lima": (-12.05, -77.04),
    "bogota": (4.71, -74.07),
    "santiago": (-33.45, -70.67),
    "lagos": (6.52, 3.38),
    "nairobi": (-1.29, 36.82),
    "johannesburg": (-26.20, 28.05),
    "casablanca": (33.57, -7.59),
    "algiers": (36.75, 3.06),
    "mumbai": (19.08, 72.88),
    "delhi": (28.61, 77.21),
    "karachi": (24.86, 67.01),
    "lahore": (31.55, 74.36),
    "dhaka": (23.81, 90.41),
    "bangkok": (13.76, 100.50),
    "singapore": (1.35, 103.82),
    "jakarta": (-6.21, 106.85),
    "kuala lumpur": (3.14, 101.69),
    "hong kong": (22.32, 114.17),
    "shanghai": (31.23, 121.47),
    "beijing": (39.90, 116.41),
    "tokyo": (35.68, 139.69),
    "seoul": (37.57, 126.98),
    "manila": (14.60, 120.98),
    "hanoi": (21.03, 105.85),
    "sydney": (-33.87, 151.21),
    "melbourne": (-37.81, 144.96),
    "auckland": (-36.85, 174.76),
    # Extra tech hubs (not in the globe's label set, but where the
    # programs and startups in our leads actually live).
    "san francisco": (37.77, -122.42),
    "seattle": (47.61, -122.33),
    "boston": (42.36, -71.06),
    "atlanta": (33.75, -84.39),
    "denver": (39.74, -104.99),
    "austin": (30.27, -97.74),
    "mountain view": (37.39, -122.08),
    "menlo park": (37.45, -122.18),
    "cupertino": (37.32, -122.03),
    "redmond": (47.67, -122.12),
    "san jose": (37.34, -121.89),
    "santa clara": (37.39, -121.96),
    "los gatos": (37.23, -121.96),
    "ottawa": (45.42, -75.70),
    "antwerp": (51.22, 4.40),
    "tel aviv": (32.09, 34.78),
    "bangalore": (12.97, 77.59),
    "hyderabad": (17.39, 78.49),
    "pune": (18.52, 73.86),
    "chennai": (13.08, 80.27),
}

# Company / platform name -> (lat, lon, display city). Keys are matched
# as whole words against the folded text.
COMPANY_HQ: dict[str, tuple[float, float, str]] = {
    "google": (37.42, -122.08, "Mountain View"),
    "alphabet": (37.42, -122.08, "Mountain View"),
    "meta": (37.48, -122.15, "Menlo Park"),
    "facebook": (37.48, -122.15, "Menlo Park"),
    "apple": (37.32, -122.03, "Cupertino"),
    "microsoft": (47.64, -122.13, "Redmond"),
    "amazon": (47.61, -122.33, "Seattle"),
    "netflix": (37.23, -121.96, "Los Gatos"),
    "tesla": (30.22, -97.77, "Austin"),
    "openai": (37.77, -122.42, "San Francisco"),
    "anthropic": (37.77, -122.42, "San Francisco"),
    "shopify": (45.42, -75.70, "Ottawa"),
    "stripe": (37.77, -122.42, "San Francisco"),
    "hackerone": (37.77, -122.42, "San Francisco"),
    "bugcrowd": (37.77, -122.42, "San Francisco"),
    "intigriti": (51.22, 4.40, "Antwerp"),
    "yeswehack": (48.86, 2.35, "Paris"),
    "upwork": (37.77, -122.42, "San Francisco"),
    "product hunt": (37.77, -122.42, "San Francisco"),
    "adobe": (37.34, -121.89, "San Jose"),
    "intel": (37.39, -121.96, "Santa Clara"),
    "nvidia": (37.39, -121.96, "Santa Clara"),
    "oracle": (30.27, -97.74, "Austin"),
    "salesforce": (37.77, -122.42, "San Francisco"),
    "spotify": (59.33, 18.07, "Stockholm"),
    "zoom": (37.34, -121.89, "San Jose"),
    "airbnb": (37.77, -122.42, "San Francisco"),
    "uber": (37.77, -122.42, "San Francisco"),
    "lyft": (37.77, -122.42, "San Francisco"),
    "palantir": (39.74, -104.99, "Denver"),
    "cloudflare": (37.77, -122.42, "San Francisco"),
    "dropbox": (37.77, -122.42, "San Francisco"),
    "slack": (37.77, -122.42, "San Francisco"),
    "github": (37.77, -122.42, "San Francisco"),
    "gitlab": (37.77, -122.42, "San Francisco"),
}


def _fold(text: str) -> str:
    """Lowercase, strip accents, collapse whitespace — for matching only."""
    ascii_text = unicodedata.normalize("NFKD", text or "")
    ascii_text = "".join(c for c in ascii_text if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", ascii_text.lower()).strip()


def _word_re(names: list[str]) -> re.Pattern:
    # Longest first so "new york" wins over "york" and "san francisco"
    # wins over "francisco" (which is not a key, but be safe anyway).
    ordered = sorted(names, key=len, reverse=True)
    return re.compile(r"\b(" + "|".join(re.escape(n) for n in ordered) + r")\b")


_CITY_RE = _word_re(list(CITY_COORDS))
_HQ_RE = _word_re(list(COMPANY_HQ))


def valid_coords(lat, lon) -> bool:
    """True when lat/lon are real numbers inside the valid ranges."""
    try:
        lat_f, lon_f = float(lat), float(lon)
    except (TypeError, ValueError):
        return False
    return -90.0 <= lat_f <= 90.0 and -180.0 <= lon_f <= 180.0


def resolve_location(text: str) -> dict | None:
    """Find a location in free text.

    Returns ``{"lat", "lon", "name", "match"}`` where ``match`` is
    ``"city"`` or ``"company"`` and ``name`` is what was matched
    (title-cased city, or the HQ city for a company). Cities are tried
    before companies. Returns None when nothing matches.
    """
    folded = _fold(text)
    if not folded:
        return None
    m = _CITY_RE.search(folded)
    if m:
        key = m.group(1)
        lat, lon = CITY_COORDS[key]
        return {"lat": lat, "lon": lon, "name": key.title(), "match": "city"}
    m = _HQ_RE.search(folded)
    if m:
        key = m.group(1)
        lat, lon, city = COMPANY_HQ[key]
        return {"lat": lat, "lon": lon, "name": city, "match": "company"}
    return None
