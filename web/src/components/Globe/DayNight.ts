/**
 * DAY / NIGHT — pure sun-position helpers for the Earth globe.
 *
 * No three.js imports here on purpose: these functions are pure math over
 * `Date`, so they are unit-testable in plain Node (see
 * `web/tests/dayNight.test.mjs`) and cheap to call from the globe.
 *
 * Convention: positions use the same equirectangular convention as
 * `latLonToVec3()` in GlobeLayers.ts (and the NASA Blue Marble textures),
 * so the terminator lines up with the continents and the markers.
 *
 * Accuracy: the low-precision solar algorithm below (NOAA-style, valid
 * 2000–2100) is good to ~0.01° for the subsolar point — far tighter than
 * a pixel on the globe.
 */

export interface SunPosition {
  /** Subsolar latitude in degrees, -23.44..23.44 (the Sun's declination). */
  lat: number;
  /** Subsolar longitude in degrees, -180..180. */
  lon: number;
}

export interface SunVector {
  x: number;
  y: number;
  z: number;
}

/** Sun-direction recompute cadence for the globe (ms). */
export const DAY_NIGHT_UPDATE_MS = 1000;

/**
 * Terminator band in dot-product space, shared by `dayNightMix()` and the
 * globe shader in EarthGlobe.tsx (keep the GLSL literals in sync).
 * -0.08 = full night, 0.22 = full day; in between is soft twilight.
 */
export const TERMINATOR_NIGHT_EDGE = -0.08;
export const TERMINATOR_DAY_EDGE = 0.22;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function norm360(deg: number): number {
  const n = deg % 360;
  return n < 0 ? n + 360 : n;
}

/** Normalise an angle to [-180, 180). */
export function norm180(deg: number): number {
  const n = (((deg + 180) % 360) + 360) % 360;
  return n - 180;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** GLSL-style smoothstep, pure JS. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Subsolar point (where the Sun is directly overhead) for a date.
 * Latitude is the Sun's declination; longitude follows from Greenwich
 * Mean Sidereal Time minus the Sun's right ascension.
 */
export function subsolarPoint(date: Date): SunPosition {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const meanLongitude = norm360(280.46 + 0.9856474 * n);
  const meanAnomaly = norm360(357.528 + 0.9856003 * n) * DEG;
  const eclipticLongitude =
    norm360(
      meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)
    ) * DEG;
  const obliquity = (23.439 - 0.0000004 * n) * DEG;
  const declination =
    Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude)) * RAD;
  const rightAscension =
    Math.atan2(
      Math.cos(obliquity) * Math.sin(eclipticLongitude),
      Math.cos(eclipticLongitude)
    ) * RAD;
  const gmstHours =
    ((18.697374558 + 24.06570982441908 * (jd - 2451545.0)) % 24 + 24) % 24;
  const gmstDeg = gmstHours * 15;
  return { lat: declination, lon: norm180(rightAscension - gmstDeg) };
}

/** Geographic (lat, lon) → unit vector, same convention as latLonToVec3(). */
export function latLonToUnit(lat: number, lon: number): SunVector {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return {
    x: -Math.sin(phi) * Math.cos(theta),
    y: Math.cos(phi),
    z: Math.sin(phi) * Math.sin(theta),
  };
}

/** Unit vector from the Earth's centre toward the Sun (world space). */
export function sunDirection(date: Date): SunVector {
  const sub = subsolarPoint(date);
  return latLonToUnit(sub.lat, sub.lon);
}

/**
 * How lit a point on Earth is: 1 = full day, 0 = full night, in between
 * is the twilight band around the terminator. Always in [0, 1].
 */
export function dayNightMix(lat: number, lon: number, date: Date): number {
  const sun = sunDirection(date);
  const point = latLonToUnit(lat, lon);
  const dot =
    point.x * sun.x + point.y * sun.y + point.z * sun.z;
  return smoothstep(TERMINATOR_NIGHT_EDGE, TERMINATOR_DAY_EDGE, dot);
}

/**
 * Longitude of the sunset terminator at the equator: the Sun sets 90°
 * east of the subsolar point (local solar time 18:00 there).
 */
export function terminatorLongitude(date: Date): number {
  return norm180(subsolarPoint(date).lon + 90);
}
