/**
 * HUD CONNECTOR LINES — Iron Man Tactical Ray Overlay
 *
 * Renders thin dashed SVG connector lines from each visible HUD data panel's
 * inner edge toward the central particle entity core / HUD rings.
 *
 * Specifications:
 * - Thin dashed cyan lines (#22d3ee), ~0.3 opacity.
 * - Slow continuous dash animation.
 * - getBoundingClientRect + ResizeObserver coordinate calculation.
 * - Auto-recomputes on window resize, EngineeringMonitor toggle, and layout shifts.
 * - pointer-events: none, z-rings layer (z: 15).
 * - Hidden below 1280px viewport width (hidden xl:block).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useStore } from "../../lib/store";

interface LineCoords {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export default function HudConnectorLines({
  reducedMotion = false,
}: {
  reducedMotion?: boolean;
}) {
  const monitorOpen = useStore((s) => s.monitorOpen);
  const holoActive = useStore((s) => s.holoState.active);
  const modelId = useStore((s) => s.holoState.modelId);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [lines, setLines] = useState<LineCoords[]>([]);

  const recompute = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (window.innerWidth < 1280) {
      setLines((prev) => (prev.length > 0 ? [] : prev));
      return;
    }

    const svgRect = svg.getBoundingClientRect();
    if (svgRect.width <= 0 || svgRect.height <= 0) return;

    // Entity stage center
    const entityEl =
      document.getElementById("living-entity-container") ||
      document.getElementById("living-entity-stage");
    if (!entityEl) return;
    const entityRect = entityEl.getBoundingClientRect();
    const entityCenterX = entityRect.left + entityRect.width / 2 - svgRect.left;
    const entityCenterY = entityRect.top + entityRect.height / 2 - svgRect.top;

    // Query all visible HUD panels marked with data-hud-panel="true"
    const panelEls = Array.from(
      document.querySelectorAll<HTMLElement>("[data-hud-panel='true']")
    );

    const nextLines: LineCoords[] = [];

    for (const panel of panelEls) {
      if (panel.offsetParent === null) continue;
      const rect = panel.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      // Ensure panel is within the svg bounds
      if (
        rect.bottom < svgRect.top ||
        rect.top > svgRect.bottom ||
        rect.right < svgRect.left ||
        rect.left > svgRect.right
      ) {
        continue;
      }

      // Inner edge: if to the left of the entity center, inner edge is right; else left
      const isLeft = rect.left + rect.width / 2 < entityRect.left + entityRect.width / 2;
      const startX = isLeft ? rect.right - svgRect.left : rect.left - svgRect.left;
      const startY = rect.top + rect.height / 2 - svgRect.top;

      const id = panel.getAttribute("data-panel-id") || `${Math.round(startX)}_${Math.round(startY)}`;
      nextLines.push({
        id,
        x1: Math.round(startX),
        y1: Math.round(startY),
        x2: Math.round(entityCenterX),
        y2: Math.round(entityCenterY),
      });
    }

    setLines(nextLines);
  }, []);

  useEffect(() => {
    recompute();

    window.addEventListener("resize", recompute);

    const entityEl = document.getElementById("living-entity-stage");
    const parentEl = svgRef.current?.parentElement;

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        recompute();
      });
      if (entityEl) ro.observe(entityEl);
      if (parentEl) ro.observe(parentEl);
    }

    // Tick over 700ms CSS flex transition
    const t1 = setTimeout(recompute, 100);
    const t2 = setTimeout(recompute, 350);
    const t3 = setTimeout(recompute, 750);

    return () => {
      window.removeEventListener("resize", recompute);
      if (ro) ro.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [recompute, monitorOpen, holoActive, modelId]);

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 pointer-events-none z-rings w-full h-full hidden xl:block overflow-hidden"
      aria-hidden="true"
    >
      <defs>
        <style>{`
          @keyframes hudDashTravel {
            to {
              stroke-dashoffset: -28;
            }
          }
          .hud-connector-dashed {
            stroke-dasharray: 5 5;
            animation: hudDashTravel 3.5s linear infinite;
          }
        `}</style>
      </defs>

      {lines.map((l) => (
        <g key={l.id}>
          {/* Subtle panel edge anchor dot */}
          <circle cx={l.x1} cy={l.y1} r={2.5} fill="#22d3ee" fillOpacity={0.6} />

          {/* Thin dashed connector line */}
          <line
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke="#22d3ee"
            strokeWidth={1}
            strokeOpacity={0.3}
            className={reducedMotion ? "" : "hud-connector-dashed"}
            strokeDasharray={reducedMotion ? "5 5" : undefined}
          />
        </g>
      ))}
    </svg>
  );
}
