"""Current weather via Open-Meteo — free, no key, no account.

Open-Meteo (https://open-meteo.com) is a free weather API that needs no
API key. One GET returns the current temperature, WMO weather code,
wind and humidity for a coordinate. Results are cached in memory for
10 minutes per (rounded) coordinate so a chat turn or a globe panel
that asks twice does not hit the network twice.

``http_get`` is injectable so tests can stub the network: it must take
``(url, timeout)`` and return an object with a ``read()`` method (like
``urllib`` responses) or a ``str``/``bytes`` body.
"""
from __future__ import annotations

import json
import time
import urllib.request

from .store import valid_coords

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
USER_AGENT = "JarvisGeo/1.0 (local-first assistant; free Open-Meteo use)"
TIMEOUT_S = 10
CACHE_TTL_S = 600

# WMO weather codes → plain-English description.
WEATHER_CODES = {
    0: "clear sky",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "depositing rime fog",
    51: "light drizzle",
    53: "moderate drizzle",
    55: "dense drizzle",
    56: "light freezing drizzle",
    57: "dense freezing drizzle",
    61: "slight rain",
    63: "moderate rain",
    65: "heavy rain",
    66: "light freezing rain",
    67: "heavy freezing rain",
    71: "slight snow",
    73: "moderate snow",
    75: "heavy snow",
    77: "snow grains",
    80: "slight rain showers",
    81: "moderate rain showers",
    82: "violent rain showers",
    85: "slight snow showers",
    86: "heavy snow showers",
    95: "thunderstorm",
    96: "thunderstorm with slight hail",
    99: "thunderstorm with heavy hail",
}

_cache: dict[tuple[float, float], tuple[float, dict]] = {}


def _default_http_get(url: str, timeout: float = TIMEOUT_S):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(req, timeout=timeout)


def _read_body(resp) -> str:
    if isinstance(resp, (str, bytes)):
        return resp.decode("utf-8") if isinstance(resp, bytes) else resp
    data = resp.read()
    return data.decode("utf-8") if isinstance(data, bytes) else data


def fetch_current_weather(lat: float, lon: float, http_get=None) -> dict:
    """Current weather for a coordinate. Never raises — errors are data."""
    if not valid_coords(lat, lon):
        return {"ok": False, "error": "lat must be -90..90 and lon -180..180"}
    key = (round(float(lat), 2), round(float(lon), 2))
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < CACHE_TTL_S:
        return dict(hit[1])
    url = (
        f"{OPEN_METEO_URL}?latitude={lat}&longitude={lon}"
        "&current=temperature_2m,weather_code,wind_speed_10m,"
        "relative_humidity_2m&timezone=auto"
    )
    try:
        body = _read_body((http_get or _default_http_get)(url, TIMEOUT_S))
        data = json.loads(body)
        current = data.get("current") or {}
        code = current.get("weather_code")
        result = {
            "ok": True,
            "temperature_c": current.get("temperature_2m"),
            "weather_code": code,
            "weather": WEATHER_CODES.get(code, "unknown"),
            "wind_kmh": current.get("wind_speed_10m"),
            "humidity_pct": current.get("relative_humidity_2m"),
            "time": current.get("time"),
            "timezone": data.get("timezone"),
        }
    except Exception as e:  # noqa: BLE001 — network failure is a normal outcome
        return {"ok": False, "error": f"weather request failed: {e}"}
    _cache[key] = (now, result)
    return dict(result)


def clear_weather_cache() -> None:
    _cache.clear()
