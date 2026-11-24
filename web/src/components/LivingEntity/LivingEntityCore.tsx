/**
 * LIVING ENTITY CORE — Cinematic Volumetric 3D Particle Morphing Engine
 *
 * Built on gobinda-das Simplex Noise morphing technique:
 * - Fluid, organic plasma transitions between 8 true volumetric 3D shapes:
 *   1. Fibonacci Sphere (Golden Living Entity - idle)
 *   2. CPU Die (3D LGA Pins, Silicon Cores, L3 Cache, IHS Lid)
 *   3. Neural Brain (Cortical gyri, sulci, and synaptic lattice)
 *   4. DNA Double Helix (Intertwined sugar backbones & base-pair rungs)
 *   5. Globe (Planetary sphere with continents, parallels & orbit)
 *   6. Cyber Shield (Curved hexagonal defense barrier & security lock)
 *   7. Arc Reactor (Toroidal magnetic coils & plasma vortex)
 *   8. Holo Window (Curved 3D holographic display workspace)
 * - Calibrated pinpoint particles (anti-blowout) for razor-sharp geometric definition.
 * - Tab visibility-aware frameloop for 60fps steady efficiency on integrated GPU.
 * - Interactive click-to-mic dispatch.
 */

import { useRef, useMemo, useEffect, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useStore, type OrbState } from "../../lib/store";
import {
  PARTICLE_COUNT,
  buildAllVolumetricShapes,
  type MorphShapeKey,
} from "./utils/shapeToParticles";
import {
  particleMorphVertexShader,
  particleMorphFragmentShader,
} from "./shaders/particleMorphShaders";
import FloatingHoloHUD from "./FloatingHoloHUD";
import HudRings from "./HudRings";
import EarthGlobe, { GlobeErrorBoundary } from "../Globe/EarthGlobe";
import HoloShapes from "../Globe/HoloShapes";
import {
  GLOBE_ZOOM_MAX_DISTANCE,
  GLOBE_ZOOM_MIN_DISTANCE,
} from "../Globe/cities";
import { getHudTheme, HUD_THEMES } from "../../lib/hudTheme";
import { useReducedMotion } from "../../lib/useReducedMotion";

// ── Color Schemes per Holographic Model ──────────────────────────────────────
const MODEL_COLORS: Record<string, { a: string; b: string }> = {
  cpu:     { a: "#00f2d2", b: "#38bdf8" }, // Cyan & Sky Blue
  neural:  { a: "#c084fc", b: "#f472b6" }, // Synaptic Violet & Pink
  dna:     { a: "#34d399", b: "#38bdf8" }, // Emerald & Ocean Cyan
  globe:   { a: "#38bdf8", b: "#4ade80" }, // Oceanic Blue & Continental Green
  shield:  { a: "#f59e0b", b: "#ef4444" }, // Amber Energy & Crimson Lock
  reactor: { a: "#fbbf24", b: "#f97316" }, // Stark Arc Core & Plasma Orange
  window:  { a: "#22d3ee", b: "#a855f7" }, // Cyber HUD Cyan & Purple
};

