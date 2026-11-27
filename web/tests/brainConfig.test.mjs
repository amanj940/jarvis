import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Characterization tests for the "Brain Config — Memory & Cognition" settings.
//
// Expected values were transcribed from the ORIGINAL Settings.tsx, where these
// six fields (backend section "ultimate") were mapped by hand in seven places
// with two subtly different "is this value present?" rules. They pin today's
// behaviour so moving the mapping into SettingsParts/brainConfig.ts is
// provably behaviour-neutral. Same loader pattern as vadConfig.test.mjs.
const source = readFileSync(
  new URL("../src/components/HUD/SettingsParts/brainConfig.ts", import.meta.url),
  "utf8"
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { BRAIN_DEFAULTS, brainToServer, brainMergeLoaded, brainMergeImported } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

// useState(...) initial values == both "reset to defaults" flows.
const DEFAULTS = {
  semanticMemory: true,
  embedModel: "text-embedding-004",
  recallK: 5,
  autoRemember: true,
  compactionTrigger: 28,
  compactionKeep: 12,
};

const WIRE = {
  semantic_memory: "semanticMemory",
  embed_model: "embedModel",
  recall_k: "recallK",
  auto_remember: "autoRemember",
  compaction_trigger_messages: "compactionTrigger",
  compaction_keep_recent: "compactionKeep",
};

// Distinct value per field so a swapped mapping cannot hide.
const custom = {
  semanticMemory: false,
  embedModel: "my-embed-v2",
  recallK: 9,
  autoRemember: false,
  compactionTrigger: 40,
  compactionKeep: 7,
};

test("BRAIN_DEFAULTS matches the original initial state and reset values", () => {
  assert.deepEqual({ ...BRAIN_DEFAULTS }, DEFAULTS);
  assert.equal(Object.isFrozen(BRAIN_DEFAULTS), true);
});

test("brainToServer emits exactly the 6 'ultimate' wire keys", () => {
  const wire = brainToServer(custom);
  assert.deepEqual(Object.keys(wire).sort(), Object.keys(WIRE).sort());
  for (const [w, k] of Object.entries(WIRE)) assert.equal(wire[w], custom[k], w);
});

test("brainToServer(BRAIN_DEFAULTS) matches the literal payload the old code sent", () => {
  assert.deepEqual(brainToServer(BRAIN_DEFAULTS), {
    semantic_memory: true,
    embed_model: "text-embedding-004",
    recall_k: 5,
    auto_remember: true,
    compaction_trigger_messages: 28,
    compaction_keep_recent: 12,
  });
});

// ── load (/api/config) and Inference-tab import: "present" rule ─────────────
test("brainMergeLoaded applies every present field", () => {
  const wire = {};
  for (const [w, k] of Object.entries(WIRE)) wire[w] = custom[k];
  assert.deepEqual(brainMergeLoaded(DEFAULTS, wire), custom);
});

test("brainMergeLoaded keeps current values for absent (undefined) fields — no fallback table", () => {
  assert.deepEqual(brainMergeLoaded(custom, {}), custom);
  assert.deepEqual(brainMergeLoaded(custom, { recall_k: undefined }), custom);
});

test("brainMergeLoaded uses `!== undefined` for non-string fields: null and 0 go through", () => {
  const out = brainMergeLoaded(custom, {
    recall_k: 0,
    semantic_memory: null,
    compaction_keep_recent: null,
    auto_remember: false,
  });
  assert.equal(out.recallK, 0);
  assert.equal(out.semanticMemory, null); // original did setBrainSemanticMemory(null)
  assert.equal(out.compactionKeep, null);
  assert.equal(out.autoRemember, false);
});

test("brainMergeLoaded uses truthiness for embed_model: empty string / null are ignored", () => {
  assert.equal(brainMergeLoaded(custom, { embed_model: "" }).embedModel, "my-embed-v2");
  assert.equal(brainMergeLoaded(custom, { embed_model: null }).embedModel, "my-embed-v2");
  assert.equal(brainMergeLoaded(custom, { embed_model: "x" }).embedModel, "x");
});

test("brainMergeLoaded does not type-check (values pass straight through)", () => {
  assert.equal(brainMergeLoaded(custom, { recall_k: "12" }).recallK, "12");
});

// ── System > Data backup import: typeof rule ─────────────────────────────────
test("brainMergeImported applies only correctly-typed values", () => {
  const out = brainMergeImported(custom, {
    semantic_memory: true, // boolean -> applied
    recall_k: "12", // string -> ignored
    auto_remember: 1, // number -> ignored (field is boolean)
    compaction_trigger_messages: 55, // number -> applied
    compaction_keep_recent: null, // null -> ignored
  });
  assert.equal(out.semanticMemory, true);
  assert.equal(out.recallK, custom.recallK);
  assert.equal(out.autoRemember, custom.autoRemember);
  assert.equal(out.compactionTrigger, 55);
  assert.equal(out.compactionKeep, custom.compactionKeep);
});

test("brainMergeImported: embed_model is truthiness-checked, not type-checked", () => {
  assert.equal(brainMergeImported(custom, { embed_model: "e" }).embedModel, "e");
  assert.equal(brainMergeImported(custom, { embed_model: "" }).embedModel, "my-embed-v2");
  assert.equal(brainMergeImported(custom, { embed_model: 42 }).embedModel, 42); // original behaviour
});

test("brainMergeImported accepts 0 and NaN for numbers (typeof check)", () => {
  assert.equal(brainMergeImported(custom, { recall_k: 0 }).recallK, 0);
  assert.equal(Number.isNaN(brainMergeImported(custom, { recall_k: NaN }).recallK), true);
});

test("both merges return a new object and never mutate their input", () => {
  const before = { ...custom };
  for (const merge of [brainMergeLoaded, brainMergeImported]) {
    const out = merge(custom, {});
    assert.deepEqual(out, before);
    assert.deepEqual(custom, before);
    assert.notEqual(out, custom);
  }
});

test("save -> load round-trips any config", () => {
  assert.deepEqual(brainMergeLoaded(DEFAULTS, brainToServer(custom)), custom);
  assert.deepEqual(brainMergeImported(DEFAULTS, brainToServer(custom)), custom);
});
