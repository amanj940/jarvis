/**
 * EARTH GLOBE — a realistic 3D Earth for the centre of the JARVIS HUD.
 *
 * Replaces the old particle orb (LivingEntityCore) as the central entity.
 * Built to be extended, not rebuilt:
 *   - Layers/markers register through GlobeLayers.ts (`registerGlobeLayer`)
 *     — bug-bounty targets, YouTube audience, leads, weather, flights, …
 *   - `latLonToVec3()` converts any lat/lon to a globe position.
 *   - Props cover rotation speed, auto-rotate, atmosphere, day/night and
 *     clouds; every visual is a separate, toggleable piece.
 *
 * Textures: the globe ships with a procedural Earth-like texture generated
 * at runtime (offline-safe, zero downloads). If real NASA Blue Marble
 * textures are dropped into `web/public/textures/earth/` —
 * `earth-day.jpg`, `earth-night.jpg`, `earth-topology.png` — they are
 * picked up automatically and replace the procedural ones. See README.md
 * in this folder for sources/licences.
 *
 * Voice reactivity: the globe reads the same store state as the old orb —
 * `orbState`, `audioLevel`, `speakerAudioLevel` — and reacts: faster spin
 * while listening, a pulse while speaking, a slow glow while thinking.
 * If the globe ever fails to render, the parent falls back to the old
 * particle orb (see `GlobeErrorBoundary` + LivingEntityCore).
 *
 * Zoom: mouse-wheel zoom is enabled on the OrbitControls in
 * LivingEntityCore (min/max distance in cities.ts). City dots from
 * cities.ts are always on the surface; their text labels appear only when
 * zoomed in close (camera distance < ~5.5) and only for cities on the
 * hemisphere facing the camera — globe.gl-style detail, implemented on
 * this custom globe (react-globe.gl cannot live inside the existing
 * R3F Canvas: it owns its own WebGL renderer, and globe.gl 2.46 needs
 * three >= 0.179 while this project pins three 0.169 with R3F 8).
 */
import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useStore, type OrbState } from "../../lib/store";
import { useReducedMotion } from "../../lib/useReducedMotion";
import {
  getGlobeLayers,
  latLonToVec3,
  subscribeGlobeLayers,
} from "./GlobeLayers";
import {
  WORLD_CITIES,
  shouldShowCityLabels,
  type WorldCity,
} from "./cities";
import type { GlobeArc, GlobeLayer, GlobeMarker } from "./GlobeMarker";

export interface EarthGlobeProps {
  /** Globe radius in scene units. Default 1.9 (fits the HUD camera). */
  radius?: number;
  /** Base spin speed in rad/s. Default 0.05. */
  rotationSpeed?: number;
  /** Slowly spin when idle. Default true. */
  autoRotate?: boolean;
  /** Neon atmosphere glow shell. Default true. */
  atmosphere?: boolean;
  /** Sun-lit day side + night-lights emissive when a night texture is present. Default true. */
  dayNight?: boolean;
  /** Rotating procedural cloud shell. Default true. */
  clouds?: boolean;
  /** Extra markers on top of the registered layers. */
  markers?: GlobeMarker[];
  /** Extra layers on top of the registered layers. */
  layers?: GlobeLayer[];
  /** Bundled day texture (auto-detected in web/public/textures/earth/). */
  textureUrl?: string;
  nightTextureUrl?: string;
  topologyUrl?: string;
  /** React to voice/listening state (spin + pulse). Default true. */
  voiceReactive?: boolean;
  reducedMotion?: boolean;
  onMarkerClick?: (marker: GlobeMarker) => void;
}

export const EARTH_TEXTURE_DIR = "/textures/earth";
export const DEFAULT_DAY_TEXTURE = `${EARTH_TEXTURE_DIR}/earth-day.jpg`;
export const DEFAULT_NIGHT_TEXTURE = `${EARTH_TEXTURE_DIR}/earth-night.jpg`;
export const DEFAULT_TOPOLOGY_TEXTURE = `${EARTH_TEXTURE_DIR}/earth-topology.png`;

