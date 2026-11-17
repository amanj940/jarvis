/**
 * HOLO STUDIO — Full-Screen Holographic Workstation
 *
 * Replaces the floating-panel HUD with a unified 3-column holographic layout:
 *   LEFT   → Live Telemetry: CPU/RAM/disk rings, subsystems, system log
 *   CENTER → Arc Reactor Orb + contextual visual display (chat/blueprint/anatomy)
 *   RIGHT  → Holographic Chat dialogue + command input
 *
 * No floating panels. Everything locked in a responsive grid that never scrambles.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore, nextId, type ChatAttachment } from "../../lib/store";
import { wsClient } from "../../lib/ws";
import { mic } from "../../lib/voice";

/* ─────────────────────────── helpers ──────────────────────────────────── */
function fmtTime() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function ArcRing({
  pct, r, stroke = 3, color = "#22d3ee", label = "", val = ""
}: { pct: number; r: number; stroke?: number; color?: string; label?: string; val?: string }) {
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const size = (r + stroke + 4) * 2;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease", filter: `drop-shadow(0 0 4px ${color})` }}
        />
      </svg>
      {label && <span className="text-[9px] text-slate-400 font-mono uppercase tracking-widest -mt-1">{label}</span>}
      {val && <span className="text-[10px] font-bold" style={{ color }}>{val}</span>}
    </div>
  );
}

