import React, { useState, useRef, useEffect, useMemo } from "react";
import { useStore } from "../../../lib/store";
import { HudPanel } from "../HudPrimitives";
import { useReducedMotion } from "../../../lib/useReducedMotion";

interface LiveActivityPanelProps {
  filterFailedOnly?: boolean;
  forceCollapsed?: boolean;
}

export default function LiveActivityPanel({
  filterFailedOnly = false,
  forceCollapsed = false,
}: LiveActivityPanelProps) {
  const tools = useStore((s) => s.tools);
  const reducedMotion = useReducedMotion();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Last 12 entries, oldest to newest (top to bottom)
  const displayTools = useMemo(() => {
    let list = tools;
    if (filterFailedOnly) {
      list = list.filter((t) => t.status === "fail" || t.status === "denied");
    }
    return list.slice(-12);
  }, [tools, filterFailedOnly]);

  // Bottom-anchored auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displayTools.length, displayTools]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <HudPanel
      id="live_activity"
      title="LIVE ACTIVITY"
      subtitle={filterFailedOnly ? "STREAM · FAILED FILTER ACTIVE" : "AGENT DISPATCH STREAM"}
      color="#22d3ee"
      collapsible={true}
      defaultOpen={!forceCollapsed}
      pinnable={true}
    >
      <div
        ref={scrollRef}
        className="w-full flex flex-col gap-1.5 max-h-48 overflow-y-auto font-mono text-[11px] pr-1"
        style={{ scrollbarWidth: "thin" }}
      >
        {displayTools.length === 0 ? (
          <div className="py-6 text-center text-slate-500 flex flex-col items-center justify-center gap-1.5 select-none">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/40 animate-pulse" />
            <span className="text-[10px] tracking-widest uppercase">STANDBY — no activity</span>
          </div>
        ) : (
          displayTools.map((t) => {
            const isExpanded = expandedId === t.id;
            const timeStr = new Date(t.ts).toTimeString().split(" ")[0]; // HH:MM:SS
            const previewTrunc = t.preview
              ? t.preview.length > 80
                ? t.preview.slice(0, 80) + "…"
                : t.preview
              : "N/A";

            // Color language: cyan = proposed, amber = running, green = success (ok), red = failed/threat
            let statusGlyph = "○";
            let statusColor = "text-cyan-400";
            let borderColor = "border-cyan-500/20";
            let bgColor = "bg-slate-900/40";

            if (t.status === "running") {
              statusGlyph = "▶";
              statusColor = "text-amber-400";
              borderColor = "border-amber-500/40";
              bgColor = "bg-amber-950/20";
            } else if (t.status === "ok") {
              statusGlyph = "✓";
              statusColor = "text-emerald-400";
              borderColor = "border-emerald-500/30";
              bgColor = "bg-emerald-950/15";
            } else if (t.status === "fail" || t.status === "denied") {
              statusGlyph = "✕";
              statusColor = "text-rose-400";
              borderColor = "border-rose-500/40";
              bgColor = "bg-rose-950/20";
            }

            return (
              <div
                key={t.id}
                onClick={() => toggleExpand(t.id)}
                className={`flex flex-col border rounded p-1.5 cursor-pointer transition-all ${borderColor} ${bgColor} hover:border-cyan-400/50 ${
                  reducedMotion ? "" : "animate-fadeIn"
                }`}
              >
                {/* Header line: HH:MM:SS, tool name, status glyph */}
                <div className="flex items-center justify-between gap-1 text-[10px]">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-slate-500 select-none">{timeStr}</span>
                    <span className="text-cyan-300 font-semibold truncate uppercase">
                      {t.tool || "tool"}
                    </span>
                  </div>
                  <span className={`flex items-center gap-1 font-bold ${statusColor}`}>
                    {statusGlyph}
                    {t.status === "running" && (
                      <span className="inline-block w-1.5 h-3 bg-amber-400 animate-pulse" />
                    )}
                  </span>
                </div>

                {/* Preview text */}
                <div className="text-[10px] text-slate-300 truncate mt-0.5" title={t.preview}>
                  {previewTrunc}
                </div>

                {/* Expanded details (args & result, plain text nodes only, max 400 chars) */}
                {isExpanded && (
                  <div className="mt-2 pt-1.5 border-t border-slate-700/60 flex flex-col gap-1 text-[10px] text-slate-400">
                    {t.args && Object.keys(t.args).length > 0 && (
                      <div>
                        <span className="text-cyan-400/80 font-bold uppercase block text-[9px]">
                          ARGS:
                        </span>
                        <pre className="whitespace-pre-wrap break-all text-slate-300 max-h-24 overflow-y-auto">
                          {JSON.stringify(t.args, null, 2).slice(0, 400)}
                        </pre>
                      </div>
                    )}
                    {t.result && (
                      <div className="mt-1">
                        <span className="text-cyan-400/80 font-bold uppercase block text-[9px]">
                          RESULT:
                        </span>
                        <pre className="whitespace-pre-wrap break-all text-slate-200 max-h-28 overflow-y-auto">
                          {t.result.slice(0, 400)}
                          {t.result.length > 400 ? "…" : ""}
                        </pre>
                      </div>
                    )}
                    {t.duration_s !== undefined && (
                      <div className="text-[9px] text-slate-500">
                        DURATION: {t.duration_s.toFixed(2)}s
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </HudPanel>
  );
}
