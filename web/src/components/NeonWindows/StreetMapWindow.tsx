/**
 * STREET MAP WINDOW — a light street-map layer for the JARVIS globe.
 *
 * Opens from the city info panel on the globe (EarthGlobe.tsx) and shows
 * the clicked city as a 2.5D street map with 3D buildings. It is a LAYER,
 * not a globe change: the globe's rendering, textures, markers, arcs,
 * zoom behaviour and day/night are untouched.
 *
 * Map: MapLibre GL JS (BSD licence, free, no API key) with the OpenFreeMap
 * "dark" style (free, no key) — style URL verified 2026-11-24 (HTTP 200,
 * valid MapLibre style v8, source `openmaptiles` with a `building`
 * source-layer). 3D buildings follow MapLibre's official "Display
 * buildings in 3D" example: a `fill-extrusion` layer on the
 * `openmaptiles` / `building` source-layer, minzoom 15, inserted just
 * under the first labelled symbol layer so street labels stay readable.
 *
 * Lazy + cheap: the map is created only when this component mounts (i.e.
 * only while its neon window is open) and `map.remove()` runs on
 * unmount, so the globe's performance is untouched while the window is
 * closed. Re-opening for another city re-centres the same map instance.
 */
import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  type FillExtrusionLayerSpecification,
  type Map as MapLibreMapInstance,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/** OpenFreeMap dark style — free tiles, no API key. */
export const STREET_MAP_STYLE_URL =
  "https://tiles.openfreemap.org/styles/dark";
export const STREET_MAP_STYLE_NAME = "OpenFreeMap dark";
export const STREET_MAP_INITIAL_ZOOM = 15;
export const STREET_MAP_PITCH = 45;

export interface StreetMapWindowProps {
  /** City latitude (-90..90). */
  lat: number;
  /** City longitude (-180..180). */
  lon: number;
  /** City display name, used in the footer + window title. */
  name: string;
}

function isValidCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * 3D buildings layer, per MapLibre's official "Display buildings in 3D"
 * example (adapted: OpenFreeMap `openmaptiles` source, cyan-tinted to
 * match the HUD; inserted under the first labelled symbol layer).
 */
function add3DBuildingsLayer(map: MapLibreMapInstance): void {
  if (map.getLayer("street-map-3d-buildings")) return;
  const layers = map.getStyle()?.layers ?? [];
  const labelLayer = layers.find(
    (l) =>
      l.type === "symbol" &&
      (l as { layout?: { "text-field"?: unknown } }).layout?.["text-field"] !==
        undefined,
  );
  const spec: FillExtrusionLayerSpecification = {
    id: "street-map-3d-buildings",
    source: "openmaptiles",
    "source-layer": "building",
    filter: ["==", "extrude", "true"],
    type: "fill-extrusion",
    minzoom: 15,
    paint: {
      "fill-extrusion-color": "#155e75",
      "fill-extrusion-height": [
        "interpolate",
        ["linear"],
        ["zoom"],
        15,
        0,
        15.05,
        ["get", "render_height"],
      ],
      "fill-extrusion-base": [
        "interpolate",
        ["linear"],
        ["zoom"],
        15,
        0,
        15.05,
        ["get", "render_min_height"],
      ],
      "fill-extrusion-opacity": 0.85,
    },
  };
  map.addLayer(spec, labelLayer?.id);
}

export default function StreetMapWindow({ lat, lon, name }: StreetMapWindowProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMapInstance | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Create the map once, on mount — lazy: nothing exists while closed.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    const map = new MapLibreMap({
      container,
      style: STREET_MAP_STYLE_URL,
      center: [lon, lat],
      zoom: STREET_MAP_INITIAL_ZOOM,
      pitch: STREET_MAP_PITCH,
      // Attribution stays on (MapLibre default): © OpenMapTiles © OpenStreetMap.
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    map.on("load", () => {
      if (cancelled) return;
      add3DBuildingsLayer(map);
    });
    map.on("error", (e) => {
      if (cancelled) return;
      const msg = (e as { error?: { message?: string } }).error?.message;
      if (msg) setLoadError(msg);
    });

    // The neon window is draggable/resizable — keep the map fitted.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);

    return () => {
      cancelled = true;
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-centre when the window is re-opened for another city (the window
  // store focuses the existing singleton instead of spawning a duplicate).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isValidCoord(lat, lon)) return;
    map.flyTo({
      center: [lon, lat],
      zoom: STREET_MAP_INITIAL_ZOOM,
      pitch: STREET_MAP_PITCH,
      duration: 1200,
    });
  }, [lat, lon]);

  if (!isValidCoord(lat, lon)) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center font-mono text-[11px] tracking-[0.2em] text-slate-400">
        No coordinates for this city.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0c0c0c]">
      <div ref={containerRef} className="absolute inset-0" />
      {/* Footer: city + free-tile credit (tiles: © OpenMapTiles © OpenStreetMap). */}
      <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-md border border-cyan-500/30 bg-slate-950/80 px-2 py-1 font-mono text-[10px] tracking-wider text-cyan-200/90 backdrop-blur-md">
        <span dir="auto">{name}</span>
        <span className="text-cyan-400/60">
          {" "}
          · {lat.toFixed(4)}, {lon.toFixed(4)} · OpenFreeMap / © OpenStreetMap
        </span>
      </div>
      {loadError && (
        <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-rose-500/40 bg-slate-950/85 px-3 py-1.5 font-mono text-[10px] text-rose-200">
          Street tiles failed to load — check connection ({loadError}).
        </div>
      )}
    </div>
  );
}
