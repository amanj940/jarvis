/**
 * HUD RINGS — Precision 2D Tactical Instrument Rings (Iron Man Style)
 *
 * Sits at z-rings layer (z: 15) centered directly on the 3D entity core.
 * Radii sit cleanly outside the volumetric entity's silhouette:
 * 1. Precision Tick Ring (72 angular compass ticks, rotating clockwise)
 * 2. Segmented Tactical Arc Ring (counter-rotating with dash gaps)
 * 3. Gold Stark Arc Accent (curved metallic accent at r=250)
 * 4. Radar Crosshair Cardinal Marks
 *
 * Rotational speeds and colors react dynamically to orbState via getHudTheme.
 */

import { useMemo } from "react";
import { useStore } from "../../lib/store";
import { getHudTheme } from "../../lib/hudTheme";

export default function HudRings({
  reducedMotion = false,
}: {
  reducedMotion?: boolean;
}) {
  const orbState = useStore((s) => s.orbState);
  const theme = getHudTheme(orbState);

  // Compute rotation duration based on theme.ringSpeedMultiplier
  const mult = theme.ringSpeedMultiplier;
  const isStopped = reducedMotion || mult <= 0.05;
  const cwDuration = mult > 0 ? (36 / mult).toFixed(1) + "s" : "0s";
  const ccwDuration = mult > 0 ? (48 / mult).toFixed(1) + "s" : "0s";
  const goldDuration = mult > 0 ? (60 / mult).toFixed(1) + "s" : "0s";

  // Generate 72 radial compass ticks (every 5 degrees)
  const ticks = useMemo(() => {
    const list: { angle: number; isMajor: boolean }[] = [];
    for (let i = 0; i < 72; i++) {
      list.push({ angle: i * 5, isMajor: i % 6 === 0 });
    }
    return list;
  }, []);

  return (
    <div
      className="absolute inset-0 pointer-events-none z-rings flex items-center justify-center overflow-hidden select-none"
      aria-hidden="true"
    >
      <svg
        viewBox="-300 -300 600 600"
        className="w-full h-full max-h-[82vh] aspect-square transition-all duration-700 ease-in-out"
      >
        <defs>
          <style>{`
            @keyframes hudSpinClockwise {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
            @keyframes hudSpinCounter {
              from { transform: rotate(360deg); }
              to { transform: rotate(0deg); }
            }
          `}</style>
        </defs>

        {/* ── 1. TICK RING (r=215) — Clockwise Compass Radar Ticks ──────────── */}
        <g
          style={{
            transformOrigin: "0px 0px",
            animation: isStopped ? "none" : `hudSpinClockwise ${cwDuration} linear infinite`,
          }}
        >
          {ticks.map((t) => (
            <line
              key={t.angle}
              x1={0}
              y1={t.isMajor ? 208 : 212}
              x2={0}
              y2={218}
              stroke={theme.accentColor}
              strokeWidth={t.isMajor ? 1.5 : 0.8}
              strokeOpacity={t.isMajor ? 0.5 : 0.22}
              transform={`rotate(${t.angle})`}
            />
          ))}

          {/* Faint concentric guide ring */}
          <circle
            r={218}
            fill="none"
            stroke={theme.accentColor}
            strokeWidth={0.75}
            strokeOpacity={0.2}
          />
        </g>

        {/* ── 2. SEGMENTED ARC RING (r=235) — Counter-Rotating Arcs ─────────── */}
        <g
          style={{
            transformOrigin: "0px 0px",
            animation: isStopped ? "none" : `hudSpinCounter ${ccwDuration} linear infinite`,
          }}
        >
          <circle
            r={235}
            fill="none"
            stroke={theme.accentColor}
            strokeWidth={1.5}
            strokeOpacity={0.35}
            strokeDasharray="140 45"
            strokeLinecap="round"
          />
          <circle
            r={238}
            fill="none"
            stroke={theme.accentColor}
            strokeWidth={0.5}
            strokeOpacity={0.18}
            strokeDasharray="4 8"
          />
        </g>

        {/* ── 3. GOLD ACCENT ARC (r=252) — Stark Arc Reactor Metallic Touch ──── */}
        <g
          style={{
            transformOrigin: "0px 0px",
            animation: isStopped ? "none" : `hudSpinClockwise ${goldDuration} linear infinite`,
          }}
        >
          <circle
            r={252}
            fill="none"
            stroke="#e8b86a"
            strokeWidth={1.8}
            strokeOpacity={0.65}
            strokeDasharray="80 710"
            strokeLinecap="round"
            style={{
              filter: "drop-shadow(0 0 4px rgba(232, 184, 106, 0.4))",
            }}
          />
          <circle
            r={252}
            fill="none"
            stroke="#e8b86a"
            strokeWidth={1.2}
            strokeOpacity={0.4}
            strokeDasharray="40 750"
            strokeDashoffset={-400}
            strokeLinecap="round"
          />
        </g>

        {/* ── 4. CARDINAL RADAR TICKS (Static Orientation Marks) ────────────── */}
        <g stroke={theme.accentColor} strokeOpacity={0.4} strokeWidth={1}>
          {/* Top */}
          <line x1={0} y1={-260} x2={0} y2={-272} />
          {/* Bottom */}
          <line x1={0} y1={260} x2={0} y2={272} />
          {/* Left */}
          <line x1={-260} y1={0} x2={-272} y2={0} />
          {/* Right */}
          <line x1={260} y1={0} x2={272} y2={0} />
        </g>
      </svg>
    </div>
  );
}