function VolumetricMorphMesh({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const { gl, size } = useThree();
  const pointsRef     = useRef<THREE.Points>(null);
  const progressRef   = useRef(1.0);
  const currentKeyRef = useRef<MorphShapeKey>("sphere");
  const targetKeyRef  = useRef<MorphShapeKey>("sphere");
  const morphingRef   = useRef(false);

  // Pre-generate all 8 volumetric 3D mathematical shapes
  const shapes = useMemo(() => buildAllVolumetricShapes(PARTICLE_COUNT), []);

  // Current active positions buffer (source of truth)
  const currentBuffer = useRef<Float32Array>(new Float32Array(shapes.sphere));

  // Build static buffer geometry
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const initPos = shapes.sphere.slice();
    const sizes = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      sizes[i] = 0.5 + Math.random() * 0.7;
    }

    geo.setAttribute("position",        new THREE.BufferAttribute(initPos, 3));
    geo.setAttribute("aPositionTarget", new THREE.BufferAttribute(initPos.slice(), 3));
    geo.setAttribute("aSize",           new THREE.BufferAttribute(sizes, 1));
    geo.setIndex(null);
    return geo;
  }, [shapes]);

  // Shader material
  const material = useMemo(() => {
    const dpr = Math.min(gl.getPixelRatio(), 1.5);
    return new THREE.ShaderMaterial({
      vertexShader:   particleMorphVertexShader,
      fragmentShader: particleMorphFragmentShader,
      blending:       THREE.AdditiveBlending,
      depthWrite:     false,
      transparent:    true,
      uniforms: {
        uSize:       { value: 0.12 },
        uResolution: { value: new THREE.Vector2(size.width * dpr, size.height * dpr) },
        uProgress:   { value: 1.0 },
        uExplode:    { value: 0.0 },
        uColorA:     { value: new THREE.Color(HUD_THEMES.idle.entityColors.a) },
        uColorB:     { value: new THREE.Color(HUD_THEMES.idle.entityColors.b) },
        uTime:       { value: 0 },
      },
    });
  }, [gl, size]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Trigger smooth Simplex Noise morph between shapes
  const triggerMorph = useCallback((toKey: MorphShapeKey) => {
    if (!geometry || !shapes[toKey]) return;
    if (toKey === currentKeyRef.current && !morphingRef.current) return;

    const fromArray = currentBuffer.current;
    const toArray   = shapes[toKey];

    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const tgtAttr = geometry.getAttribute("aPositionTarget") as THREE.BufferAttribute;

    posAttr.copyArray(fromArray);
    tgtAttr.copyArray(toArray);
    posAttr.needsUpdate = true;
    tgtAttr.needsUpdate = true;

    progressRef.current = 0.0;
    morphingRef.current = true;
    targetKeyRef.current = toKey;
  }, [geometry, shapes]);

  // ── Frame Loop ─────────────────────────────────────────────────────────────
  useFrame((state, delta) => {
    if (!material || !geometry) return;
    const dt = Math.min(delta, 0.05);

    // 1. Read JARVIS State
    const store    = useStore.getState();
    const orbState = store.orbState as OrbState;
    const holo     = store.holoState;
    const connected = store.connected;
    const hasTool  = store.tools.some((t) => t.status === "running");

    // 2. Determine target shape key
    let desiredKey: MorphShapeKey = "sphere";
    if (holo.active) {
      const m = holo.modelId as MorphShapeKey;
      desiredKey = shapes[m] ? m : "cpu";
    }

    if (desiredKey !== targetKeyRef.current) {
      triggerMorph(desiredKey);
    }

    // 3. Progress animation (shortened under reducedMotion)
    if (morphingRef.current) {
      progressRef.current += dt / (reducedMotion ? 0.35 : 2.2);
      if (progressRef.current >= 1.0) {
        progressRef.current = 1.0;
        morphingRef.current = false;
        currentKeyRef.current = targetKeyRef.current;
        currentBuffer.current.set(shapes[targetKeyRef.current]);
      }
      material.uniforms.uProgress.value = progressRef.current;
    }

    // 4. Smooth Kinematic Layer Explosion
    const targetExplode = (holo.active ? (holo.explodeLevel || 0) : 0) / 100.0;
    material.uniforms.uExplode.value = THREE.MathUtils.lerp(
      material.uniforms.uExplode.value,
      targetExplode,
      dt * 6.0
    );

    // 5. Dynamic Holographic & Orb Colors
    let targetA = new THREE.Color(HUD_THEMES.idle.entityColors.a);
    let targetB = new THREE.Color(HUD_THEMES.idle.entityColors.b);

    if (holo.active && MODEL_COLORS[holo.modelId]) {
      targetA.set(MODEL_COLORS[holo.modelId].a);
      targetB.set(MODEL_COLORS[holo.modelId].b);
    } else {
      const stateKey = !connected ? "offline"
        : hasTool && orbState === "idle" ? "executing"
        : orbState || "idle";
      const orbScheme = getHudTheme(stateKey).entityColors;
      targetA.set(orbScheme.a);
      targetB.set(orbScheme.b);
    }

    material.uniforms.uColorA.value.lerp(targetA, Math.min(1.0, dt * 4.0));
    material.uniforms.uColorB.value.lerp(targetB, Math.min(1.0, dt * 4.0));

    // 6. Audio-Reactive Pulse (fine pinpoint amplitude)
    let audioAmp = 0;
    const analyser = (window as any).__jarvisTtsAnalyser as AnalyserNode | undefined;
    if (orbState === "speaking" && analyser) {
      const fb = new Uint8Array(64);
      analyser.getByteFrequencyData(fb);
      let sum = 0; for (let i = 2; i < 40; i++) sum += fb[i];
      audioAmp = Math.min(1.0, (sum / 38 / 255) * 2.0);
    } else if (orbState === "speaking") {
      audioAmp = (store.speakerAudioLevel || 0) * 1.5;
    } else if (orbState === "listening") {
      audioAmp = (store.audioLevel || 0) * 1.2;
    }

    material.uniforms.uSize.value = THREE.MathUtils.lerp(
      material.uniforms.uSize.value,
      0.11 + audioAmp * 0.14,
      dt * 8.0
    );

    // 7. Time & Resolution
    material.uniforms.uTime.value = state.clock.getElapsedTime();
    const dpr = Math.min(gl.getPixelRatio(), 1.5);
    material.uniforms.uResolution.value.set(size.width * dpr, size.height * dpr);
  });

  return (
    <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
  );
}

