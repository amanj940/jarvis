import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// Static regression tests for the Settings Monitor tab.
// They assert the markers the tab must leave in the source — no browser,
// no backend — so they run with plain `node --test tests/`.
const monitor = readFileSync(
  new URL("../src/components/HUD/SettingsMonitor.tsx", import.meta.url),
  "utf8"
);
const doc = readFileSync(
  new URL("../../docs/settings-monitor-tab.md", import.meta.url),
  "utf8"
);

test("Monitor tab references only existing backend endpoints", () => {
  const endpoints = [...monitor.matchAll(/\/api\/[a-zA-Z0-9/_-]+/g)].map((m) => m[0]);
  assert.ok(endpoints.length > 0, "tab must call at least one endpoint");
  const allowed = new Set(["/api/health", "/api/stats", "/api/tasks"]);
  for (const e of new Set(endpoints)) {
    assert.ok(allowed.has(e), `invented or out-of-scope endpoint: ${e}`);
  }
  for (const e of ["/api/health", "/api/stats", "/api/tasks"]) {
    assert.ok(endpoints.includes(e), `tab must use ${e}`);
  }
});

test("Monitor tab is read-only and adds no api.ts functions", () => {
  assert.doesNotMatch(monitor, /method:\s*"(POST|PATCH|PUT|DELETE)"/);
  assert.doesNotMatch(monitor, /export async function/);
  // Health/stats go through the existing wrappers; tasks uses a direct GET.
  assert.match(monitor, /getHealth\(\)/);
  assert.match(monitor, /getStats\(\)/);
  assert.match(monitor, /fetch\(`\$\{API_BASE\}\/api\/tasks`\)/);
});

test("Every section degrades gracefully instead of showing fake data", () => {
  // The literal phrase lives in the UNAVAILABLE constant; each of the three
  // sections renders it through the <Unavailable /> component.
  assert.match(monitor, /const UNAVAILABLE = "not available on this backend build"/);
  const usages = monitor.match(/<Unavailable/g) ?? [];
  assert.ok(usages.length >= 3, `expected >=3 <Unavailable /> uses, found ${usages.length}`);
  assert.match(monitor, /Backend health/);
  assert.match(monitor, /System Telemetry/);
  assert.match(monitor, /Persistent Tasks/);
  // The 503 "task system not initialised" case is handled explicitly.
  assert.match(monitor, /task system not initialised/);
});

test("Monitor tab exports a default component with refresh + polling", () => {
  assert.match(monitor, /export default function SettingsMonitor/);
  assert.match(monitor, /Refresh/);
  assert.match(monitor, /setInterval/);
  assert.match(monitor, /REFRESH_MS/);
});

test("Monitor doc carries the exact mount instruction for Settings.tsx", () => {
  assert.match(doc, /import SettingsMonitor from "\.\/SettingsMonitor"/);
  assert.match(doc, /"monitor"/);
  assert.match(doc, /systemSubTab === "monitor" && <SettingsMonitor \/>/);
  assert.match(doc, /sysSubTabs/);
});
