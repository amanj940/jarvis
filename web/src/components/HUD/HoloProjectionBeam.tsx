/**
 * HoloProjectionBeam — Iron Man Holographic Laser Ray Projector
 *
 * Renders glowing cyan projection rays originating from the central 3D core
 * (screen center) to the active holographic windows (YouTube, Browser).
 * - Only renders rays to windows that are actually open and visible.
 * - Dynamically tracks window positions in real-time.
 * - Animated dashed laser effect with gradient glow and endpoint emitter flares.
 * - Respects useReducedMotion.
 */
import { useEffect, useState } from "react";
import { useReducedMotion } from "../../lib/useReducedMotion";
import { useStore } from "../../lib/store";

export interface ProjectionTarget {
  id: string;
  x: number;
  y: number;
}

interface HoloProjectionBeamProps {
  targets: ProjectionTarget[];
}

export default function HoloProjectionBeam({ targets }: HoloProjectionBeamProps) {
  const reducedMotion = useReducedMotion();
  const orbState = useStore((s) => s.orbState);

  // Viewport dimensions for center calculations
  const [dimensions, setDimensions] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1920,
    height: typeof window !== "undefined" ? window.innerHeight : 1080,
  }));

  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const coreX = dimensions.width / 2;
  const coreY = dimensions.height / 2;

  // Filter valid targets
  const validTargets = targets.filter((t) => t && typeof t.x === "number" && typeof t.y === "number");

  if (validTargets.length === 0) return null;

  // State-aware beam colors
  const beamColor =
    orbState === "thinking"
      ? "#a78bfa"
      : orbState === "speaking"
      ? "#60a5fa"
      : orbState === "listening"
      ? "#34d399"
      : "#38bdf8";

  return (
    <svg
      className="fixed inset-0 pointer-events-none select-none w-full h-full overflow-visible"
      style={{ zIndex: 15 }} // z-rings tier
    >
      <defs>
        <filter id="laserBeamGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {validTargets.map((win) => {
          const gradId = `beamGrad_${win.id}`;
          return (
            <linearGradient key={gradId} id={gradId} gradientUnits="userSpaceOnUse" x1={coreX} y1={coreY} x2={win.x + 24} y2={win.y + 20}>
              <stop offset="0%" stopColor={beamColor} stopOpacity="0.85" />
              <stop offset="40%" stopColor={beamColor} stopOpacity="0.45" />
              <stop offset="100%" stopColor={beamColor} stopOpacity="0.80" />
            </linearGradient>
          );
        })}
      </defs>

      {/* Central Emitter Flare at core */}
      <circle
        cx={coreX}
        cy={coreY}
        r={7}
        fill="none"
        stroke={beamColor}
        strokeWidth="1.5"
        opacity="0.6"
        className={reducedMotion ? "" : "animate-ping"}
      />
      <circle cx={coreX} cy={coreY} r={3} fill={beamColor} opacity="0.9" filter="url(#laserBeamGlow)" />

      {/* Render beam lines to each active target */}
      {validTargets.map((win) => {
        const targetX = win.x + 24;
        const targetY = win.y + 20;
        const gradId = `url(#beamGrad_${win.id})`;

        return (
          <g key={win.id}>
            {/* Soft Ambient Glow Line */}
            <line
              x1={coreX}
              y1={coreY}
              x2={targetX}
              y2={targetY}
              stroke={beamColor}
              strokeWidth="4"
              opacity="0.15"
              filter="url(#laserBeamGlow)"
            />

            {/* Core Focused Laser Line */}
            <line
              x1={coreX}
              y1={coreY}
              x2={targetX}
              y2={targetY}
              stroke={gradId}
              strokeWidth="1.5"
              strokeDasharray="6 8"
              style={{
                animation: reducedMotion ? "none" : "laserRayFlow 1.8s linear infinite",
              }}
            />

            {/* Target Window Reception Node */}
            <circle
              cx={targetX}
              cy={targetY}
              r={4}
              fill={beamColor}
              opacity="0.85"
              filter="url(#laserBeamGlow)"
            />
            <circle
              cx={targetX}
              cy={targetY}
              r={8}
              fill="none"
              stroke={beamColor}
              strokeWidth="1"
              opacity="0.5"
              strokeDasharray="2 3"
            />
          </g>
        );
      })}

      <style>{`
        @keyframes laserRayFlow {
          from { stroke-dashoffset: 0; }
          to   { stroke-dashoffset: -28; }
        }
      `}</style>
    </svg>
  );
}