// ── Root Living Entity Component ──────────────────────────────────────────────
export default function LivingEntityCore() {
  const [tabHidden, setTabHidden] = useState(false);
  // If the Earth globe ever fails to render, fall back to the old orb.
  const [globeFailed, setGlobeFailed] = useState(false);
  // Ambient holo shapes around the globe (default OFF for clean, realistic Earth).
  const [holoVisible, setHoloVisible] = useState(false);
  const [holoFailed, setHoloFailed] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const onToggleHolo = () => setHoloVisible((v) => !v);
    window.addEventListener("jarvis:toggle-holo", onToggleHolo);
    return () => window.removeEventListener("jarvis:toggle-holo", onToggleHolo);
  }, []);

  // Tab visibility: pause render loop when tab is hidden
  useEffect(() => {
    const onVisibility = () => {
      setTabHidden(document.hidden);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Pointer-down position, for the click-vs-drag guard below.
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const handlePointerDown = (e: React.PointerEvent) => {
    downPosRef.current = { x: e.clientX, y: e.clientY };
  };

  // Timestamp (ms) of the last globe-marker click, for the click-vs-mic
  // guard in handleEntityClick below.
  const markerClickAtRef = useRef(0);

  // A marker click fires its R3F onClick — and this callback — before the
  // native click bubbles up to the container, so record it here. Markers
  // are 3D meshes, not DOM elements, so no DOM check can spot them.
  const handleMarkerClick = useCallback(() => {
    markerClickAtRef.current = Date.now();
  }, []);

  const handleEntityClick = (e: React.MouseEvent) => {
    // Click on entity toggles microphone — but a drag (rotate) or a
    // scroll-zoom gesture must NOT toggle it. Ignore clicks whose pointer
    // travelled more than a few pixels since pointer-down.
    const d = downPosRef.current;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    // A click on a globe marker (or any interactive globe overlay element)
    // must NOT toggle the mic. HTML overlays (e.g. marker tooltips) are
    // caught by the data-attribute check; 3D mesh markers are caught by
    // the timestamp set in handleMarkerClick just before this bubbles up.
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("[data-globe-marker], [data-globe-interactive]")) return;
    if (Date.now() - markerClickAtRef.current < 300) return;
    window.dispatchEvent(new CustomEvent("jarvis:toggle-mic"));
  };

  return (
    <div
      className="relative w-full h-full overflow-hidden select-none"
      style={{ touchAction: "none" }}
    >
      {/* ── Co-located Entity Canvas & HUD Rings Container (Full Stage Centered) ── */}
      <div
        id="living-entity-container"
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        onClick={handleEntityClick}
        onPointerDown={handlePointerDown}
        title="انقر لتشغيل أو إيقاف المايكروفون (Click to toggle microphone)"
      >
        {/* 3D Volumetric Particle Canvas */}
        <Canvas
          camera={{ position: [4.8, 3.2, 7.2], fov: 42 }}
          dpr={[1, 1.5]}
          frameloop={tabHidden ? "never" : reducedMotion ? "demand" : "always"}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
          }}
          className="w-full h-full block cursor-pointer active:cursor-grabbing"
        >
          {/* Earth globe (centre) — falls back to the old particle orb on failure */}
          {globeFailed ? (
            <VolumetricMorphMesh reducedMotion={reducedMotion} />
          ) : (
            <GlobeErrorBoundary onError={() => setGlobeFailed(true)}>
              <EarthGlobe reducedMotion={reducedMotion} onMarkerClick={handleMarkerClick} />
            </GlobeErrorBoundary>
          )}
          {/* Ambient holo shapes around the globe (not the fallback orb —
              the morph engine already IS the holo layer there). Own error
              boundary so a holo failure hides the layer, never the globe. */}
          {!globeFailed && holoVisible && !holoFailed && (
            <GlobeErrorBoundary onError={() => setHoloFailed(true)}>
              <HoloShapes reducedMotion={reducedMotion} />
            </GlobeErrorBoundary>
          )}
          <OrbitControls
            target={[0, 0, 0]}
            enableZoom
            minDistance={GLOBE_ZOOM_MIN_DISTANCE}
            maxDistance={GLOBE_ZOOM_MAX_DISTANCE}
            zoomSpeed={0.9}
            enablePan={false}
            rotateSpeed={0.65}
            dampingFactor={0.08}
            enableDamping
          />
        </Canvas>

        {/* 2D Precision Tactical HUD Rings — only for fallback particle orb, omitted for clean real Earth */}
        {globeFailed && <HudRings reducedMotion={reducedMotion} />}
      </div>

      {/* Floating Holographic HUD, Telemetry & Subtitle Ribbon */}
      <FloatingHoloHUD />
    </div>
  );
}
