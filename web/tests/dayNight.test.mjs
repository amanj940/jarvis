import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Same pattern as tests/wakeWord.test.mjs: transpile the pure TypeScript
// helper and import it — no browser, no three.js needed.
const source = readFileSync(
  new URL("../src/components/Globe/DayNight.ts", import.meta.url),
  "utf8"
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const dayNight = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const {
  subsolarPoint,
  sunDirection,
  dayNightMix,
  terminatorLongitude,
  norm180,
  smoothstep,
} = dayNight;

const approx = (actual, expected, tolerance, label) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`
  );
};

test("subsolar point: March equinox 2026, noon UTC (declination ~0)", () => {
  const sub = subsolarPoint(new Date("2026-03-20T12:00:00Z"));
  approx(sub.lat, 0, 0.6, "equinox latitude");
  // Equation of time ~ -7.4 min on Mar 20, so the Sun is ~1.9° east of 0°.
  assert.ok(sub.lon > 0 && sub.lon < 3.5, `equinox longitude, got ${sub.lon}`);
});

test("subsolar point: June solstice 2026, noon UTC (declination +23.44)", () => {
  const sub = subsolarPoint(new Date("2026-06-21T12:00:00Z"));
  approx(sub.lat, 23.44, 0.3, "June solstice latitude");
  assert.ok(sub.lon > -1 && sub.lon < 2, `June solstice longitude, got ${sub.lon}`);
});

test("subsolar point: December solstice 2025, noon UTC (declination -23.44)", () => {
  const sub = subsolarPoint(new Date("2025-12-21T12:00:00Z"));
  approx(sub.lat, -23.44, 0.3, "December solstice latitude");
  assert.ok(sub.lon > -2 && sub.lon < 1, `December solstice longitude, got ${sub.lon}`);
});

test("subsolar point moves westward through the day", () => {
  const midnight = subsolarPoint(new Date("2026-06-21T00:00:00Z"));
  assert.ok(Math.abs(midnight.lon) > 177, `midnight longitude, got ${midnight.lon}`);
  const morning = subsolarPoint(new Date("2026-01-01T06:00:00Z"));
  // 06:00 UTC is solar noon at ~90°E; early-January declination ~ -23°.
  assert.ok(morning.lon > 88 && morning.lon < 93, `06:00 longitude, got ${morning.lon}`);
  approx(morning.lat, -23, 0.5, "January latitude");
});

test("sunDirection is a unit vector", () => {
  for (const iso of ["2026-03-20T12:00:00Z", "2026-06-21T00:00:00Z", "2026-01-15T18:30:00Z"]) {
    const v = sunDirection(new Date(iso));
    approx(Math.hypot(v.x, v.y, v.z), 1, 1e-9, `sun vector length ${iso}`);
  }
});

test("dayNightMix stays in [0, 1] and is 1 at noon, 0 at midnight", () => {
  const noon = new Date("2026-06-21T12:00:00Z");
  const midnight = new Date("2026-06-21T00:00:00Z");
  // London in June: full day at noon, full night at midnight.
  assert.equal(dayNightMix(51.5, 0, noon), 1);
  assert.equal(dayNightMix(51.5, 0, midnight), 0);
  // Subsolar point is full day; its antipode is full night.
  assert.equal(dayNightMix(23.44, 0.5, noon), 1);
  assert.equal(dayNightMix(-23.44, -179.5, noon), 0);
  // Sweep: no value ever leaves [0, 1].
  for (let lat = -90; lat <= 90; lat += 15) {
    for (let lon = -180; lon < 180; lon += 30) {
      const mix = dayNightMix(lat, lon, noon);
      assert.ok(mix >= 0 && mix <= 1, `mix out of bounds at ${lat},${lon}: ${mix}`);
    }
  }
});

test("dayNightMix is smooth through the terminator (twilight band)", () => {
  const date = new Date("2026-03-20T12:00:00Z");
  // At the equator, walking east from the subsolar point crosses the
  // sunset terminator around lon +90; the mix must fall gradually, not jump.
  const samples = [80, 85, 88, 90, 92, 95, 100].map((lon) =>
    dayNightMix(0, lon, date)
  );
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i] <= samples[i - 1], `mix must not rise eastward: ${samples}`);
  }
  assert.ok(samples[0] > 0.9, `well inside day side, got ${samples[0]}`);
  assert.ok(samples[samples.length - 1] < 0.1, `well inside night side, got ${samples[samples.length - 1]}`);
});

test("terminatorLongitude is 90° east of the subsolar point", () => {
  for (const iso of ["2026-03-20T12:00:00Z", "2026-06-21T12:00:00Z", "2026-01-01T06:00:00Z"]) {
    const date = new Date(iso);
    const expected = norm180(subsolarPoint(date).lon + 90);
    approx(terminatorLongitude(date), expected, 1e-9, `terminator ${iso}`);
  }
});

test("smoothstep edges behave like GLSL", () => {
  assert.equal(smoothstep(-0.08, 0.22, -1), 0);
  assert.equal(smoothstep(-0.08, 0.22, 1), 1);
  approx(smoothstep(-0.08, 0.22, 0.07), 0.5, 1e-9, "smoothstep midpoint");
});
