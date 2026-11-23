# Earth Globe

Realistic 3D Earth at the centre of the JARVIS HUD. It replaces the old
particle orb (`LivingEntityCore`); if the globe ever fails to render,
`LivingEntityCore` falls back to the old orb automatically.

## Files

- `EarthGlobe.tsx` — the globe component + `GlobeErrorBoundary`.
- `GlobeMarker.ts` — `GlobeMarker` / `GlobeArc` / `GlobeLayer` types.
- `GlobeLayers.ts` — layer registry + `latLonToVec3()` / `vec3ToLatLon()`.

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
files are **not** in this repo: the GitHub MCP tools used to push this
feature only accept text, so they could not be uploaded that way — add
them locally (or in a future push that supports binary files) and the
globe will use them with no code change.

## Voice reactivity

The globe reads the same store state as the old orb (`orbState`,
`audioLevel`, `speakerAudioLevel`): it spins faster while listening,
pulses while speaking, and glows while thinking.
