# Globe day / night

The Earth globe shows the real day/night terminator for the current time:
the day side uses `earth-day.jpg`, the night side is dimmed and — when the
bundled night texture is present — city lights from `earth-night.jpg` glow
there. The terminator stays fixed in world space while the globe spins
beneath it, like the real Earth.

## How it works

- `web/src/components/Globe/DayNight.ts` — pure sun math, no three.js:
  `subsolarPoint()` (NOAA-style low-precision solar algorithm, ~0.01°),
  `sunDirection()`, `dayNightMix(lat, lon, date)` (0 = night, 1 = day,
  smooth twilight band), `terminatorLongitude()`. Unit-tested in
  `web/tests/dayNight.test.mjs` against known equinox/solstice values.
- `EarthGlobe.tsx` patches the globe's Phong material with
  `onBeforeCompile`: each fragment dots its world-space normal with the
  real Sun direction and mixes the day and night textures across a soft
  twilight band (dot −0.08 = full night, 0.22 = full day — the same
  constants as `TERMINATOR_NIGHT_EDGE` / `TERMINATOR_DAY_EDGE` in
  `DayNight.ts`; keep the GLSL literals in sync if you change them).
  The directional light follows the same Sun direction so the Phong
  lighting matches the shader terminator.

## The prop

```tsx
<EarthGlobe dayNight={true} />   // default: real terminator + night lights
<EarthGlobe dayNight={false} />  // whole globe lit as day, no night texture loaded
```

`dayNight` defaults to `true` and is already on in `LivingEntityCore`
(the globe is rendered with default props, so nothing else needs to
change to get the terminator). Turning it off also skips loading
`earth-night.jpg` and returns the directional light to its fixed
position.

## Fallbacks

- **No night texture** (`earth-night.jpg` absent): the night side is the
  day texture dimmed to 6% — the procedural fallback keeps working, just
  without glowing city lights.
- **No day texture either**: the procedural Earth texture is used for
  both sides, dimmed at night.
- **Shader patch fails**: the patch only replaces `#include` lines that
  exist in the Phong shader; if a three.js upgrade removes one, the
  `.replace()` is a no-op for that chunk and the globe renders as before
  (uniformly lit day texture).

## Performance (weak laptop)

- No extra textures, no new geometry, no new meshes.
- The Sun direction is recomputed **at most once per second**
  (`DAY_NIGHT_UPDATE_MS`); the frame loop does no per-frame sun math.
- Uniforms are mutated in place — no material recompile, no React
  re-renders from the day/night update.

## Known limits

- The cloud shell (when rendered) is not shaded by the terminator; it
  stays uniformly lit. Same for markers, arcs and city dots — they are
  HUD overlays, not part of the planet's lighting.
- The terminator uses the device clock; a wrong system clock puts the
  terminator in the wrong place.
