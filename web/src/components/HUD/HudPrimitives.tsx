/**
 * HUD PRIMITIVES — Unified Iron Man / Sci-Fi Instrumented Components
 *
 * Single source of truth for:
 *   - HudCornerBrackets: Machined corner tick marks (.mviz b.k)
 *   - HudBeamHairline: Swept gradient top hairline
 *   - HudGauge: High-precision SVG circular instrument gauge
 *   - HudHist: Live measured data distribution histogram bars
 *   - HudPanel: Standard instrumented card with collapsible & pin state
 */

import React, { useState, useEffect } from "react";

// ── 1. Machined Corner Brackets ──────────────────────────────────────────────
export function HudCornerBrackets({
  color = "rgba(34, 211, 238, 0.45)",
  size = 10,
}: {
  color?: string;
  size?: number;
}) {
  const s = `${size}px`;
  return (
    <>
      <b
        className="k tl"
        style={{
          borderColor: color,
          width: s,
          height: s,
          position: "absolute",
          top: "4px",
          left: "4px",
          borderTopWidth: "1.5px",
          borderLeftWidth: "1.5px",
          pointerEvents: "none",
          zIndex: 2,
        }}
      />
      <b
        className="k tr"
        style={{
          borderColor: color,
          width: s,
          height: s,
          position: "absolute",
          top: "4px",
          right: "4px",
          borderTopWidth: "1.5px",
          borderRightWidth: "1.5px",
          pointerEvents: "none",
          zIndex: 2,
        }}
      />
      <b
        className="k bl"
        style={{
          borderColor: color,
          width: s,
          height: s,
          position: "absolute",
          bottom: "4px",
          left: "4px",
          borderBottomWidth: "1.5px",
          borderLeftWidth: "1.5px",
          pointerEvents: "none",
          zIndex: 2,
        }}
      />
      <b
        className="k br"
        style={{
          borderColor: color,
          width: s,
          height: s,
          position: "absolute",
          bottom: "4px",
          right: "4px",
          borderBottomWidth: "1.5px",
          borderRightWidth: "1.5px",
          pointerEvents: "none",
          zIndex: 2,
        }}
      />
    </>
  );
}

// ── 2. Top Edge Particle Beam Hairline ────────────────────────────────────────
export function HudBeamHairline({
  color = "rgba(56, 189, 248, 0.75)",
}: {
  color?: string;
}) {
  return (
    <div
      className="hud-beam-hairline"
      style={{
        background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
      }}
    />
  );
}

// ── 3. High-Precision Circular Instrument Gauge ──────────────────────────────
export function HudGauge({
  label,
  value,
  unit = "%",
  color = "#22d3ee",
  size = 60,
  strokeWidth = 3,
  onClick,
  title,
}: {
  label: string;
  value: number | "N/A";
  unit?: string;
  color?: string;
  size?: number;
  strokeWidth?: number;
  onClick?: () => void;
  title?: string;
}) {
  const r = size / 2 - strokeWidth - 2;
  const circ = 2 * Math.PI * r;
  const numVal = typeof value === "number" ? Math.max(0, Math.min(100, value)) : 0;
  const dashOffset = circ - (circ * numVal) / 100;

  return (
    <div
      onClick={(e) => {
        if (onClick) {
          e.stopPropagation();
          onClick();
        }
      }}
      className={`flex flex-col items-center gap-1.5 ${
        onClick ? "cursor-pointer group hover:opacity-100 transition" : ""
      }`}
      title={title || `${label}: ${value}${typeof value === "number" ? unit : ""}`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgba(34,211,238,0.12)"
            strokeWidth={strokeWidth}
          />
          {/* Active Arc */}
          {typeof value === "number" && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeDasharray={circ}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              style={{
                transition: "stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
                filter: `drop-shadow(0 0 5px ${color})`,
              }}
            />
          )}
        </svg>

        {/* Center Readout */}
        <div className="absolute inset-0 flex items-center justify-center font-mono">
          <bdi
            className="text-[11px] font-bold tracking-tight"
            style={{ color: typeof value === "number" ? "#f0f9ff" : "#64748b" }}
          >
            {typeof value === "number" ? `${Math.round(value)}${unit}` : "N/A"}
          </bdi>
        </div>
      </div>

      <span
        className="text-[9px] font-mono tracking-widest uppercase transition-colors"
        style={{ color: typeof value === "number" ? `${color}cc` : "#64748bcc" }}
      >
        {label}
      </span>
    </div>
  );
}

