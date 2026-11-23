/**
 * GLOBE LAYERS — layer/marker registry + lat/lon helpers.
 *
 * The globe component itself never knows about bug bounties, YouTube or
 * leads. Features register a `GlobeLayer` here (from anywhere in the app),
 * the globe subscribes and re-renders the layer. Layers survive globe
 * remounts because the registry lives at module level.
 */
import * as THREE from "three";
import type { GlobeLayer, GlobeMarker } from "./GlobeMarker";

// ── lat / lon → 3D ───────────────────────────────────────────────────────────
/**
 * Convert geographic coordinates to a position on a sphere of the given
 * radius, in the same convention three.js uses for equirectangular
 * textures (so a marker at (lat, lon) sits on the matching map pixel).
 */
export function latLonToVec3(
  lat: number,
  lon: number,
  radius: number,
  out = new THREE.Vector3()
): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  out.set(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
  return out;
}

/** Inverse of latLonToVec3 (for hit-testing / future picking). */
export function vec3ToLatLon(v: THREE.Vector3): { lat: number; lon: number } {
  const r = v.length() || 1;
  const lat = 90 - (Math.acos(THREE.MathUtils.clamp(v.y / r, -1, 1)) * 180) / Math.PI;
  const lon = ((Math.atan2(v.z, -v.x) * 180) / Math.PI - 180 + 540) % 360 - 180;
  return { lat, lon };
}

// ── Registry ────────────────────────────────────────────────────────────────
type Listener = () => void;

const layers = new Map<string, GlobeLayer>();
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a broken listener must not break the globe */
    }
  });
}

/**
 * Register (or replace) a layer. Returns an unsubscribe function.
 * Example: `registerGlobeLayer({ id: "bounty:targets", label: "Bug bounty targets", kind: "markers", markers: [...] })`
 */
export function registerGlobeLayer(layer: GlobeLayer): () => void {
  layers.set(layer.id, { visible: true, ...layer });
  emit();
  return () => unregisterGlobeLayer(layer.id);
}

export function unregisterGlobeLayer(id: string): void {
  if (layers.delete(id)) emit();
}

export function setGlobeLayerVisible(id: string, visible: boolean): void {
  const layer = layers.get(id);
  if (layer && layer.visible !== visible) {
    layer.visible = visible;
    emit();
  }
}

export function getGlobeLayers(): GlobeLayer[] {
  return [...layers.values()];
}

export function getGlobeMarkers(): GlobeMarker[] {
  const out: GlobeMarker[] = [];
  layers.forEach((layer) => {
    if (layer.visible !== false && layer.markers) out.push(...layer.markers);
  });
  return out;
}

/** Subscribe to registry changes; returns an unsubscribe function. */
export function subscribeGlobeLayers(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
