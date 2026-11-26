import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";

// Static regression tests for the Settings UI gap fix (FG-001..FG-020).
// They assert the markers the fix must leave in the source — no browser,
// no backend — so they run with plain `node --test tests/`.
//
// The Settings panel is split across Settings.tsx and SettingsParts/*.tsx
// (tabs/sections extracted from the original single file). The markers may
// live in any of them, so the "source" under test is their concatenation.
const hudDir = new URL("../src/components/HUD/", import.meta.url);
const partsDir = new URL("SettingsParts/", hudDir);
const settings = [
  new URL("Settings.tsx", hudDir),
  ...readdirSync(partsDir)
    .filter((f) => /\.tsx?$/.test(f))
    .sort()
    .map((f) => new URL(f, partsDir)),
]
  .map((u) => readFileSync(u, "utf8"))
  .join("\n");
const api = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");

test("FG-001: omniroute (9Router) is present in every provider list", () => {
  assert.match(settings, /omniroute:\s*"http:\/\/localhost:20128\/v1"/);
  assert.match(
    settings,
    /omniroute:\s*\["groq\/openai\/gpt-oss-120b",\s*"gem",\s*"gemini\/gemini-3\.8-flash"\]/
  );
  assert.match(settings, /omniroute:\s*\{\s*name:\s*"9Router Proxy"/);
  assert.match(settings, /<option value="omniroute">9Router Proxy/);
});

test("FG-004/FG-005/FG-006: api.ts exposes the cascade/keys/verified wrappers", () => {
  for (const fn of ["getCascadeStatus", "getKeysStatus", "getVerifiedModels"]) {
    assert.match(api, new RegExp(`export async function ${fn}\\(`), fn);
  }
  assert.match(api, /\/api\/models\/cascade/);
  assert.match(api, /\/api\/keys/);
  assert.match(api, /\/api\/models\/verified/);
  // Settings.tsx must use the wrappers instead of inline fetches.
  assert.match(settings, /getCascadeStatus\(\)/);
  assert.match(settings, /getKeysStatus\(\)/);
  assert.match(settings, /getVerifiedModels\(\)/);
});

test("FG-002/FG-003/FG-006: Inference tab renders cascade, active key, badges", () => {
  assert.match(settings, /Multi-Tier Cascade Status/);
  assert.match(settings, /cascadeInfo\.tiers\.map/);
  assert.match(settings, /Active: \{keyPools\[provider\]/);
  assert.match(settings, /in pool/);
  assert.match(settings, /statusIcon.*verified.*✓/s);
});

test("FG-007/FG-008/FG-009: tools tab has typed params, permission filter, plugin deps", () => {
  assert.match(settings, /function ToolParams/);
  assert.match(settings, /parameters\?\.properties/);
  assert.match(settings, /\["all", "safe", "caution", "danger"\]/);
  assert.match(settings, /setSelectedPermission/);
  assert.match(settings, /expandedPlugin/);
  assert.match(settings, /Disable anyway/);
});

test("FG-010: MCP servers have Test and Logs actions", () => {
  assert.match(settings, /handleTestMcpServer/);
  assert.match(settings, /📋 Logs/);
  assert.match(settings, /getMcpServerLogs/);
  assert.match(settings, /expandedLogsServer/);
});

test("FG-013: no hardcoded personal integration defaults", () => {
  assert.doesNotMatch(settings, /amanjrashidismael@gmail\.com/);
  assert.doesNotMatch(settings, /6499456096/);
});

test("FG-014/FG-016: integration tests with history and Test All", () => {
  assert.match(settings, /handleTestIntegration/);
  assert.match(settings, /handleTestAllIntegrations/);
  assert.match(settings, /Test All/);
  assert.match(settings, /Test history/);
  assert.match(settings, /jarvis_integration_test_history/);
});

test("FG-019/FG-020: settings export / import / reset to defaults", () => {
  assert.match(settings, /exportSettings/);
  assert.match(settings, /handleImportSettings/);
  assert.match(settings, /resetSettingsToDefaults/);
  assert.match(settings, /Settings Backup/);
  assert.match(settings, /Reset settings to defaults/);
});
