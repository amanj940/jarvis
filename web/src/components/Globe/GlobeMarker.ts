/**
 * GLOBE MARKERS & LAYERS — types for the Earth Globe.
 *
 * Everything that can be drawn on top of the globe (markers, arcs, data
 * layers) is described by these plain types. Future features — bug-bounty
 * targets, YouTube audience regions, opportunity leads, weather, flights —
 * add a layer through `registerGlobeLayer()` (see GlobeLayers.ts) instead of
 * touching the globe component itself.
 */

/** A point pinned to the globe surface. lat -90..90, lon -180..180. */
export interface GlobeMarker {
  /** Stable id, e.g. "bounty:example.com" or "yt:audience:eg". */
  id: string;
  lat: number;
  lon: number;
  /** Short label shown on hover / in the HUD. */
  label?: string;
  /** Hex colour of the pin. Defaults to the HUD cyan. */
  color?: string;
  /** Pin radius as a fraction of the globe radius. Default 0.018. */
  size?: number;
  /** Optional payload for whoever registered the marker. */
  data?: Record<string, unknown>;
}

/** A great-circle-style arc between two markers (or raw lat/lon points). */
export interface GlobeArc {
  id: string;
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  color?: string;
  label?: string;
}

export type GlobeLayerKind = "markers" | "arcs" | "data";

/**
 * A layer that can be switched on/off independently of the globe itself.
 * `visible` defaults to true. Layers are rendered in registration order.
 */
export interface GlobeLayer {
  id: string;
  /** Human-readable name, e.g. "Bug bounty targets". */
  label: string;
  kind: GlobeLayerKind;
  visible?: boolean;
  markers?: GlobeMarker[];
  arcs?: GlobeArc[];
  /** Colour used for this layer's arcs / default marker colour. */
  color?: string;
}

/** Built-in layers that ship with the globe (always available). */
export const BUILTIN_GLOBE_LAYERS: GlobeLayer[] = [
  {
    id: "globe:graticule",
    label: "Graticule",
    kind: "data",
    visible: true,
  },
];
