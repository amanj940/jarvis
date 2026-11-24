/**
 * INTEL LAYERS — geo-tagged opportunity + bounty markers on the globe.
 *
 * Fetches the read-only intel view from the backend (`GET /api/intel/globe`)
 * and registers two layers through the GlobeLayers registry — the globe
 * itself never knows about leads or bounty programs. EarthGlobe picks the
 * layers up via its existing subscription, so no globe code changes are
 * needed to draw the markers.
 *
 * - Opportunities render green, bounty items amber (critical/high findings
 *   red). A marker's `data` payload carries title / score / severity /
 *   source for the click tooltip in EarthGlobe.
 * - Layers are ON by default and refresh every 5 minutes; a refresh
 *   preserves the user's visibility choice (toggling off stays off).
 * - Toggle (same convention as the holo rings): dispatch a window event
 *   `jarvis:toggle-intel-layer`, or call `setIntelLayerVisible` /
 *   `toggleIntelLayer` directly. No HUD button yet — see docs/intel.md.
 * - A failed fetch (backend down) leaves the previous markers in place
 *   and retries on the next tick; it never throws into the globe.
 */
import { API_BASE } from "../../lib/api";
import {
  getGlobeLayers,
  registerGlobeLayer,
  setGlobeLayerVisible,
  unregisterGlobeLayer,
} from "./GlobeLayers";
import type { GlobeMarker } from "./GlobeMarker";

/** One item from GET /api/intel/globe. */
export interface IntelGlobeItem {
  id: string;
  kind: "opportunity" | "bounty";
  title: string;
  lat: number;
  lon: number;
  score: number | null;
  severity: string | null;
  source: string;
  url: string;
  location_name: string;
  match: string;
}

export const INTEL_OPPORTUNITIES_LAYER_ID = "intel:opportunities";
export const INTEL_BOUNTY_LAYER_ID = "intel:bounty";
export const INTEL_OPPORTUNITY_COLOR = "#4ade80";
export const INTEL_BOUNTY_COLOR = "#f59e0b";
export const INTEL_SEVERE_COLOR = "#ef4444";
export const INTEL_REFRESH_MS = 5 * 60 * 1000;

function colorFor(item: IntelGlobeItem): string {
  if (item.kind === "opportunity") return INTEL_OPPORTUNITY_COLOR;
  if (item.severity === "critical" || item.severity === "high") {
    return INTEL_SEVERE_COLOR;
  }
  return INTEL_BOUNTY_COLOR;
}

function sizeFor(item: IntelGlobeItem): number {
  if (
    item.kind === "bounty" &&
    (item.severity === "critical" || item.severity === "high")
  ) {
    return 0.026;
  }
  return 0.02;
}

export function intelMarkerFor(item: IntelGlobeItem): GlobeMarker {
  return {
    id: item.id,
    lat: item.lat,
    lon: item.lon,
    label: item.title,
    color: colorFor(item),
    size: sizeFor(item),
    data: {
      kind: item.kind,
      title: item.title,
      score: item.score,
      severity: item.severity,
      source: item.source,
      location_name: item.location_name,
      url: item.url,
    },
  };
}

/** Fetch the intel view and (re-)register both layers. Returns null on failure. */
export async function refreshIntelLayer(): Promise<{
  total: number;
  unlocated: { opportunity: number; bounty: number };
} | null> {
  try {
    const res = await fetch(`${API_BASE}/api/intel/globe`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items?: IntelGlobeItem[];
      unlocated?: { opportunity: number; bounty: number };
    };
    const items = Array.isArray(data.items) ? data.items : [];
    // Preserve the user's toggle choice across refreshes.
    const visibleOf = (id: string) =>
      getGlobeLayers().find((l) => l.id === id)?.visible !== false;
    registerGlobeLayer({
      id: INTEL_OPPORTUNITIES_LAYER_ID,
      label: "Opportunities",
      kind: "markers",
      color: INTEL_OPPORTUNITY_COLOR,
      visible: visibleOf(INTEL_OPPORTUNITIES_LAYER_ID),
      markers: items
        .filter((i) => i.kind === "opportunity")
        .map(intelMarkerFor),
    });
    registerGlobeLayer({
      id: INTEL_BOUNTY_LAYER_ID,
      label: "Bug bounty",
      kind: "markers",
      color: INTEL_BOUNTY_COLOR,
      visible: visibleOf(INTEL_BOUNTY_LAYER_ID),
      markers: items.filter((i) => i.kind === "bounty").map(intelMarkerFor),
    });
    return {
      total: items.length,
      unlocated: data.unlocated ?? { opportunity: 0, bounty: 0 },
    };
  } catch {
    return null;
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
let started = false;
let toggleListener: (() => void) | null = null;

/** Start fetching + registering the intel layers. Returns a stop function. */
export function startIntelLayer(
  refreshMs: number = INTEL_REFRESH_MS
): () => void {
  if (started) return stopIntelLayer;
  started = true;
  void refreshIntelLayer();
  timer = setInterval(() => {
    void refreshIntelLayer();
  }, refreshMs);
  if (typeof window !== "undefined") {
    toggleListener = () => {
      toggleIntelLayer();
    };
    window.addEventListener("jarvis:toggle-intel-layer", toggleListener);
  }
  return stopIntelLayer;
}

/** Stop refreshing and remove both layers from the globe. */
export function stopIntelLayer(): void {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
  if (typeof window !== "undefined" && toggleListener) {
    window.removeEventListener("jarvis:toggle-intel-layer", toggleListener);
    toggleListener = null;
  }
  unregisterGlobeLayer(INTEL_OPPORTUNITIES_LAYER_ID);
  unregisterGlobeLayer(INTEL_BOUNTY_LAYER_ID);
  started = false;
}

/** Show or hide the intel layers (both, or one kind). */
export function setIntelLayerVisible(
  visible: boolean,
  kind?: "opportunity" | "bounty"
): void {
  if (!kind || kind === "opportunity") {
    setGlobeLayerVisible(INTEL_OPPORTUNITIES_LAYER_ID, visible);
  }
  if (!kind || kind === "bounty") {
    setGlobeLayerVisible(INTEL_BOUNTY_LAYER_ID, visible);
  }
}

/** Flip the visibility of the intel layers; returns the new visibility. */
export function toggleIntelLayer(
  kind?: "opportunity" | "bounty"
): boolean {
  const id =
    kind === "bounty" ? INTEL_BOUNTY_LAYER_ID : INTEL_OPPORTUNITIES_LAYER_ID;
  const layer = getGlobeLayers().find((l) => l.id === id);
  // If the layer is not registered yet there is nothing visible to flip.
  const next = layer ? layer.visible === false : false;
  setIntelLayerVisible(next, kind);
  return next;
}
