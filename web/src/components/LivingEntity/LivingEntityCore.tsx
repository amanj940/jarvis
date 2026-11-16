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
import { getHudTheme, HUD_THEMES } from "../../lib/hudTheme";

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

function VolumetricMorphMesh() {
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

    // 3. Progress animation (2.2s fluid transition)
    if (morphingRef.current) {
      progressRef.current += dt / 2.2;
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

// ── Cinematic Orbital HUD Rings (Pure Visual) ─────────────────────────────────
function OrbitalRings() {
  const r1 = useRef<THREE.LineLoop>(null);
  const r2 = useRef<THREE.LineLoop>(null);

  const { g1, g2 } = useMemo(() => {
    const pts = (r: number, n = 72) => {
      const p: THREE.Vector3[] = [];
      for (let i = 0; i < n; i++) {
        const th = (i / n) * Math.PI * 2;
        p.push(new THREE.Vector3(r * Math.cos(th), 0, r * Math.sin(th)));
      }
      return new THREE.BufferGeometry().setFromPoints(p);
    };
    return { g1: pts(3.2), g2: pts(3.6) };
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const { orbState, holoState } = useStore.getState();
    const theme = getHudTheme(orbState);
    const speed = theme.ringSpeedMultiplier;
    const opacityTarget = holoState.active ? 0.06 : 0.14;

    if (r1.current) {
      r1.current.rotation.y += dt * speed;
      r1.current.rotation.x = 0.22;
      (r1.current.material as THREE.LineBasicMaterial).opacity = opacityTarget;
    }
    if (r2.current) {
      r2.current.rotation.y -= dt * speed * 0.65;
      r2.current.rotation.z = 0.14;
      (r2.current.material as THREE.LineBasicMaterial).opacity = opacityTarget * 0.75;
    }
  });

  return (
    <group>
      <lineLoop ref={r1} geometry={g1}>
        <lineBasicMaterial color="#22d3ee" transparent opacity={0.14} />
      </lineLoop>
      <lineLoop ref={r2} geometry={g2}>
        <lineBasicMaterial color="#e8b86a" transparent opacity={0.10} />
      </lineLoop>
    </group>
  );
}

// ── Root Living Entity Component ──────────────────────────────────────────────
export default function LivingEntityCore() {
  const [tabHidden, setTabHidden] = useState(false);

  // Tab visibility: pause render loop when tab is hidden
  useEffect(() => {
    const onVisibility = () => {
      setTabHidden(document.hidden);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const handleEntityClick = () => {
    // Click on entity toggles microphone
    window.dispatchEvent(new CustomEvent("jarvis:toggle-mic"));
  };

  return (
    <div
      className="relative w-full h-full overflow-hidden select-none"
      style={{ touchAction: "none" }}
      onClick={handleEntityClick}
      title="انقر لتشغيل أو إيقاف المايكروفون (Click to toggle microphone)"
    >
      {/* 3D Volumetric Particle Canvas */}
      <Canvas
        camera={{ position: [4.8, 3.2, 7.2], fov: 42 }}
        dpr={[1, 1.5]}
        frameloop={tabHidden ? "never" : "always"}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
        className="w-full h-full block cursor-pointer active:cursor-grabbing"
      >
        <VolumetricMorphMesh />
        <OrbitalRings />
        <OrbitControls
          target={[0, 0, 0]}
          enableZoom={false}
          enablePan={false}
          rotateSpeed={0.65}
          dampingFactor={0.08}
          enableDamping
        />
      </Canvas>

      {/* Floating Holographic HUD, Telemetry & Subtitle Ribbon */}
      <FloatingHoloHUD />
    </div>
  );
}
