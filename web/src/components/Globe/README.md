# Earth Globe

Realistic 3D Earth at the centre of the JARVIS HUD. It replaces the old
particle orb (`LivingEntityCore`); if the globe ever fails to render,
`LivingEntityCore` falls back to the old orb automatically.

## Files

- `EarthGlobe.tsx` — the globe component + `GlobeErrorBoundary`.
- `GlobeMarker.ts` — `GlobeMarker` / `GlobeArc` / `GlobeLayer` types.
- `cities.ts` — built-in world-cities dataset + zoom thresholds/limits.

## Zoom & cities (mouse wheel)

Scroll on the globe to zoom, globe.gl style. The controls live in
`LivingEntityCore.tsx` (`OrbitControls`): zoom is enabled with
`minDistance 2.6` / `maxDistance 14` (globe radius 1.9, camera starts
~9.2 away), `zoomSpeed 0.9`, damping kept, pan off. Drag-rotate still
works, and a drag no longer toggles the microphone — only a real click
(pointer moved < 6px) does.

Zoom detail comes from `cities.ts` (69 capitals + megacities, no
dependency, no network):

- Every city has a small dot on the surface, always visible.
- Text labels appear only when zoomed in close (camera distance
  below 5.5, hidden again past 6.0 — hysteresis, so they never flicker)
  and only for cities on the hemisphere facing the camera, so zooming
  out never leaves a wall of text.
- Labels are cheap: visibility is computed in `useFrame` from the
  camera distance and the globe rotation, and React state only changes
  when a city crosses the visibility threshold — no per-frame
  re-renders. One shared dot geometry/material serves all cities.

Why not react-globe.gl? It owns its own WebGL renderer and cannot live
inside the existing R3F `Canvas` (which also hosts the HUD rings,
click-to-mic and the particle-orb fallback), and globe.gl 2.46 needs
three >= 0.179 while this project pins three 0.169 with R3F 8. The
zoom + cities behaviour is implemented on the custom globe instead,
with the same user-visible result and no new dependency.

## Adding things on top of the globe (future features)

```ts
import { registerGlobeLayer } from "./GlobeLayers";

registerGlobeLayer({
  id: "bounty:targets",
  label: "Bug bounty targets",
  kind: "markers",
  markers: [{ id: "bounty:acme", lat: 37.77, lon: -122.41, label: "Acme" }],
  arcs: [{ id: "arc:1", from: { lat: 37.77, lon: -122.41 }, to: { lat: 51.5, lon: -0.12 } }],
});
```

Layers can be hidden with `setGlobeLayerVisible(id, false)` and removed
with `unregisterGlobeLayer(id)`. Props on `<EarthGlobe>` (`markers`,
`layers`, `rotationSpeed`, `autoRotate`, `atmosphere`, `dayNight`,
`clouds`) override/add to the registry.

## Textures (real Earth)

The globe ships with a procedural Earth-like texture generated at runtime,
so it works fully offline. To get the real planet, drop NASA Blue Marble
textures into `web/public/textures/earth/` — the globe detects them
automatically and swaps them in:

- `earth-day.jpg` — day map (2048×1024 recommended)
- `earth-night.jpg` — night lights (emissive)
- `earth-topology.png` — elevation (bump map)

Suggested source (public domain, NASA Visible Earth / Blue Marble Next
Generation, as used by the three-globe examples):

- https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg
- https://unpkg.com/three-globe/example/img/earth-night.jpg
- https://unpkg.com/three-globe/example/img/earth-topology.png

NASA imagery is public domain (US Government work). The binary texture
files are now in the repo (`web/public/textures/earth/`, commit
`60cff8f1`), so the globe uses the real Earth by default; the
procedural texture remains as an offline fallback if they are ever
removed.

## Voice reactivity

The globe reads the same store state as the old orb (`orbState`,
`audioLevel`, `speakerAudioLevel`): it spins faster while listening,
pulses while speaking, and glows while thinking.
