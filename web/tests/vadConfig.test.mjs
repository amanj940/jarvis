import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Characterization tests for the VAD calibration settings.
//
// The expected values below were transcribed from the ORIGINAL Settings.tsx,
// where the same 14 fields were mapped by hand in seven places. They pin the
// current behaviour — including three *different* default tables — so the
// refactor into SettingsParts/vadConfig.ts is provably behaviour-neutral.
// Same loading pattern as wakeWord.test.mjs: transpile the pure TS module.
const source = readFileSync(
  new URL("../src/components/HUD/SettingsParts/vadConfig.ts", import.meta.url),
  "utf8"
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const {
  VAD_DEFAULTS,
  VAD_LOAD_FALLBACKS,
  vadFromServer,
  vadToServer,
  vadApplyImported,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

// useState(...) initial values == resetSettingsToDefaults() values (table "A").
const A = {
  silenceThreshold: 0.08,
  silenceTimeoutMs: 600,
  minRecordingMs: 500,
  maxRecordingMs: 8000,
  baselineWindowMs: 1200,
  baselineMultiplier: 2.2,
  sileroThreshold: 0.5,
  sileroMinSilenceMs: 500,
  bargeInMultiplier: 3.5,
  bargeInFloor: 0.15,
  bargeInSustainMs: 250,
  sttCoalesceMs: 500,
  hallucinationFilter: true,
  fillerFilter: true,
};

// `?? <fallback>` values used when loading /api/config, importing a backup in
// the Inference tab, and "Reset" in the Inference tab (table "B").
const B = {
  silenceThreshold: 0.08,
  silenceTimeoutMs: 600,
  minRecordingMs: 300,
  maxRecordingMs: 30000,
  baselineWindowMs: 2000,
  baselineMultiplier: 2.2,
  sileroThreshold: 0.5,
  sileroMinSilenceMs: 500,
  bargeInMultiplier: 3.0,
  bargeInFloor: 0.15,
  bargeInSustainMs: 120,
  sttCoalesceMs: 120,
  hallucinationFilter: true,
  fillerFilter: true,
};

const WIRE = {
  silence_threshold: "silenceThreshold",
  silence_timeout_ms: "silenceTimeoutMs",
  min_recording_ms: "minRecordingMs",
  max_recording_ms: "maxRecordingMs",
  baseline_window_ms: "baselineWindowMs",
  baseline_multiplier: "baselineMultiplier",
  silero_threshold: "sileroThreshold",
  silero_min_silence_duration_ms: "sileroMinSilenceMs",
  barge_in_multiplier: "bargeInMultiplier",
  barge_in_floor: "bargeInFloor",
  barge_in_sustain_ms: "bargeInSustainMs",
  stt_coalesce_ms: "sttCoalesceMs",
  hallucination_filter_enabled: "hallucinationFilter",
  filler_filter_enabled: "fillerFilter",
};

// A distinctive value for every field, so a swapped mapping cannot hide.
const custom = {
  silenceThreshold: 0.11,
  silenceTimeoutMs: 701,
  minRecordingMs: 402,
  maxRecordingMs: 9003,
  baselineWindowMs: 1504,
  baselineMultiplier: 2.55,
  sileroThreshold: 0.66,
  sileroMinSilenceMs: 507,
  bargeInMultiplier: 3.88,
  bargeInFloor: 0.19,
  bargeInSustainMs: 310,
  sttCoalesceMs: 611,
  hallucinationFilter: false,
  fillerFilter: false,
};

test("VAD_DEFAULTS is table A (initial state and System > Data reset)", () => {
  assert.deepEqual({ ...VAD_DEFAULTS }, A);
});

test("VAD_LOAD_FALLBACKS is table B (load / Inference-tab import & reset)", () => {
  assert.deepEqual({ ...VAD_LOAD_FALLBACKS }, B);
});

test("the two default tables differ exactly where the original code differed", () => {
  const differing = Object.keys(A).filter((k) => A[k] !== B[k]).sort();
  assert.deepEqual(differing, [
    "bargeInMultiplier",
    "bargeInSustainMs",
    "baselineWindowMs",
    "maxRecordingMs",
    "minRecordingMs",
    "sttCoalesceMs",
  ]);
});

test("defaults are frozen so shared state objects cannot be mutated by accident", () => {
  assert.equal(Object.isFrozen(VAD_DEFAULTS), true);
  assert.equal(Object.isFrozen(VAD_LOAD_FALLBACKS), true);
});

test("vadFromServer({}) falls back to table B", () => {
  assert.deepEqual(vadFromServer({}), B);
});

test("vadFromServer maps every wire key to the right field", () => {
  const wire = {};
  for (const [w, k] of Object.entries(WIRE)) wire[w] = custom[k];
  assert.deepEqual(vadFromServer(wire), custom);
});

test("vadFromServer uses ?? semantics: 0 and false are kept, null/undefined fall back", () => {
  const out = vadFromServer({
    silence_threshold: 0,
    barge_in_floor: 0,
    hallucination_filter_enabled: false,
    filler_filter_enabled: null,
    max_recording_ms: null,
    min_recording_ms: undefined,
  });
  assert.equal(out.silenceThreshold, 0);
  assert.equal(out.bargeInFloor, 0);
  assert.equal(out.hallucinationFilter, false);
  assert.equal(out.fillerFilter, true); // null -> fallback true
  assert.equal(out.maxRecordingMs, 30000); // null -> table B
  assert.equal(out.minRecordingMs, 300); // undefined -> table B
});

test("vadFromServer does not type-check (original passed values straight through)", () => {
  assert.equal(vadFromServer({ silence_timeout_ms: "900" }).silenceTimeoutMs, "900");
});

test("vadToServer produces exactly the 14 wire keys", () => {
  const wire = vadToServer(custom);
  assert.deepEqual(Object.keys(wire).sort(), Object.keys(WIRE).sort());
  for (const [w, k] of Object.entries(WIRE)) assert.equal(wire[w], custom[k], w);
});

test("vadToServer(VAD_DEFAULTS) matches the literal payload the old code sent", () => {
  assert.deepEqual(vadToServer(VAD_DEFAULTS), {
    silence_threshold: 0.08,
    silence_timeout_ms: 600,
    min_recording_ms: 500,
    max_recording_ms: 8000,
    baseline_window_ms: 1200,
    baseline_multiplier: 2.2,
    silero_threshold: 0.5,
    silero_min_silence_duration_ms: 500,
    barge_in_multiplier: 3.5,
    barge_in_floor: 0.15,
    barge_in_sustain_ms: 250,
    stt_coalesce_ms: 500,
    hallucination_filter_enabled: true,
    filler_filter_enabled: true,
  });
});

test("save -> load round-trips any config", () => {
  assert.deepEqual(vadFromServer(vadToServer(custom)), custom);
  assert.deepEqual(vadFromServer(vadToServer(A)), A);
});

test("vadApplyImported applies only correctly-typed values and keeps the rest", () => {
  const out = vadApplyImported(custom, {
    silence_threshold: 0.5, // number  -> applied
    silence_timeout_ms: "900", // string  -> ignored
    min_recording_ms: null, // null    -> ignored
    max_recording_ms: true, // boolean -> ignored (field is numeric)
    hallucination_filter_enabled: 1, // number  -> ignored (field is boolean)
    filler_filter_enabled: true, // boolean -> applied
    barge_in_floor: 0, // 0 is a valid number -> applied
  });
  assert.equal(out.silenceThreshold, 0.5);
  assert.equal(out.silenceTimeoutMs, custom.silenceTimeoutMs);
  assert.equal(out.minRecordingMs, custom.minRecordingMs);
  assert.equal(out.maxRecordingMs, custom.maxRecordingMs);
  assert.equal(out.hallucinationFilter, custom.hallucinationFilter);
  assert.equal(out.fillerFilter, true);
  assert.equal(out.bargeInFloor, 0);
});

test("vadApplyImported on an empty backup is a no-op and never mutates its input", () => {
  const before = { ...custom };
  const out = vadApplyImported(custom, {});
  assert.deepEqual(out, before);
  assert.deepEqual(custom, before);
  assert.notEqual(out, custom); // new object so React sees a state change
});

test("vadApplyImported accepts NaN like the original typeof check did", () => {
  assert.equal(Number.isNaN(vadApplyImported(custom, { silence_threshold: NaN }).silenceThreshold), true);
});
