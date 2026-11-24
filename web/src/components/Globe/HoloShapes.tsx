/**
 * HOLO SHAPES — ambient holographic layer around the Earth globe.
 *
 * The old particle morph engine (VolumetricMorphMesh in LivingEntityCore)
 * is only a fallback now — it renders when the globe fails. This is the
 * lightweight replacement that lives ALONGSIDE the globe: two thin neon
 * orbit rings + a faint wireframe icosahedron shell, all additive and
 * transparent so they never hide the continents.
 *
 * Cheap by design (weak laptop):
 * - 3 meshes total, shared geometries/materials, no textures, no new deps.
 * - Rotation + voice pulse mutate refs/materials inside useFrame — zero
 *   React re-renders per frame.
 * - Respects reducedMotion (renders static) and the tab-hidden frameloop
 *   (the Canvas pauses useFrame when hidden).
 *
 * Globe radius is 1.9 and the atmosphere shell sits at ~1.18x, so the holo
 * shapes orbit just outside it (2.45–2.78). Toggle with a
 * `jarvis:toggle-holo` window event (see LivingEntityCore).
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../../lib/store";

const HOLO_CYAN = "#22d3ee";
const HOLO_VIOLET = "#a855f7";

// Radii sit just outside the globe (1.9) + atmosphere shell (~2.24).
const RING_RADIUS = 2.55;
const ORBIT_RADIUS = 2.78;
const SHELL_RADIUS = 2.45;

export default function HoloShapes({
  reducedMotion = false,
}: {
  reducedMotion?: boolean;
}) {
  const ringsRef = useRef<THREE.Group>(null);
  const shellRef = useRef<THREE.Mesh>(null);

  // One shared geometry/material per shape — created once, disposed once.
  const geos = useMemo(
    () => ({
      ring: new THREE.TorusGeometry(RING_RADIUS, 0.008, 8, 128),
      orbit: new THREE.TorusGeometry(ORBIT_RADIUS, 0.006, 8, 128),
      shell: new THREE.IcosahedronGeometry(SHELL_RADIUS, 1),
    }),
    []
  );
  const mats = useMemo(
    () => ({
      ring: new THREE.MeshBasicMaterial({
        color: HOLO_CYAN,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      orbit: new THREE.MeshBasicMaterial({
        color: HOLO_VIOLET,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      shell: new THREE.MeshBasicMaterial({
        color: HOLO_CYAN,
        wireframe: true,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    }),
    []
  );

  useEffect(
    () => () => {
      Object.values(geos).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
    [geos, mats]
  );

  // Slow orbit + subtle voice reactivity (refs only, no React state).
  useFrame((state, delta) => {
    if (reducedMotion) return;
    const dt = Math.min(delta, 0.05);
    const t = state.clock.getElapsedTime();
    const orbState = useStore.getState().orbState;
    const active = orbState === "speaking" || orbState === "listening";
    const speed = active ? 1.8 : 1;

    if (ringsRef.current) {
      ringsRef.current.rotation.y += dt * 0.05 * speed;
      // Gentle tilt wobble so the rings feel alive, not rigid.
      ringsRef.current.rotation.z = Math.sin(t * 0.15) * 0.03;
    }
    if (shellRef.current) {
      shellRef.current.rotation.y -= dt * 0.03 * speed;
      shellRef.current.rotation.x += dt * 0.012 * speed;
    }
    // Breathe a little brighter while Jarvis speaks/listens.
    const pulse = active ? 0.85 + Math.sin(t * 3) * 0.15 : 1;
    mats.ring.opacity = 0.4 * pulse;
    mats.orbit.opacity = 0.28 * pulse;
  });

  return (
    <group>
      <group ref={ringsRef}>
        {/* Equatorial ring — near-flat, slight tilt */}
        <mesh
          geometry={geos.ring}
          material={mats.ring}
          rotation={[Math.PI / 2.15, 0, 0.12]}
        />
        {/* Inclined orbit ring — crossing the equator at an angle */}
        <mesh
          geometry={geos.orbit}
          material={mats.orbit}
          rotation={[Math.PI / 3, 0.4, 0]}
        />
      </group>
      {/* Faint wireframe shell enclosing the globe */}
      <mesh ref={shellRef} geometry={geos.shell} material={mats.shell} />
    </group>
  );
}