// ── 4. Live Activity Distribution Histogram Bars ──────────────────────────────
export function HudHist({
  levels,
  color = "#22d3ee",
  label = "FLUX:",
}: {
  levels: number[];
  color?: string;
  label?: string;
}) {
  return (
    <div className="flex items-end gap-1.5 h-4 pt-1 border-t border-cyan-500/15">
      {label && (
        <span className="text-[8px] font-mono text-slate-500 uppercase mr-1 select-none">
          {label}
        </span>
      )}
      {levels.map((lvl, idx) => (
        <div
          key={idx}
          className="flex-1 rounded-xs transition-all duration-500"
          style={{
            height: `${Math.max(15, Math.min(100, lvl))}%`,
            backgroundColor: color,
            opacity: 0.35 + (lvl / 100) * 0.65,
            boxShadow: `0 0 4px ${color}40`,
          }}
        />
      ))}
    </div>
  );
}

// ── 5. Standard Instrumented HUD Panel Card ───────────────────────────────────
export interface HudPanelProps {
  id?: string;
  title: string;
  subtitle?: string;
  statLabel?: string;
  statVal?: string | React.ReactNode;
  color?: string;
  histLevels?: number[];
  collapsible?: boolean;
  defaultOpen?: boolean;
  onExpand?: () => void;
  className?: string;
  children?: React.ReactNode;
}

export function HudPanel({
  id,
  title,
  subtitle,
  statLabel,
  statVal,
  color = "#22d3ee",
  histLevels,
  collapsible = false,
  defaultOpen = true,
  onExpand,
  className = "",
  children,
}: HudPanelProps) {
  const storageKey = id ? `jarvis_hud_${id}_open` : null;

  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (!collapsible || !storageKey) return defaultOpen;
    try {
      const saved = localStorage.getItem(storageKey);
      return saved !== null ? saved === "1" : defaultOpen;
    } catch {
      return defaultOpen;
    }
  });

  const toggle = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!collapsible) return;
    const next = !isOpen;
    setIsOpen(next);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* noop */
      }
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`hud-corner-box relative p-3.5 rounded-lg border border-cyan-500/25 shadow-[0_16px_40px_rgba(0,0,0,0.65)] backdrop-blur-2xl transition-all duration-300 hover:border-cyan-400/50 ${className}`}
      style={{
        background:
          "linear-gradient(158deg, rgba(12, 18, 30, 0.92) 0%, rgba(3, 7, 14, 0.96) 100%)",
        boxShadow: `0 0 20px ${color}15, inset 0 1px 0 rgba(196, 228, 255, 0.12)`,
      }}
    >
      {/* Top Beam Hairline */}
      <HudBeamHairline color={`${color}bb`} />

      {/* Machined Corner Brackets */}
      <HudCornerBrackets color={`${color}88`} />

      {/* Eyebrow Header */}
      <div className="flex items-center gap-2 mb-1.5 select-none">
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse"
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
        />
        <span
          className="text-[10px] font-mono tracking-widest font-bold uppercase truncate"
          style={{ color }}
        >
          {title}
        </span>
        <div className="hud-ruler-track flex-1" />

        {collapsible && (
          <button
            onClick={toggle}
            className="text-[9px] font-mono text-cyan-400/70 hover:text-cyan-200 px-1 transition cursor-pointer"
            title={isOpen ? "طي اللوحة" : "توسيع اللوحة"}
          >
            {isOpen ? "▾" : "▸"}
          </button>
        )}
      </div>

      {/* Collapsible Content */}
      {isOpen && (
        <div className="space-y-2 pt-0.5">
          {subtitle && (
            <div className="text-xs text-slate-200 font-semibold truncate">
              {subtitle}
            </div>
          )}

          {statLabel && statVal && (
            <div className="flex items-center justify-between text-[11px] font-mono bg-cyan-950/40 px-2.5 py-1.5 rounded border border-cyan-500/20">
              <span className="text-slate-400 tracking-wider text-[10px] uppercase">
                {statLabel}
              </span>
              <bdi className="font-bold tracking-wide" style={{ color }}>
                {statVal}
              </bdi>
            </div>
          )}

          {children}

          {histLevels && histLevels.length > 0 && (
            <HudHist levels={histLevels} color={color} />
          )}
        </div>
      )}
    </div>
  );
}
