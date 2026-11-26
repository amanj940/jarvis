/**
 * VAD (voice activity detection) calibration settings.
 *
 * Before this module the same 14 fields were declared as 14 separate
 * useState hooks in Settings.tsx and mapped to/from the backend by hand in
 * seven places. This file is now the single place that knows the field list,
 * the snake_case wire names and the default tables.
 *
 * NOTE — three different default tables exist in the app today (see
 * tests/vadConfig.test.mjs). They are preserved here exactly as they were so
 * the refactor changes no behaviour:
 *
 *   VAD_DEFAULTS        initial UI state and "Reset" in System > Data
 *   VAD_LOAD_FALLBACKS  used when the backend omits a field, when importing a
 *                       backup in the Inference tab, and for "Reset" there
 *   (backend)           jarvis/config.py VadConfig — differs from both
 *
 * This module has no imports on purpose: it is loaded directly by the tests.
 */

export interface VadConfig {
  silenceThreshold: number;
  silenceTimeoutMs: number;
  minRecordingMs: number;
  maxRecordingMs: number;
  baselineWindowMs: number;
  baselineMultiplier: number;
  sileroThreshold: number;
  sileroMinSilenceMs: number;
  bargeInMultiplier: number;
  bargeInFloor: number;
  bargeInSustainMs: number;
  sttCoalesceMs: number;
  hallucinationFilter: boolean;
  fillerFilter: boolean;
}

/** Initial UI state, and what "Reset settings to defaults" (System > Data) applies. */
export const VAD_DEFAULTS: Readonly<VadConfig> = Object.freeze({
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
});

/** Fallbacks for fields missing from a loaded/imported config (Inference-tab flows). */
export const VAD_LOAD_FALLBACKS: Readonly<VadConfig> = Object.freeze({
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
});

type FieldKind = "number" | "boolean";

/** [UI field, backend wire name, kind] — the one list every mapping is built from. */
const FIELDS: ReadonlyArray<readonly [keyof VadConfig, string, FieldKind]> = [
  ["silenceThreshold", "silence_threshold", "number"],
  ["silenceTimeoutMs", "silence_timeout_ms", "number"],
  ["minRecordingMs", "min_recording_ms", "number"],
  ["maxRecordingMs", "max_recording_ms", "number"],
  ["baselineWindowMs", "baseline_window_ms", "number"],
  ["baselineMultiplier", "baseline_multiplier", "number"],
  ["sileroThreshold", "silero_threshold", "number"],
  ["sileroMinSilenceMs", "silero_min_silence_duration_ms", "number"],
  ["bargeInMultiplier", "barge_in_multiplier", "number"],
  ["bargeInFloor", "barge_in_floor", "number"],
  ["bargeInSustainMs", "barge_in_sustain_ms", "number"],
  ["sttCoalesceMs", "stt_coalesce_ms", "number"],
  ["hallucinationFilter", "hallucination_filter_enabled", "boolean"],
  ["fillerFilter", "filler_filter_enabled", "boolean"],
];

/**
 * Backend payload -> UI state, `?? VAD_LOAD_FALLBACKS` per field.
 * Deliberately not type-checked: the original passed values straight through.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function vadFromServer(raw: Record<string, any>): VadConfig {
  const out: Record<string, unknown> = {};
  for (const [key, wire] of FIELDS) out[key] = raw[wire] ?? VAD_LOAD_FALLBACKS[key];
  return out as unknown as VadConfig;
}

/** UI state -> backend payload (used for saving and for exporting a backup). */
export function vadToServer(vad: VadConfig): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const [key, wire] of FIELDS) out[wire] = vad[key];
  return out;
}

/**
 * Apply a backup file to the current state (System > Data import): only values
 * of the right type are applied, everything else keeps its current value.
 * Returns a new object and never mutates `current`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function vadApplyImported(current: VadConfig, raw: Record<string, any>): VadConfig {
  const out: Record<string, unknown> = { ...current };
  for (const [key, wire, kind] of FIELDS) {
    if (typeof raw[wire] === kind) out[key] = raw[wire];
  }
  return out as unknown as VadConfig;
}