// ── Seeded PRNG (deterministic procedural textures) ─────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Procedural textures ─────────────────────────────────────────────────────
/** Continents placed where the real ones are (lon/lat, radii in degrees). */
const CONTINENT_BLOBS: Array<{
  lon: number;
  lat: number;
  rx: number;
  ry: number;
  tint: string;
}> = [
  { lon: -100, lat: 45, rx: 30, ry: 18, tint: "#3f7d4e" }, // North America
  { lon: -42, lat: 74, rx: 11, ry: 8, tint: "#5b8a5e" }, // Greenland
  { lon: -60, lat: -15, rx: 14, ry: 23, tint: "#4a8a4f" }, // South America
  { lon: 18, lat: 5, rx: 20, ry: 26, tint: "#8a7a3f" }, // Africa
  { lon: 60, lat: 52, rx: 46, ry: 17, tint: "#4f7d4a" }, // Eurasia
  { lon: 78, lat: 21, rx: 10, ry: 12, tint: "#7d8a4a" }, // India
  { lon: 113, lat: 2, rx: 16, ry: 10, tint: "#3f7d4e" }, // SE Asia / Indonesia
  { lon: 134, lat: -25, rx: 15, ry: 10, tint: "#a08040" }, // Australia
  { lon: 0, lat: -82, rx: 180, ry: 9, tint: "#dfe9ee" }, // Antarctica
];

function makeEarthTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");

  // Ocean: deep blue → teal gradient with subtle variation.
  const ocean = ctx.createLinearGradient(0, 0, 0, H);
  ocean.addColorStop(0, "#0b2a4a");
  ocean.addColorStop(0.5, "#0d3a5c");
  ocean.addColorStop(1, "#0b2a4a");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, W, H);

  const rand = mulberry32(20261123);
  // Soft mottling so the ocean is not flat.
  for (let i = 0; i < 900; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 4 + rand() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rand() > 0.5;
    g.addColorStop(0, light ? "rgba(80,160,200,0.10)" : "rgba(4,20,40,0.12)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Continents: overlapping jittered ellipses per blob.
  const lonToX = (lon: number) => ((lon + 180) / 360) * W;
  const latToY = (lat: number) => ((90 - lat) / 180) * H;
  for (const blob of CONTINENT_BLOBS) {
    const cx = lonToX(blob.lon);
    const cy = latToY(blob.lat);
    const rx = (blob.rx / 360) * W;
    const ry = (blob.ry / 180) * H;
    for (let i = 0; i < 26; i++) {
      const jx = (rand() - 0.5) * rx * 1.1;
      const jy = (rand() - 0.5) * ry * 1.1;
      const jr = (0.25 + rand() * 0.45) * Math.max(rx, ry);
      const g = ctx.createRadialGradient(cx + jx, cy + jy, 0, cx + jx, cy + jy, jr);
      g.addColorStop(0, blob.tint);
      g.addColorStop(0.75, blob.tint);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx + jx, cy + jy, jr, 0, Math.PI * 2);
      ctx.fill();
    }
    // Wrap-around copies so continents crossing ±180° stay continuous.
    for (const dx of [-W, W]) {
      ctx.save();
      ctx.translate(dx, 0);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  // Polar ice caps with a wavy edge.
  ctx.fillStyle = "#eef4f7";
  for (const top of [true, false]) {
    ctx.beginPath();
    ctx.moveTo(0, top ? 0 : H);
    for (let x = 0; x <= W; x += 8) {
      const wave = Math.sin(x * 0.02 + (top ? 0 : 2.1)) * 7 + Math.sin(x * 0.055) * 4;
      ctx.lineTo(x, top ? 26 + wave : H - 30 - wave);
    }
    ctx.lineTo(W, top ? 0 : H);
    ctx.closePath();
    ctx.fill();
  }

  // Faint graticule every 30°.
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = lonToX(lon);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = latToY(lat);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeCloudTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.clearRect(0, 0, W, H);
  const rand = mulberry32(777);
  for (let i = 0; i < 260; i++) {
    const x = rand() * W;
    const y = H * 0.12 + rand() * H * 0.76;
    const r = 6 + rand() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.25 + rand() * 0.35})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ── Atmosphere glow shader ──────────────────────────────────────────────────
const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec3 vNormal;
  void main() {
    float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.5);
    gl_FragColor = vec4(uColor, 1.0) * intensity * uIntensity;
  }
`;

// ── Error boundary (fallback to the old orb on any globe failure) ───────────
interface BoundaryProps {
  onError?: (error: Error) => void;
  children: ReactNode;
}
interface BoundaryState {
  hasError: boolean;
}
export class GlobeErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    this.props.onError?.(error);
  }

  render(): ReactNode {
    return this.state.hasError ? null : this.props.children;
  }
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);

// ── Graticule geometry (3D lines, rebuilt once) ─────────────────────────────
function buildGraticule(radius: number): THREE.BufferGeometry {
  const points: number[] = [];
  const push = (v: THREE.Vector3) => points.push(v.x, v.y, v.z);
  const r = radius * 1.002;
  for (let lon = -180; lon < 180; lon += 30) {
    for (let lat = -90; lat < 90; lat += 6) {
      push(latLonToVec3(lat, lon, r));
      push(latLonToVec3(lat + 6, lon, r));
    }
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -180; lon < 180; lon += 6) {
      push(latLonToVec3(lat, lon, r));
      push(latLonToVec3(lat, lon + 6, r));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return geo;
}

function buildArcGeometry(
  arc: GlobeArc,
  radius: number
): THREE.BufferGeometry {
  const a = latLonToVec3(arc.from.lat, arc.from.lon, radius * 1.02);
  const b = latLonToVec3(arc.to.lat, arc.to.lon, radius * 1.02);
  const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(radius * 1.45);
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  return new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
}

// ── Earth Globe ─────────────────────────────────────────────────────────────
export default function EarthGlobe(props: EarthGlobeProps) {
  const {
    radius = 1.9,
    rotationSpeed = 0.05,
    autoRotate = true,
    atmosphere = true,
    dayNight = true,
    clouds = true,
    markers: propMarkers = [],
    layers: propLayers = [],
    textureUrl = DEFAULT_DAY_TEXTURE,
    nightTextureUrl = DEFAULT_NIGHT_TEXTURE,
    topologyUrl = DEFAULT_TOPOLOGY_TEXTURE,
    voiceReactive = true,
    reducedMotion: reducedMotionProp,
    onMarkerClick,
  } = props;

  const reducedMotion = useReducedMotion();
  const motionReduced = reducedMotionProp ?? reducedMotion;

  const groupRef = useRef<THREE.Group>(null);
  const cloudsRef = useRef<THREE.Mesh>(null);
  const speedRef = useRef(rotationSpeed);
  const atmosphereRef = useRef<THREE.ShaderMaterial>(null);

  // Procedural textures are the always-available fallback.
  const proceduralDay = useMemo(() => makeEarthTexture(), []);
  const proceduralClouds = useMemo(() => makeCloudTexture(), []);
  const graticuleGeo = useMemo(() => buildGraticule(radius), [radius]);

  const [dayTex, setDayTex] = useState<THREE.Texture | null>(null);
  const [nightTex, setNightTex] = useState<THREE.Texture | null>(null);
  const [topoTex, setTopoTex] = useState<THREE.Texture | null>(null);

  // Registered layers (live subscription) + prop layers.
  const [registryLayers, setRegistryLayers] = useState<GlobeLayer[]>(() =>
    getGlobeLayers()
  );
  useEffect(
    () => subscribeGlobeLayers(() => setRegistryLayers(getGlobeLayers())),
    []
  );
  const layers = useMemo(
    () => [...registryLayers, ...propLayers].filter((l) => l.visible !== false),
    [registryLayers, propLayers]
  );
  const markers = useMemo(() => {
    const fromLayers = layers.flatMap((l) => l.markers ?? []);
    return [...fromLayers, ...propMarkers];
  }, [layers, propMarkers]);
  const arcs = useMemo(() => layers.flatMap((l) => l.arcs ?? []), [layers]);
  const arcLines = useMemo(
    () =>
      arcs.map((arc) => {
        const geo = buildArcGeometry(arc, radius);
        const mat = new THREE.LineBasicMaterial({
          color: arc.color ?? "#67e8f9",
          transparent: true,
          opacity: 0.75,
          depthWrite: false,
        });
        return { arc, line: new THREE.Line(geo, mat) };
      }),
    [arcs, radius]
  );

  // ── Zoom detail: city dots + labels ─────────────────────────────────────
  // City surface positions (local space; the group rotation moves them).
  const cityPositions = useMemo(
    () =>
      WORLD_CITIES.map((city) => ({
        city,
        pos: latLonToVec3(city.lat, city.lon, radius * 1.015),
      })),
    [radius]
  );
  // One shared dot geometry/material for all cities (cheap on a weak GPU).
  const cityDotGeo = useMemo(
    () => new THREE.SphereGeometry(radius * 0.014, 8, 8),
    [radius]
  );
  const cityDotMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#7dd3fc" }),
    []
  );

  // Labels appear only when zoomed in (hysteresis) and only for cities on
  // the camera-facing hemisphere. State changes only on threshold crossing,
  // never per frame, so the frame loop causes no React re-renders.
  const [showCityLabels, setShowCityLabels] = useState(false);
  const showCityLabelsRef = useRef(false);
  const [visibleCityIds, setVisibleCityIds] = useState<string[]>([]);
  const visibleCityIdsRef = useRef<string[]>([]);
  const tmpCityPos = useRef(new THREE.Vector3());
  const tmpCamDir = useRef(new THREE.Vector3());
  const visibleCities = useMemo(() => {
    const byId = new Map(cityPositions.map((c) => [c.city.id, c]));
    return visibleCityIds
      .map((id) => byId.get(id))
      .filter(
        (c): c is { city: WorldCity; pos: THREE.Vector3 } => c !== undefined
      );
  }, [visibleCityIds, cityPositions]);

  // Try bundled real textures; silently keep the procedural ones on failure.
  useEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    const load = (
      url: string,
      onLoad: (t: THREE.Texture) => void,
      srgb = true
    ) => {
      loader.load(
        url,
        (t) => {
          if (!alive) return;
          if (srgb) t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
          onLoad(t);
        },
        undefined,
        () => {
          /* bundled texture absent — procedural texture stays */
        }
      );
    };
    load(textureUrl, setDayTex);
    if (dayNight) load(nightTextureUrl, setNightTex);
    load(topologyUrl, setTopoTex, false);
    return () => {
      alive = false;
    };
  }, [textureUrl, nightTextureUrl, topologyUrl, dayNight]);

  // Atmosphere shader material (created once, intensity animated in useFrame).
  const atmosphereMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: ATMOSPHERE_VERTEX,
        fragmentShader: ATMOSPHERE_FRAGMENT,
        uniforms: {
          uColor: { value: new THREE.Color("#38bdf8") },
          uIntensity: { value: 0.9 },
        },
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      }),
    []
  );

  // Cleanup: dispose everything we created.
  useEffect(() => {
    return () => {
      proceduralDay.dispose();
      proceduralClouds.dispose();
      graticuleGeo.dispose();
      atmosphereMaterial.dispose();
      cityDotGeo.dispose();
      cityDotMat.dispose();
      arcLines.forEach(({ line }) => {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
      dayTex?.dispose();
      nightTex?.dispose();
      topoTex?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Frame loop: rotation, voice pulse, clouds, zoom detail ─────────────
  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const dt = Math.min(delta, 0.05);

    let audioAmp = 0;
    let orbState: OrbState = "idle";
    if (voiceReactive) {
      const store = useStore.getState();
      orbState = store.orbState as OrbState;
      const analyser = (window as unknown as { __jarvisTtsAnalyser?: AnalyserNode })
        .__jarvisTtsAnalyser;
      if (orbState === "speaking" && analyser) {
        const fb = new Uint8Array(64);
        analyser.getByteFrequencyData(fb);
        let sum = 0;
        for (let i = 2; i < 40; i++) sum += fb[i];
        audioAmp = Math.min(1, (sum / 38 / 255) * 2);
      } else if (orbState === "speaking") {
        audioAmp = (store.speakerAudioLevel || 0) * 1.5;
      } else if (orbState === "listening") {
        audioAmp = (store.audioLevel || 0) * 1.2;
      }
    }

    // Rotation speed by voice state.
    const targetSpeed = motionReduced
      ? 0
      : rotationSpeed *
        (orbState === "listening"
          ? 2.4
          : orbState === "thinking"
            ? 0.5
            : orbState === "speaking"
              ? 1.6
              : 1);
    speedRef.current = THREE.MathUtils.lerp(
      speedRef.current,
      autoRotate ? targetSpeed : 0,
      Math.min(1, dt * 3)
    );
    group.rotation.y += speedRef.current * dt;

    // Voice pulse: the globe breathes while JARVIS speaks/listens.
    const targetScale = 1 + Math.min(0.08, audioAmp * 0.05);
    const s = THREE.MathUtils.lerp(group.scale.x, targetScale, Math.min(1, dt * 8));
    group.scale.setScalar(s);

    // Atmosphere brightens with voice activity.
    const mat = atmosphereRef.current;
    if (mat) {
      const target =
        orbState === "thinking" ? 1.25 : 0.85 + Math.min(0.5, audioAmp * 0.5);
      mat.uniforms.uIntensity.value = THREE.MathUtils.lerp(
        mat.uniforms.uIntensity.value as number,
        target,
        Math.min(1, dt * 4)
      );
    }

    // Clouds drift slightly faster than the surface.
    if (cloudsRef.current && !motionReduced) {
      cloudsRef.current.rotation.y += dt * 0.008;
    }

    // Zoom detail: city labels by camera distance + facing hemisphere.
    const camDist = state.camera.position.length();
    const wantLabels = shouldShowCityLabels(
      camDist,
      showCityLabelsRef.current
    );
    if (wantLabels !== showCityLabelsRef.current) {
      showCityLabelsRef.current = wantLabels;
      setShowCityLabels(wantLabels);
    }
    if (wantLabels) {
      const camDir = tmpCamDir.current
        .copy(state.camera.position)
        .normalize();
      const facing: string[] = [];
      for (const { city, pos } of cityPositions) {
        // World direction: group rotation only (voice pulse scale ~1
        // does not change direction).
        const world = tmpCityPos.current
          .copy(pos)
          .applyAxisAngle(UP_AXIS, group.rotation.y)
          .normalize();
        if (world.dot(camDir) > 0.12) facing.push(city.id);
      }
      if (facing.join(",") !== visibleCityIdsRef.current.join(",")) {
        visibleCityIdsRef.current = facing;
        setVisibleCityIds(facing);
      }
    } else if (visibleCityIdsRef.current.length > 0) {
      visibleCityIdsRef.current = [];
      setVisibleCityIds([]);
    }
  });

  const map = dayTex ?? proceduralDay;

  return (
    <group ref={groupRef}>
      {/* Ambient & directional sun lighting for realistic day/night surface & clouds */}
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 3, 5]} intensity={2.0} />

      {/* Earth sphere */}
      <mesh>
        <sphereGeometry args={[radius, 64, 64]} />
        <meshPhongMaterial
          map={map}
          bumpMap={topoTex ?? undefined}
          bumpScale={topoTex ? 0.03 : 0}
          emissiveMap={dayNight ? nightTex ?? undefined : undefined}
          emissive={dayNight && nightTex ? "#ffffff" : "#000000"}
          emissiveIntensity={dayNight && nightTex ? 0.85 : 0}
          shininess={12}
          specular={new THREE.Color("#1a3a4a")}
        />
      </mesh>

      {/* Graticule lines */}
      <lineSegments geometry={graticuleGeo}>
        <lineBasicMaterial
          color="#67e8f9"
          transparent
          opacity={0.14}
          depthWrite={false}
        />
      </lineSegments>

      {/* Cloud shell */}
      {clouds && (
        <mesh ref={cloudsRef} scale={1.015}>
          <sphereGeometry args={[radius, 48, 48]} />
          <meshLambertMaterial
            map={proceduralClouds}
            transparent
            opacity={0.55}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Neon atmosphere glow */}
      {atmosphere && (
        <mesh scale={1.18}>
          <sphereGeometry args={[radius, 48, 48]} />
          <primitive object={atmosphereMaterial} attach="material" ref={atmosphereRef} />
        </mesh>
      )}

      {/* Markers */}
      {markers.map((marker) => {
        const pos = latLonToVec3(marker.lat, marker.lon, radius * 1.02);
        const size = radius * (marker.size ?? 0.018);
        return (
          <mesh
            key={marker.id}
            position={[pos.x, pos.y, pos.z]}
            onClick={(e) => {
              e.stopPropagation();
              onMarkerClick?.(marker);
            }}
          >
            <sphereGeometry args={[size, 16, 16]} />
            <meshBasicMaterial color={marker.color ?? "#22d3ee"} />
          </mesh>
        );
      })}

      {/* City dots — always on the surface (shared geometry/material) */}
      {cityPositions.map(({ city, pos }) => (
        <mesh
          key={`city-dot-${city.id}`}
          position={[pos.x, pos.y, pos.z]}
          geometry={cityDotGeo}
          material={cityDotMat}
        />
      ))}

      {/* City labels — only when zoomed in, only for facing cities */}
      {showCityLabels &&
        visibleCities.map(({ city, pos }) => (
          <group
            key={`city-label-${city.id}`}
            position={[pos.x, pos.y, pos.z]}
          >
            <Html center zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
              <div
                style={{
                  fontSize: 10,
                  fontFamily: "ui-monospace, monospace",
                  color: "#bae6fd",
                  background: "rgba(2, 12, 24, 0.6)",
                  border: "1px solid rgba(125, 211, 252, 0.35)",
                  borderRadius: 999,
                  padding: "1px 6px",
                  whiteSpace: "nowrap",
                  textShadow: "0 0 6px rgba(56, 189, 248, 0.8)",
                }}
              >
                {city.name}
              </div>
            </Html>
          </group>
        ))}

      {/* Arcs between markers */}
      {arcLines.map(({ arc, line }) => (
        <primitive key={arc.id} object={line} />
      ))}
    </group>
  );
}
