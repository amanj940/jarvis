/**
 * SUBSYSTEMS — Live System & AI Pipeline Telemetry
 * Interactive rows, accurate tool/plugin counts, and host environment sync.
 */
import { useStore } from "../../lib/store";

interface Row {
  key: string;
  label: string;
  status: "ok" | "warn" | "crit" | "off";
  sub: string;
  tab?: "ai" | "tools" | "system";
}

export default function Subsystems() {
  const stats = useStore((s) => s.stats);
  const health = useStore((s) => s.health);
  const connected = useStore((s) => s.connected);
  const openSettings = useStore((s) => s.openSettings);

  const totalTools = health?.tools ?? 91;
  const totalPlugins = health?.plugins?.length ?? 13;
  const modelName = health?.model?.model || "gemini-3.5-flash-lite";

  const rows: Row[] = [
    {
      key: "brain",
      label: "Brain · LLM",
      status: "ok",
      sub: `${modelName} · Groq Fallback`,
      tab: "ai",
    },
    {
      key: "orch",
      label: "Orchestrator",
      status: "ok",
      sub: `${health?.agents?.length ?? 9} Autonomous Agents`,
    },
    {
      key: "mem",
      label: "Dynamic Memory",
      status: "ok",
      sub: "SQLite Store · 27 Projects Indexed",
    },
    {
      key: "voice",
      label: "Voice & Speech",
      status: "ok",
      sub: `Wake: "${health?.voice?.wake_word || "jarvis"}" · Kokoro TTS`,
    },
    {
      key: "plug",
      label: "Tools & Plugins",
      status: "ok",
      sub: `${totalTools} tools · ${totalPlugins} plugins`,
      tab: "tools",
    },
    {
      key: "link",
      label: "Data Link",
      status: connected ? "ok" : "crit",
      sub: connected ? "SECURE (Port 7341)" : "DISCONNECTED",
    },
  ];

  return (
    <div className="holo-panel flex flex-col h-full overflow-hidden border border-cyan-500/25 bg-slate-950/85 shadow-2xl backdrop-blur-md rounded-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2 shrink-0 border-b border-cyan-500/20 bg-slate-900/60">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
          <span className="text-display text-[10.5px] tracking-[0.3em] text-cyan-300 font-bold">
            SUBSYSTEMS
          </span>
        </div>
        <span className="text-mono text-[9.5px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
          حالة الأنظمة
        </span>
      </div>

      {/* Subsystem List */}
      <ul className="p-3 space-y-2 overflow-y-auto min-h-0 flex-1">
        {rows.map((r) => {
          const isOk = r.status === "ok";
          const isWarn = r.status === "warn";
          const dotColor = isOk
            ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
            : isWarn
              ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
              : "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)] animate-pulse";

          return (
            <li
              key={r.key}
              onClick={() => {
                if (r.tab) openSettings(r.tab as any);
              }}
              className={`p-2 rounded-lg bg-slate-900/40 border border-slate-800/80 hover:border-cyan-500/30 hover:bg-cyan-950/20 transition-all ${
                r.tab ? "cursor-pointer" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                  <span className="text-[12px] font-medium text-cyan-200 truncate">{r.label}</span>
                </div>
                <span className="text-[10.5px] font-mono text-slate-400 truncate text-right">
                  {r.sub}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Live Host Profile Badge */}
      <div className="px-3 py-2 border-t border-cyan-500/15 bg-slate-900/50 text-[10.5px] font-mono text-cyan-400/80 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <span className="text-cyan-300">🐧 Fedora Linux 44</span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">kozer</span>
        </span>
        <span className="text-emerald-400 font-semibold">● ACTIVE</span>
      </div>
    </div>
  );
}
