/**
 * HUD BACKDROP — Iron Man Minimal Instrument Grid Layer
 *
 * Sits on z-back behind the particle entity:
 * - Subtle Iron Man tactical coordinate grid with radial mask falloff.
 * - Screen boundary crosshair ticks and corner registration marks.
 * - Zero clutter: NO overlapping gauges over the central sphere.
 * - Single system clock & status readout at lower right edge.
 */

import { useEffect, useState } from "react";
import { useStore } from "../../lib/store";
import { getHudTheme } from "../../lib/hudTheme";

export default function HudBackdrop() {
  const orbState = useStore((s) => s.orbState);
  const connected = useStore((s) => s.connected);
  const [now, setNow] = useState(() => new Date());
  const theme = getHudTheme(orbState);

  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="absolute inset-0 pointer-events-none z-back overflow-hidden select-none"
      aria-hidden="true"
    >
      {/* ── 1. Tactical Sci-Fi Grid with Center Vignette Falloff ──────────────── */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.035) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          WebkitMaskImage:
            "radial-gradient(ellipse 75% 75% at 50% 50%, #000 20%, transparent 80%)",
          maskImage:
            "radial-gradient(ellipse 75% 75% at 50% 50%, #000 20%, transparent 80%)",
        }}
      />

      {/* ── 2. Screen Outer Registration Brackets ────────────────────────────── */}
      <b className="absolute top-2.5 left-2.5 w-4 h-4 border-t border-l border-cyan-400/30" />
      <b className="absolute top-2.5 right-2.5 w-4 h-4 border-t border-r border-cyan-400/30" />
      <b className="absolute bottom-2.5 left-2.5 w-4 h-4 border-b border-l border-cyan-400/30" />
      <b className="absolute bottom-2.5 right-2.5 w-4 h-4 border-b border-r border-cyan-400/30" />

      {/* ── 3. Subtle Edge Crosshair Compass Ticks ───────────────────────────── */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[1px] bg-cyan-400/25" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[1px] bg-cyan-400/25" />
      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[1px] h-8 bg-cyan-400/25" />
      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[1px] h-8 bg-cyan-400/25" />

      {/* ── 4. System Clock & Link Telemetry (Bottom Right Edge) ─────────────── */}
      <div className="absolute bottom-2.5 right-6 text-[9px] font-mono tracking-[0.25em] text-cyan-400/50 flex items-center gap-2">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            backgroundColor: connected ? theme.accentColor : "#ef4444",
            boxShadow: connected
              ? `0 0 ${Math.round(8 * theme.glowStrength)}px ${theme.accentColor}`
              : "0 0 4px #ef4444",
          }}
        />
        <span>SYS {now.toLocaleTimeString("en-GB")}</span>
        <span className="text-cyan-500/30">|</span>
        <span className="uppercase" style={{ color: theme.accentColor }}>
          {theme.name}
        </span>
      </div>
    </div>
  );
}
