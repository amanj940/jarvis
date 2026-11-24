import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// Static regression tests for the HUD holo toggle button.
// They assert the markers the feature must leave in the source — no
// browser, no backend — so they run with plain `node --test tests/`.
const toggle = readFileSync(
  new URL("../src/components/HUD/HoloToggle.tsx", import.meta.url),
  "utf8"
);
const screen = readFileSync(
  new URL("../src/components/LivingEntity/LivingEntityScreen.tsx", import.meta.url),
  "utf8"
);
const core = readFileSync(
  new URL("../src/components/LivingEntity/LivingEntityCore.tsx", import.meta.url),
  "utf8"
);

test("HoloToggle dispatches the jarvis:toggle-holo window event on click", () => {
  assert.match(toggle, /export default function HoloToggle/);
  assert.match(
    toggle,
    /window\.dispatchEvent\(new CustomEvent\("jarvis:toggle-holo"\)\)/
  );
  assert.match(toggle, /onClick=\{toggleHolo\}/);
});

test("HoloToggle tracks its own on/off state, starting OFF like the globe layer", () => {
  // LivingEntityCore defaults the holo layer OFF (useState(false)); the
  // button must start OFF too, since no state event is broadcast back.
  assert.match(toggle, /useState\(false\)/);
  assert.match(toggle, /aria-pressed=\{holoOn\}/);
  assert.match(toggle, /setHoloOn\(\(v\) => !v\)/);
});

test("HoloToggle is mounted in the LivingEntityScreen header controls", () => {
  assert.match(screen, /import HoloToggle from "\.\.\/HUD\/HoloToggle"/);
  assert.match(screen, /<HoloToggle \/>/);
});

test("LivingEntityCore listens for the toggle event and defaults holo OFF", () => {
  assert.match(core, /addEventListener\("jarvis:toggle-holo", onToggleHolo\)/);
  assert.match(core, /const \[holoVisible, setHoloVisible\] = useState\(false\)/);
});
