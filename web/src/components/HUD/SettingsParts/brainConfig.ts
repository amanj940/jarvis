/**
 * "Brain Config — Memory & Cognition" settings (backend section `ultimate`).
 *
 * Before this module the six fields were six separate useState hooks in
 * Settings.tsx, mapped to/from the backend by hand in seven places. This file
 * now owns the field list, the wire names and the merge rules.
 *
 * Two merge rules exist today and are preserved exactly (see
 * tests/brainConfig.test.mjs):
 *
 *   brainMergeLoaded    /api/config load and the Inference-tab backup import:
 *                       a field is applied when `!== undefined` (so null/0
 *                       go through); `embed_model` only when truthy.
 *   brainMergeImported  System > Data backup import: a field is applied only
 *                       when `typeof` matches; `embed_model` only when truthy.
 *
 * No imports on purpose: the tests load this file directly.
 */

export interface BrainConfig {
  semanticMemory: boolean;
  embedModel: string;
  recallK: number;
  autoRemember: boolean;
  compactionTrigger: number;
  compactionKeep: number;
}

/** Initial UI state; also what both "Reset settings to defaults" flows apply. */
export const BRAIN_DEFAULTS: Readonly<BrainConfig> = Object.freeze({
  semanticMemory: true,
  embedModel: "text-embedding-004",
  recallK: 5,
  autoRemember: true,
  compactionTrigger: 28,
  compactionKeep: 12,
});

type FieldKind = "number" | "boolean" | "string";

/** [UI field, backend wire name, kind] — the one list every mapping is built from. */
const FIELDS: ReadonlyArray<readonly [keyof BrainConfig, string, FieldKind]> = [
  ["semanticMemory", "semantic_memory", "boolean"],
  ["embedModel", "embed_model", "string"],
  ["recallK", "recall_k", "number"],
  ["autoRemember", "auto_remember", "boolean"],
  ["compactionTrigger", "compaction_trigger_messages", "number"],
  ["compactionKeep", "compaction_keep_recent", "number"],
];

/** UI state -> backend payload (saving and exporting a backup). */
export function brainToServer(brain: BrainConfig): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, wire] of FIELDS) out[wire] = brain[key];
  return out;
}

/**
 * Merge a loaded config (or an Inference-tab backup) into the current state.
 * Not type-checked: the original passed present values straight through.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function brainMergeLoaded(current: BrainConfig, raw: Record<string, any>): BrainConfig {
  const out: Record<string, unknown> = { ...current };
  for (const [key, wire, kind] of FIELDS) {
    const v = raw[wire];
    if (kind === "string" ? v : v !== undefined) out[key] = v;
  }
  return out as unknown as BrainConfig;
}

/** Merge a System > Data backup: only values of the right type are applied. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function brainMergeImported(current: BrainConfig, raw: Record<string, any>): BrainConfig {
  const out: Record<string, unknown> = { ...current };
  for (const [key, wire, kind] of FIELDS) {
    const v = raw[wire];
    if (kind === "string" ? v : typeof v === kind) out[key] = v;
  }
  return out as unknown as BrainConfig;
}
