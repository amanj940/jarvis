# Holo toggle button

The ambient holo layer around the Earth globe (equatorial cyan ring,
inclined violet orbit ring, faint wireframe shell — `HoloShapes.tsx`)
can be shown or hidden from the HUD header with the **هولو** button
(`web/src/components/HUD/HoloToggle.tsx`, mounted in
`LivingEntityScreen.tsx` next to the other header controls).

## How it works

- Clicking the button dispatches the window event `jarvis:toggle-holo`.
- `LivingEntityCore` listens for that event and flips the holo layer's
  visibility. No other component needs to know about the toggle.
- The holo layer defaults to **OFF** (clean, realistic Earth), so the
  button starts OFF too. There is no state event broadcast back from the
  globe, so the button tracks its own on/off state locally.
- When ON, the button glows cyan like the other active HUD controls;
  when OFF it looks like the rest of the header buttons.

## Files

- `web/src/components/HUD/HoloToggle.tsx` — the button component.
- `web/src/components/LivingEntity/LivingEntityScreen.tsx` — mount only
  (import + `<HoloToggle />` in the header controls row).
- `web/tests/holoToggle.test.mjs` — static regression tests.