/* ─────────────────────────── LEFT COLUMN ───────────────────────────────── */
function TelemetryColumn() {
  const stats = useStore((s) => s.stats);
  const health = useStore((s) => s.health);
  const orbState = useStore((s) => s.orbState);
  const setShellMode = useStore((s) => s.setShellMode);
  const [tick, setTick] = useState(fmtTime());
  const [cpuHistory] = useState<number[]>(Array(30).fill(0));

  useEffect(() => {
    const id = setInterval(() => setTick(fmtTime()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (stats) {
      cpuHistory.push(stats.cpu ?? 0);
      cpuHistory.shift();
    }
  }, [stats, cpuHistory]);

  const cpu = stats?.cpu ?? 0;
  const ram = stats?.ram?.percent ?? 0;
  const disk = stats?.disk?.percent ?? 0;
  const tools = health?.tools ?? 91;
  const plugins = health?.plugins?.length ?? 13;

  const subsystems = [
    { icon: "🧠", label: "Brain / LLM", detail: health?.model?.model ?? "gemini-3.5-flash-lite", ok: true },
    { icon: "⚙️", label: "Orchestrator", detail: `${health?.permission_mode ?? "auto"} mode`, ok: true },
    { icon: "💾", label: "Memory", detail: "SQLite + Semantic", ok: true },
    { icon: "🔊", label: "Voice System", detail: health?.voice?.wake_word ?? "Hey JARVIS", ok: true },
    { icon: "🛠️", label: "Tools & Plugins", detail: `${tools} tools · ${plugins} plugins`, ok: tools > 0 },
    { icon: "🌐", label: "Data Link", detail: "Port 7341 ● ACTIVE", ok: true },
  ];

  /* mini sparkline */
  const W = 140, H = 28;
  const pts = cpuHistory.map((v, i) => `${(i / (cpuHistory.length - 1)) * W},${H - (v / 100) * H}`).join(" ");

  return (
    <div className="flex flex-col h-full gap-3 p-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-cyan-400 tracking-widest uppercase">◈ TELEMETRY</span>
        <span className="text-[10px] font-mono text-slate-500">{tick}</span>
      </div>

      {/* CPU / RAM / DISK rings */}
      <div
        className="rounded-xl border border-cyan-500/20 p-3 flex justify-around"
        style={{ background: "rgba(6,15,30,0.7)" }}
      >
        <ArcRing pct={cpu} r={22} stroke={3} color="#22d3ee" label="CPU" val={`${cpu.toFixed(0)}%`} />
        <ArcRing pct={ram} r={22} stroke={3} color="#818cf8" label="RAM" val={`${ram.toFixed(0)}%`} />
        <ArcRing pct={disk} r={22} stroke={3} color="#34d399" label="DISK" val={`${disk.toFixed(0)}%`} />
      </div>

      {/* Sparkline */}
      <div
        className="rounded-xl border border-cyan-500/10 p-2 overflow-hidden"
        style={{ background: "rgba(6,15,30,0.5)" }}
      >
        <span className="text-[9px] font-mono text-slate-500 uppercase">CPU · 30s</span>
        <svg width={W} height={H} className="mt-1 w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon
            points={`0,${H} ${pts} ${W},${H}`}
            fill="url(#spark)"
          />
          <polyline points={pts} fill="none" stroke="#22d3ee" strokeWidth="1.5"
            style={{ filter: "drop-shadow(0 0 3px #22d3ee)" }} />
        </svg>
      </div>

      {/* Orb state */}
      <div
        className="rounded-xl border border-cyan-500/20 p-2.5 flex items-center gap-2"
        style={{ background: "rgba(6,15,30,0.6)" }}
      >
        <span className="text-lg">
          {orbState === "idle" ? "😶" : orbState === "listening" ? "👂" : orbState === "thinking" ? "🧠" : "🔊"}
        </span>
        <div>
          <div className="text-[10px] font-mono text-slate-400 uppercase">Status</div>
          <div className="text-xs font-bold" style={{
            color: orbState === "idle" ? "#64748b" : orbState === "listening" ? "#22d3ee"
              : orbState === "thinking" ? "#a78bfa" : "#f59e0b"
          }}>
            {orbState.toUpperCase()}
          </div>
        </div>
        <div
          className="ml-auto w-2 h-2 rounded-full"
          style={{
            background: orbState === "idle" ? "#64748b" : "#22d3ee",
            boxShadow: orbState !== "idle" ? "0 0 8px #22d3ee" : "none",
            animation: orbState !== "idle" ? "pulse 1s infinite" : "none"
          }}
        />
      </div>

      {/* Subsystems */}
      <div
        className="rounded-xl border border-cyan-500/20 flex flex-col overflow-hidden flex-1 min-h-0"
        style={{ background: "rgba(6,15,30,0.6)" }}
      >
        <div className="px-3 py-2 border-b border-cyan-500/10 flex items-center gap-2">
          <span className="text-[9px] font-mono text-cyan-400 uppercase tracking-widest">◈ SUBSYSTEMS</span>
          <span className="ml-auto text-[9px] font-mono text-slate-500">
            🐧 Fedora 44 · kozer
          </span>
        </div>
        <div className="flex flex-col overflow-y-auto flex-1">
          {subsystems.map((s) => (
            <div key={s.label} className="px-3 py-2 flex items-center gap-2 hover:bg-cyan-500/5 transition border-b border-slate-800/60 last:border-0">
              <span className="text-sm">{s.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-semibold text-slate-200 truncate">{s.label}</div>
                <div className="text-[9px] text-slate-500 truncate">{s.detail}</div>
              </div>
              <div
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: s.ok ? "#22c55e" : "#ef4444", boxShadow: s.ok ? "0 0 6px #22c55e" : "0 0 6px #ef4444" }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Exit holo button */}
      <button
        onClick={() => setShellMode("full")}
        className="rounded-xl border border-slate-700 text-[10px] font-mono text-slate-500 hover:text-cyan-400 hover:border-cyan-500/40 py-2 transition uppercase tracking-widest"
        style={{ background: "rgba(6,15,30,0.5)" }}
      >
        ◱ EXIT HOLO STUDIO
      </button>
    </div>
  );
}

/* ─────────────────────────── CENTER COLUMN ─────────────────────────────── */
type VisMode = "orb" | "blueprint" | "anatomy";

function CenterDisplay() {
  const orbState = useStore((s) => s.orbState);
  const chat = useStore((s) => s.chat);
  const [visMode, setVisMode] = useState<VisMode>("orb");
  const [angle, setAngle] = useState(0);

  /* slow orb rotation indicator */
  useEffect(() => {
    const id = setInterval(() => setAngle((a) => (a + 0.3) % 360), 50);
    return () => clearInterval(id);
  }, []);

  /* last JARVIS message for the orb display */
  const lastMsg = [...chat].reverse().find((m) => m.role === "assistant")?.text ?? "";
  const previewText = lastMsg.length > 180 ? lastMsg.slice(0, 180) + "…" : lastMsg;

  const arcColor = orbState === "idle" ? "#22d3ee"
    : orbState === "listening" ? "#a78bfa"
    : orbState === "thinking" ? "#f59e0b"
    : "#22c55e";

  return (
    <div className="flex flex-col h-full gap-2 p-3 items-center">
      {/* Mode tabs */}
      <div className="flex gap-2 w-full justify-center">
        {(["orb", "blueprint", "anatomy"] as VisMode[]).map((m) => (
          <button key={m} onClick={() => setVisMode(m)}
            className="px-3 py-1 rounded-lg text-[10px] font-mono uppercase tracking-widest border transition"
            style={visMode === m ? {
              background: "rgba(34,211,238,0.12)",
              borderColor: "rgba(34,211,238,0.5)",
              color: "#22d3ee",
              boxShadow: "0 0 10px rgba(34,211,238,0.2)"
            } : { background: "rgba(6,15,30,0.5)", borderColor: "rgba(100,116,139,0.3)", color: "#64748b" }}
          >
            {m === "orb" ? "⚡ ARC REACTOR" : m === "blueprint" ? "📐 BLUEPRINT" : "🧊 ANATOMY"}
          </button>
        ))}
      </div>

      {/* Main visual area */}
      <div className="flex-1 w-full relative flex items-center justify-center min-h-0 rounded-2xl overflow-hidden border border-cyan-500/15"
        style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(6,20,50,0.9) 0%, rgba(2,8,20,0.98) 100%)" }}
      >
        {/* Grid overlay */}
        <div className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(rgba(34,211,238,0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(34,211,238,0.3) 1px, transparent 1px)
            `,
            backgroundSize: "40px 40px"
          }}
        />

        {visMode === "orb" && (
          <div className="flex flex-col items-center gap-6 relative z-10">
            {/* Arc Reactor orb */}
            <div className="relative" style={{ width: 220, height: 220 }}>
              {/* outer slow ring */}
              <svg className="absolute inset-0 w-full h-full" style={{ transform: `rotate(${angle}deg)` }}>
                <circle cx="110" cy="110" r="100" fill="none" stroke={arcColor} strokeWidth="1"
                  strokeDasharray="12 8" opacity="0.4" />
              </svg>
              {/* mid ring */}
              <svg className="absolute inset-0 w-full h-full" style={{ transform: `rotate(${-angle * 1.5}deg)` }}>
                <circle cx="110" cy="110" r="82" fill="none" stroke={arcColor} strokeWidth="1.5"
                  strokeDasharray="6 10" opacity="0.6" />
              </svg>
              {/* inner ring */}
              <svg className="absolute inset-0 w-full h-full">
                <circle cx="110" cy="110" r="65" fill="none" stroke={arcColor} strokeWidth="2"
                  opacity="0.5" />
                <circle cx="110" cy="110" r="65" fill="none" stroke={arcColor} strokeWidth="1"
                  strokeDasharray={`${(orbState === "thinking" ? 60 + angle % 100 : 180)} 500`}
                  style={{ transition: "stroke-dasharray 0.3s", filter: `drop-shadow(0 0 6px ${arcColor})` }} />
              </svg>
              {/* glow core */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="rounded-full flex items-center justify-center font-bold text-sm tracking-widest"
                  style={{
                    width: 110, height: 110,
                    background: `radial-gradient(circle, ${arcColor}18 0%, transparent 70%)`,
                    border: `2px solid ${arcColor}60`,
                    boxShadow: `0 0 30px ${arcColor}40, inset 0 0 20px ${arcColor}15`,
                    color: arcColor,
                    animation: orbState !== "idle" ? "pulse 2s infinite" : "none"
                  }}
                >
                  J.A.R.V.I.S
                </div>
              </div>
            </div>

            {/* Last response preview */}
            {previewText && (
              <div
                className="max-w-sm text-center text-xs text-slate-300 leading-relaxed rounded-xl px-4 py-3 border border-cyan-500/20"
                style={{ background: "rgba(6,15,30,0.7)", fontFamily: "monospace" }}
              >
                {previewText}
              </div>
            )}

            {/* Status indicators row */}
            <div className="flex gap-4 text-[10px] font-mono text-slate-500">
              <span style={{ color: arcColor }}>◉ {orbState.toUpperCase()}</span>
              <span>|</span>
              <span>⚡ REACTOR ONLINE</span>
              <span>|</span>
              <span>🔗 LINKED</span>
            </div>
          </div>
        )}

        {visMode === "blueprint" && <BlueprintView />}
        {visMode === "anatomy" && <AnatomyView />}
      </div>

      {/* Bottom metrics strip */}
      <div className="flex gap-2 w-full">
        {[
          { label: "TOOLS", val: "91", color: "#22d3ee" },
          { label: "PLUGINS", val: "13", color: "#818cf8" },
          { label: "AGENTS", val: "9", color: "#34d399" },
          { label: "PROJECTS", val: "27", color: "#f59e0b" },
          { label: "PORT", val: "7341", color: "#f43f5e" },
        ].map((m) => (
          <div key={m.label}
            className="flex-1 rounded-lg border border-cyan-500/15 py-2 text-center"
            style={{ background: "rgba(6,15,30,0.6)" }}
          >
            <div className="text-[9px] font-mono text-slate-500 uppercase">{m.label}</div>
            <div className="text-sm font-bold" style={{ color: m.color }}>{m.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BlueprintView() {
  const nodes = [
    { id: "input", label: "🎙️ INPUT", sub: "Voice · Text · File", x: 50, y: 10, color: "#22d3ee" },
    { id: "brain", label: "🧠 LLM BRAIN", sub: "Gemini 3.5 Flash Lite", x: 50, y: 35, color: "#a78bfa" },
    { id: "tools", label: "🛠️ TOOLS", sub: "91 Tools · 13 Plugins", x: 20, y: 60, color: "#f59e0b" },
    { id: "memory", label: "💾 MEMORY", sub: "SQLite · Semantic", x: 50, y: 60, color: "#34d399" },
    { id: "kernel", label: "🐧 LINUX", sub: "Fedora 44 · X11", x: 80, y: 60, color: "#fb7185" },
    { id: "output", label: "🔊 OUTPUT", sub: "Voice · HUD · API", x: 50, y: 85, color: "#22d3ee" },
  ];
  const edges = [
    ["input", "brain"], ["brain", "tools"], ["brain", "memory"], ["brain", "kernel"], ["tools", "output"], ["memory", "output"], ["kernel", "output"]
  ];

  return (
    <div className="absolute inset-0 p-4" style={{ fontFamily: "monospace" }}>
      <div className="text-[10px] text-cyan-400 uppercase tracking-widest mb-2 opacity-60">
        ◈ JARVIS SYSTEM ARCHITECTURE — ENGINEERING BLUEPRINT
      </div>
      <div className="relative w-full h-[85%]">
        {/* SVG edges */}
        <svg className="absolute inset-0 w-full h-full" style={{ zIndex: 0 }}>
          {edges.map(([a, b]) => {
            const na = nodes.find((n) => n.id === a)!;
            const nb = nodes.find((n) => n.id === b)!;
            return (
              <line key={`${a}-${b}`}
                x1={`${na.x}%`} y1={`${na.y + 5}%`}
                x2={`${nb.x}%`} y2={`${nb.y - 5}%`}
                stroke="rgba(34,211,238,0.3)" strokeWidth="1" strokeDasharray="4 4"
              />
            );
          })}
        </svg>
        {/* Nodes */}
        {nodes.map((n) => (
          <div key={n.id}
            className="absolute transform -translate-x-1/2 -translate-y-1/2 text-center rounded-lg border px-2 py-1.5 cursor-default hover:scale-105 transition-transform"
            style={{
              left: `${n.x}%`, top: `${n.y}%`,
              background: `${n.color}10`,
              borderColor: `${n.color}50`,
              zIndex: 1,
              minWidth: 100
            }}
          >
            <div className="text-[11px] font-bold" style={{ color: n.color }}>{n.label}</div>
            <div className="text-[9px] text-slate-400">{n.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnatomyView() {
  const [explode, setExplode] = useState(30);
  const [selected, setSelected] = useState<number | null>(null);
  const layers = [
    { label: "Output Layer", color: "#22d3ee", spec: "Softmax · 32k vocab tokens", emoji: "📤" },
    { label: "Feed-Forward Network", color: "#818cf8", spec: "FFN dim: 4096 · GELU activation", emoji: "⚡" },
    { label: "Multi-Head Attention", color: "#a78bfa", spec: "32 heads · 128k context", emoji: "👁️" },
    { label: "Embedding Layer", color: "#34d399", spec: "dim: 1024 · learned positional", emoji: "🔢" },
    { label: "Input Tokenizer", color: "#f59e0b", spec: "Gemini SentencePiece BPE", emoji: "✂️" },
  ];
  const baseY = 20;
  const gap = explode * 0.5 + 28;

  return (
    <div className="absolute inset-0 flex flex-col p-4 gap-3">
      <div className="text-[10px] text-cyan-400 uppercase tracking-widest opacity-60">
        ◈ NEURAL TRANSFORMER — 3D ANATOMY INSPECTOR
      </div>
      <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400">
        <span>EXPLODE</span>
        <input type="range" min={0} max={100} value={explode} onChange={(e) => setExplode(+e.target.value)}
          className="flex-1 accent-cyan-400" />
        <span style={{ color: "#22d3ee" }}>{explode}%</span>
      </div>
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-0"
          style={{ top: baseY }}
        >
          {layers.map((l, i) => (
            <div key={l.label}
              onClick={() => setSelected(selected === i ? null : i)}
              className="cursor-pointer rounded-lg border flex items-center gap-3 px-4 py-2 w-72 hover:scale-105 transition-all"
              style={{
                background: selected === i ? `${l.color}25` : `${l.color}10`,
                borderColor: selected === i ? l.color : `${l.color}50`,
                boxShadow: selected === i ? `0 0 20px ${l.color}30` : "none",
                marginBottom: i < layers.length - 1 ? `${gap - 16}px` : 0,
                transform: `translateY(${i * explode * 0.3}px)`,
                transition: "transform 0.4s ease, margin 0.4s ease"
              }}
            >
              <span className="text-lg">{l.emoji}</span>
              <div>
                <div className="text-[11px] font-bold" style={{ color: l.color }}>{l.label}</div>
                <div className="text-[9px] text-slate-400">{selected === i ? l.spec : l.spec.slice(0, 30) + "…"}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── RIGHT COLUMN (chat) ─────────────────────── */
function HoloChatColumn() {
  const chat = useStore((s) => s.chat);
  const pushChat = useStore((s) => s.pushChat);
  const micEnabled = useStore((s) => s.micEnabled);
  const setWakeEnabled = useStore((s) => s.setWakeEnabled);
  const micStatus = useStore((s) => s.micStatus);
  const voiceEnabled = useStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useStore((s) => s.setVoiceEnabled);
  const connected = useStore((s) => s.connected);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    const id = nextId();
    pushChat({ id, role: "user", text, ts: Date.now() });
    try {
      wsClient.chat(text);
    } catch {
      pushChat({ id: nextId(), role: "error", text: "⚠️ Connection error", ts: Date.now() });
    }
    setSending(false);
  }, [input, sending, pushChat]);

  const toggleMic = async () => {
    if (micEnabled) {
      mic.stop();
      setWakeEnabled(false);
    } else {
      setWakeEnabled(true);
      await mic.start(
        (text, isFinal) => {
          if (isFinal && text.trim()) {
            const trimmed = text.trim();
            pushChat({ id: nextId(), role: "user", text: trimmed, ts: Date.now() });
            wsClient.chat(trimmed);
            setInput("");
          } else {
            setInput(text);
          }
        },
        () => {}
      );
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  /* render message */
  const renderMsg = (msg: (typeof chat)[number]) => {
    const isUser = msg.role === "user";
    const isErr = msg.role === "error";
    const accent = isUser ? "#22d3ee" : isErr ? "#ef4444" : "#a78bfa";

    return (
      <div key={msg.id} className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"} items-start`}>
        {/* Avatar */}
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 mt-0.5 font-bold border"
          style={{ background: `${accent}18`, borderColor: `${accent}50`, color: accent }}
        >
          {isUser ? "U" : isErr ? "!" : "J"}
        </div>
        {/* Bubble */}
        <div
          className="max-w-[80%] rounded-xl px-3 py-2 text-xs leading-relaxed break-words border"
          style={{
            background: isUser ? "rgba(34,211,238,0.08)" : isErr ? "rgba(239,68,68,0.08)" : "rgba(167,139,250,0.08)",
            borderColor: `${accent}30`,
            color: "#e2e8f0",
            fontFamily: "monospace"
          }}
        >
          {msg.text}
          <div className="text-[8px] text-slate-600 mt-1 text-right">
            {new Date(msg.ts).toLocaleTimeString("en-GB", { hour12: false })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full gap-2 p-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <span className="text-[10px] font-mono text-cyan-400 tracking-widest uppercase">◈ DIALOGUE</span>
        <div className="flex items-center gap-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: connected ? "#22c55e" : "#ef4444", boxShadow: connected ? "0 0 6px #22c55e" : "none" }}
          />
          <span className="text-[9px] font-mono text-slate-500">{connected ? "LINKED" : "OFFLINE"}</span>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex gap-1.5 flex-shrink-0 flex-wrap">
        {["⚡ فحص النظام", "🧹 مسح", "📋 الحالة"].map((a) => (
          <button key={a} onClick={() => { const txt = a.split(" ").slice(1).join(" "); pushChat({ id: nextId(), role: "user", text: txt, ts: Date.now() }); try { wsClient.chat(txt); } catch { /* noop */ } }}
            className="px-2 py-0.5 rounded-lg text-[9px] font-mono border border-cyan-500/20 text-slate-400 hover:border-cyan-500/50 hover:text-cyan-300 transition"
            style={{ background: "rgba(6,15,30,0.5)" }}
          >
            {a}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto flex flex-col gap-2.5 min-h-0 pr-1"
        style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(34,211,238,0.2) transparent" }}
      >
        {chat.length === 0 ? (
          <div className="text-center text-slate-600 text-xs mt-8 font-mono">
            ◈ No messages yet<br />
            <span className="text-[10px]">Start a dialogue with JARVIS</span>
          </div>
        ) : (
          chat.map(renderMsg)
        )}
      </div>

      {/* Input */}
      <div
        className="flex-shrink-0 rounded-xl border border-cyan-500/25 overflow-hidden"
        style={{ background: "rgba(6,15,30,0.7)" }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="اسأل جارفيس…"
          rows={2}
          className="w-full bg-transparent px-3 pt-2 text-xs text-slate-200 resize-none outline-none font-mono placeholder-slate-600"
          dir="auto"
          style={{ caretColor: "#22d3ee" }}
        />
        <div className="flex items-center gap-1.5 px-2 pb-2">
          {/* Voice toggle */}
          <button
            onClick={() => setVoiceEnabled(!voiceEnabled)}
            className="text-sm"
            title={voiceEnabled ? "إيقاف الصوت" : "تشغيل الصوت"}
          >
            {voiceEnabled ? "🔊" : "🔇"}
          </button>
          {/* Mic */}
          <button
            onClick={toggleMic}
            className="text-sm"
            title="ميكروفون"
            style={{ color: micEnabled && micStatus === "listening" ? "#22d3ee" : "#64748b" }}
          >
            🎙️
          </button>
          <div className="flex-1" />
          {/* Send */}
          <button
            onClick={send}
            disabled={!input.trim() || sending}
            className="px-3 py-1 rounded-lg text-[11px] font-bold font-mono transition border"
            style={input.trim() && !sending ? {
              background: "rgba(34,211,238,0.15)",
              borderColor: "rgba(34,211,238,0.5)",
              color: "#22d3ee",
              boxShadow: "0 0 10px rgba(34,211,238,0.2)"
            } : { background: "transparent", borderColor: "rgba(100,116,139,0.2)", color: "#475569" }}
          >
            {sending ? "⏳" : "إرسال ⟶"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── ROOT LAYOUT ───────────────────────────────── */
export default function HoloStudio() {
  const openSettings = useStore((s) => s.openSettings);
  const openProjects = useStore((s) => s.openProjects);
  const openMonitor  = useStore((s) => s.openMonitor);
  const setShellMode = useStore((s) => s.setShellMode);

  return (
    <div
      className="w-screen h-screen overflow-hidden flex flex-col"
      style={{
        background: "radial-gradient(ellipse at 20% 20%, rgba(6,20,50,0.95) 0%, rgba(2,6,15,1) 100%)",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace"
      }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b border-cyan-500/15 flex-shrink-0"
        style={{ background: "rgba(2,10,25,0.9)", backdropFilter: "blur(12px)" }}
      >
        <div className="flex items-center gap-3">
          <span
            className="text-sm font-bold tracking-[0.3em] font-mono"
            style={{ color: "#22d3ee", textShadow: "0 0 10px rgba(34,211,238,0.5)" }}
          >
            ◈ J.A.R.V.I.S
          </span>
          <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">
            HOLO ENGINEERING STUDIO v2.0
          </span>
        </div>
        <div className="flex items-center gap-3 text-[9px] font-mono text-slate-500">
          <div className="flex items-center gap-1.5 mr-2">
            <button
              onClick={() => openMonitor()}
              className="px-2 py-0.5 rounded text-[10px] font-mono border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 transition flex items-center gap-1 cursor-pointer"
              title="شاشة المونيتر الهندسي والتشريحي والتعليمي"
            >
              <span>🔬</span> MONITOR
            </button>
            <button
              onClick={() => openProjects()}
              className="px-2 py-0.5 rounded text-[10px] font-mono border border-slate-700 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300 transition flex items-center gap-1 cursor-pointer"
              title="مستعرض المشاريع الـ 27"
            >
              <span>📁</span> PROJECTS
            </button>
            <button
              onClick={() => openSettings("ai")}
              className="px-2 py-0.5 rounded text-[10px] font-mono border border-slate-700 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300 transition flex items-center gap-1 cursor-pointer"
              title="الإعدادات ومزودات الذكاء الاصطناعي"
            >
              <span>⚙️</span> SETTINGS
            </button>
            <button
              onClick={() => setShellMode("full")}
              className="px-2 py-0.5 rounded text-[10px] font-mono border border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700 transition cursor-pointer"
              title="العودة للواجهة الكلاسيكية القديمة"
            >
              🖥️ CLASSIC
            </button>
          </div>
          <span>🐧 Fedora 44</span>
          <span>⚡ Intel i3-10110U</span>
          <span>🔗 Port 7341</span>
          <span className="text-cyan-400">● ONLINE</span>
          <HoloClock />
        </div>
      </div>

      {/* 3-column main layout */}
      <div className="flex-1 grid min-h-0 overflow-hidden"
        style={{ gridTemplateColumns: "240px 1fr 300px", gap: "1px", background: "rgba(34,211,238,0.06)" }}
      >
        {/* Left: Telemetry */}
        <div className="overflow-hidden" style={{ background: "rgba(2,8,20,0.97)" }}>
          <TelemetryColumn />
        </div>

        {/* Center: Visual display */}
        <div className="overflow-hidden" style={{ background: "rgba(2,8,20,0.95)" }}>
          <CenterDisplay />
        </div>

        {/* Right: Chat */}
        <div className="overflow-hidden" style={{ background: "rgba(2,8,20,0.97)" }}>
          <HoloChatColumn />
        </div>
      </div>
    </div>
  );
}

function HoloClock() {
  const [t, setT] = useState(fmtTime());
  useEffect(() => {
    const id = setInterval(() => setT(fmtTime()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span style={{ color: "#22d3ee" }}>{t}</span>;
}
