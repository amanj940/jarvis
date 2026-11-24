import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// Static regression tests for the Settings Auth/Vault tabs (FG-026/FG-027).
// They assert the markers the tabs must leave in the source — no browser,
// no backend — so they run with plain `node --test tests/`.
const auth = readFileSync(
  new URL("../src/components/HUD/SettingsAuth.tsx", import.meta.url),
  "utf8",
);
const vault = readFileSync(
  new URL("../src/components/HUD/SettingsVault.tsx", import.meta.url),
  "utf8",
);
const doc = readFileSync(
  new URL("../../docs/settings-auth-vault-tabs.md", import.meta.url),
  "utf8",
);

test("Auth tab uses only existing api.ts wrappers, no invented endpoints", () => {
  assert.match(auth, /getHealth\(\)/);
  assert.match(auth, /getKeysStatus\(\)/);
  assert.match(auth, /from "\.\.\/\.\.\/lib\/api"/);
  assert.doesNotMatch(auth, /fetch\(`\$\{API_BASE\}\/api\/auth/);
  assert.doesNotMatch(auth, /fetch\(`\$\{API_BASE\}\/api\/config/);
  assert.doesNotMatch(auth, /fetch\(`\$\{API_BASE\}\/api\/vault/);
  assert.doesNotMatch(auth, /\/api\/sessions/);
  assert.doesNotMatch(auth, /\/api\/logout/);
});

test("Auth tab shows permission posture and degrades gracefully", () => {
  assert.match(auth, /permission_mode/);
  assert.match(auth, /Authorization posture/);
  assert.match(auth, /bypass/);
  assert.match(auth, /Configured providers/);
  assert.match(auth, /not available: GET \/api\/keys is not exposed/);
  assert.match(auth, /Session info/);
  assert.match(auth, /does not expose a session\s+endpoint/);
  // FG-026: logout exists but is disabled, never faked.
  assert.match(auth, /Log out from all devices/);
  assert.match(auth, /disabled/);
});

test("Auth tab never handles a secret", () => {
  assert.doesNotMatch(auth, /type="password"/);
  assert.doesNotMatch(auth, /authToken/);
  assert.doesNotMatch(auth, /api_key\s*[:=]/);
  assert.doesNotMatch(auth, /console\.log/);
});

test("Vault tab uses getKeysStatus and renders previews only via safePreview", () => {
  assert.match(vault, /getKeysStatus\(\)/);
  assert.match(vault, /export function safePreview/);
  assert.match(vault, /safePreview\(item\.masked \|\| item\.key_preview\)/);
  // safePreview caps unmasked values at 4 chars + ellipsis.
  assert.match(vault, /v\.slice\(0, 4\)/);
  assert.match(vault, /Stored keys/);
});

test("Vault tab never copies, logs, or accepts a full secret", () => {
  assert.doesNotMatch(vault, /navigator\.clipboard|writeText/);
  assert.doesNotMatch(vault, /console\.log/);
  assert.doesNotMatch(vault, /type="password"/);
  assert.doesNotMatch(vault, /<input/);
  assert.doesNotMatch(vault, /dangerouslySetInnerHTML/);
  assert.match(vault, /never shows, copies, or\s+logs a full secret/);
});

test("Vault backup/restore (FG-027) are shown as unavailable, not faked", () => {
  assert.match(vault, /Backup Vault/);
  assert.match(vault, /Restore from Backup/);
  assert.match(vault, /no backup\/restore endpoint is exposed/);
  // Both actions are disabled buttons.
  const disabledCount = (vault.match(/disabled/g) || []).length;
  assert.ok(disabledCount >= 2, `expected >=2 disabled, got ${disabledCount}`);
});

test("Mount doc covers both tabs and the Settings.tsx integration", () => {
  assert.match(doc, /SettingsAuth/);
  assert.match(doc, /SettingsVault/);
  assert.match(doc, /normalizeTab/);
  assert.match(doc, /activeTab === "auth"/);
  assert.match(doc, /activeTab === "vault"/);
  assert.match(doc, /masked/i);
});
