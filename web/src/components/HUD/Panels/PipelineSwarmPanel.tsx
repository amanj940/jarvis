import React, { useState, useMemo } from "react";
import { useStore, type SwarmSubtask } from "../../../lib/store";
import { HudPanel } from "../HudPrimitives";
import { useReducedMotion } from "../../../lib/useReducedMotion";

interface PipelineSwarmPanelProps {
  forceCollapsed?: boolean;
}

export default function PipelineSwarmPanel({
  forceCollapsed = false,
}: PipelineSwarmPanelProps) {
  const swarms = useStore((s) => s.swarms);
  const tools = useStore((s) => s.tools);
  const reducedMotion = useReducedMotion();
  const [selectedSubtaskId, setSelectedSubtaskId] = useState<string | null>(null);

  // Active or most recent swarm run
  const activeSwarm = useMemo(() => {
    return swarms.find((s) => s.active) || null;
  }, [swarms]);

  // Latest tool for 4-stage pipeline when not in swarm
  const latestTool = useMemo(() => {
    return tools.length > 0 ? tools[tools.length - 1] : null;
  }, [tools]);

  // Selected subtask detail
  const selectedSubtask = useMemo(() => {
    if (!activeSwarm || !selectedSubtaskId) return null;
    return activeSwarm.tasks.find((t) => t.id === selectedSubtaskId) || null;
  }, [activeSwarm, selectedSubtaskId]);

  // Pipeline 4-stage determination (when no active swarm)
  const pipelineStages = useMemo(() => {
    if (!latestTool) {
      return [
        { key: "start", label: "START", status: "standby" },
        { key: "progress", label: "PROGRESS", status: "standby" },
        { key: "result", label: "RESULT", status: "standby" },
        { key: "end", label: "END", status: "standby" },
      ];
    }
    const st = latestTool.status;
    if (st === "proposed") {
      return [
        { key: "start", label: "PROPOSED", status: "running" },
        { key: "progress", label: "PROGRESS", status: "pending" },
        { key: "result", label: "RESULT", status: "pending" },
        { key: "end", label: "END", status: "pending" },
      ];
    }
    if (st === "running") {
      return [
        { key: "start", label: "STARTED", status: "ok" },
        { key: "progress", label: "RUNNING", status: "running" },
        { key: "result", label: "RESULT", status: "pending" },
        { key: "end", label: "END", status: "pending" },
      ];
    }
    if (st === "ok") {
      return [
        { key: "start", label: "STARTED", status: "ok" },
        { key: "progress", label: "EXECUTED", status: "ok" },
        { key: "result", label: "VERIFIED", status: "ok" },
        { key: "end", label: "RESOLVED", status: "ok" },
      ];
    }
    // fail or denied
    return [
      { key: "start", label: "STARTED", status: "ok" },
      { key: "progress", label: "FAULT", status: "fail" },
      { key: "result", label: "ABORTED", status: "fail" },
      { key: "end", label: "FAILED", status: "fail" },
    ];
  }, [latestTool]);

  return (
    <HudPanel
      id="pipeline_swarm"
      title={activeSwarm ? "SWARM PIPELINE" : "AGENT PIPELINE"}
      subtitle={activeSwarm ? `RUN ID: ${activeSwarm.id.slice(0, 8)}` : "EXECUTION STAGES"}
      color="#a855f7"
      collapsible={true}
      defaultOpen={!forceCollapsed}
      pinnable={true}
    >
      <div className="w-full flex flex-col gap-2 font-mono text-[11px]">
        {/* ── CASE 1: ACTIVE SWARM RUN (SVG Node Graph) ────────────────────── */}
        {activeSwarm ? (
          <div className="flex flex-col gap-2">
            <div className="w-full h-24 bg-slate-950/70 rounded border border-purple-500/20 p-2 flex items-center justify-center overflow-x-auto">
              <svg viewBox="0 0 260 80" className="w-full h-full">
                {/* Edges */}
                {activeSwarm.tasks.map((task, idx) => {
                  if (idx === activeSwarm.tasks.length - 1) return null;
                  const total = activeSwarm.tasks.length;
                  const x1 = 30 + (idx * (200 / Math.max(1, total - 1)));
                  const x2 = 30 + ((idx + 1) * (200 / Math.max(1, total - 1)));
                  const isLinkActive = task.status === "ok" || task.status === "running";
                  return (
                    <line
                      key={`edge-${task.id}`}
                      x1={x1}
                      y1={40}
                      x2={x2}
                      y2={40}
                      stroke={isLinkActive ? "#a855f7" : "#334155"}
                      strokeWidth={1.5}
                      strokeDasharray={task.status === "running" ? "3 3" : undefined}
                      className={task.status === "running" && !reducedMotion ? "animate-pulse" : ""}
                    />
                  );
                })}

                {/* Nodes */}
                {activeSwarm.tasks.map((task, idx) => {
                  const total = activeSwarm.tasks.length;
                  const cx = 30 + (idx * (200 / Math.max(1, total - 1)));
                  const isSelected = selectedSubtaskId === task.id;

                  // Node color by status
                  let stroke = "#38bdf8"; // queued/pending: cyan
                  let fill = "rgba(56, 189, 248, 0.15)";
                  if (task.status === "running") {
                    stroke = "#f59e0b"; // amber
                    fill = "rgba(245, 158, 11, 0.25)";
                  } else if (task.status === "ok") {
                    stroke = "#34d399"; // green
                    fill = "rgba(52, 211, 153, 0.25)";
                  } else if (task.status === "fail") {
                    stroke = "#ef4444"; // red
                    fill = "rgba(239, 68, 68, 0.25)";
                  }

                  return (
                    <g
                      key={`node-${task.id}`}
                      onClick={() => setSelectedSubtaskId(task.id)}
                      className="cursor-pointer"
                    >
                      <circle
                        cx={cx}
                        cy={40}
                        r={isSelected ? 14 : 11}
                        stroke={isSelected ? "#ffffff" : stroke}
                        strokeWidth={isSelected ? 2.5 : 1.5}
                        fill={fill}
                        className={task.status === "running" && !reducedMotion ? "animate-pulse" : ""}
                      />
                      <text
                        x={cx}
                        y={43}
                        textAnchor="middle"
                        fill="#f8fafc"
                        fontSize="9"
                        fontWeight="bold"
                      >
                        {idx + 1}
                      </text>
                      <text
                        x={cx}
                        y={65}
                        textAnchor="middle"
                        fill="#94a3b8"
                        fontSize="7"
                      >
                        {task.label ? task.label.slice(0, 6) : `T${idx + 1}`}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Selected Node Detail Drawer */}
            {selectedSubtask && (
              <div className="p-2 rounded bg-slate-900/60 border border-purple-500/30 text-[10px] flex flex-col gap-1 animate-fadeIn">
                <div className="flex items-center justify-between text-purple-300 font-bold">
                  <span>TASK: {selectedSubtask.label}</span>
                  <span className="uppercase text-[9px] px-1 rounded bg-purple-950/60 border border-purple-500/40">
                    {selectedSubtask.status}
                  </span>
                </div>
                {selectedSubtask.tool && (
                  <div className="text-slate-400">TOOL: <span className="text-cyan-300">{selectedSubtask.tool}</span></div>
                )}
                {selectedSubtask.preview && (
                  <div className="text-slate-300 truncate">PREVIEW: {selectedSubtask.preview}</div>
                )}
                {selectedSubtask.result && (
                  <div className="text-slate-200 break-all text-[9px] max-h-16 overflow-y-auto mt-1 p-1 bg-black/40 rounded">
                    {selectedSubtask.result.slice(0, 300)}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* ── CASE 2: SINGLE-AGENT 4-STAGE PIPELINE ──────────────────────── */
          <div className="flex flex-col gap-2">
            {!latestTool ? (
              <div className="py-5 text-center text-slate-500 flex flex-col items-center justify-center gap-1.5 select-none">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400/40 animate-pulse" />
                <span className="text-[10px] tracking-widest uppercase">STANDBY</span>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-1.5 py-1">
                {pipelineStages.map((stage, idx) => {
                  let ringColor = "#334155";
                  let glyph = "○";
                  let glyphColor = "text-slate-500";
                  let labelColor = "text-slate-500";

                  if (stage.status === "ok") {
                    ringColor = "#34d399"; // green
                    glyph = "✓";
                    glyphColor = "text-emerald-400";
                    labelColor = "text-emerald-300";
                  } else if (stage.status === "running") {
                    ringColor = "#f59e0b"; // amber
                    glyph = "▶";
                    glyphColor = "text-amber-400";
                    labelColor = "text-amber-300 font-bold";
                  } else if (stage.status === "fail") {
                    ringColor = "#ef4444"; // red
                    glyph = "✕";
                    glyphColor = "text-rose-400";
                    labelColor = "text-rose-300 font-bold";
                  }

                  const circ = 2 * Math.PI * 13; // ~81.7
                  const strokeDashoffset = stage.status === "ok" ? 0 : stage.status === "running" ? circ * 0.35 : circ;

                  return (
                    <div
                      key={stage.key}
                      className="flex flex-col items-center gap-1.5 p-1 rounded bg-slate-900/40 border border-slate-800 text-center"
                    >
                      <div className="relative w-8 h-8 flex items-center justify-center">
                        <svg className="w-8 h-8 -rotate-90" viewBox="0 0 32 32">
                          <circle
                            cx={16}
                            cy={16}
                            r={13}
                            fill="none"
                            stroke="#1e293b"
                            strokeWidth={2}
                          />
                          <circle
                            cx={16}
                            cy={16}
                            r={13}
                            fill="none"
                            stroke={ringColor}
                            strokeWidth={2.5}
                            strokeDasharray={circ}
                            strokeDashoffset={strokeDashoffset}
                            className={stage.status === "running" && !reducedMotion ? "animate-spin" : ""}
                            style={{
                              transformOrigin: "center",
                              transition: "stroke-dashoffset 0.5s ease",
                            }}
                          />
                        </svg>
                        <span className={`absolute text-[10px] font-bold ${glyphColor}`}>
                          {glyph}
                        </span>
                      </div>
                      <span className={`text-[8px] tracking-tighter truncate w-full ${labelColor}`}>
                        {stage.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {latestTool && (
              <div className="text-[9.5px] text-slate-400 flex items-center justify-between border-t border-slate-800/80 pt-1 px-0.5">
                <span className="truncate">ACTIVE: <span className="text-cyan-300 uppercase">{latestTool.tool}</span></span>
                <span className="text-slate-500">{latestTool.duration_s ? `${latestTool.duration_s.toFixed(1)}s` : "..."}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </HudPanel>
  );
}
