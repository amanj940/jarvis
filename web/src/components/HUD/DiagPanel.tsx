import { useEffect, useRef, useState } from "react";
import { useStore } from "../../lib/store";
import { getStats } from "../../lib/api";

export default function DiagPanel() {
  const stats = useStore((s) => s.stats);
  const setStats = useStore((s) => s.setStats);
  const [history, setHistory] = useState<{ cpu: number[]; gpu: number[] }>({
    cpu: Array(60).fill(50),
    gpu: Array(60).fill(20),
  });
  const sparkRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const s = await getStats();
        if (live) {
          setStats(s);
          setHistory((h) => ({
            cpu: [...h.cpu.slice(1), s.cpu],
            gpu: [...h.gpu.slice(1), s.gpu?.load_percent ?? 0],
          }));
        }
      } catch {/* ignore */}
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => { live = false; clearInterval(id); };
  }, [setStats]);

  // Draw sparkline
  useEffect(() => {
    const canvas = sparkRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = "rgba(142,163,182,0.14)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (H * i) / 4);
      ctx.lineTo(W, (H * i) / 4);
      ctx.stroke();
    }

    // CPU line (cyan)
    ctx.strokeStyle = "rgba(34,211,238,0.95)";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    history.cpu.forEach((v, i) => {
      const x = (i / (history.cpu.length - 1)) * W;
      const y = H - 4 - (v / 100) * (H - 12);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // GPU line (amber)
    ctx.strokeStyle = "rgba(251,191,36,0.95)";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    history.gpu.forEach((v, i) => {
      const x = (i / (history.gpu.length - 1)) * W;
      const y = H - 4 - (v / 100) * (H - 12);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [history]);

  if (!stats) {
    return (
      <div className="holo-panel p-3 text-center text-mono text-xs text-jarvis-cyan/50">
        acquiring telemetry…
      </div>
    );
  }

  const gpuAvailable = !!stats.gpu?.available;
  const gpuLoad = stats.gpu?.load_percent ?? 0;

  return (
    <div className="holo-panel p-3 space-y-3">
      <div className="flex items-center justify-between px-1 pb-2 border-b border-jarvis-cyan/20">
        <div className="text-display text-[10px] tracking-[0.3em] text-jarvis-cyan/80">DIAGNOSTICS</div>
        <div className="w-2 h-2 rounded-full bg-jarvis-ok shadow-[0_0_10px_rgba(74,222,128,0.8)]" />
      </div>

      {/* Gauges */}
      <div className="grid grid-cols-4 gap-2 justify-items-center">
        <Gauge value={stats.cpu} label="CPU" color="#22D3EE" />
        <Gauge value={stats.ram.percent} label="RAM" color="#22D3EE" />
        <Gauge value={stats.disk.percent} label="DISK" color="#22D3EE" />
        {gpuAvailable ? (
          <Gauge value={gpuLoad} label="GPU" color="#FBBF24" />
        ) : (
          <Gauge value={0} label="GPU" color="#22D3EE" />
        )}
      </div>

      {/* Sparkline */}
      <canvas ref={sparkRef} width={288} height={64} className="w-full mt-2" aria-label="CPU and GPU load history" />

      {/* Legend */}
      <div className="flex gap-3 text-mono text-[10px] text-jarvis-cyan/50">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-[#22D3EE]" />
          CPU
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-[#FBBF24]" />
          GPU
        </span>
        <span className="ml-auto">60s</span>
      </div>
    </div>
  );
}

function Gauge({ value, label, color }: { value: number; label: string; color: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - value / 100);

  const strokeColor = value > 85 ? "#FB7185" : value > 70 ? "#FBBF24" : color;

  return (
    <div className="relative flex flex-col items-center">
      <svg width={64} height={64} viewBox="0 0 64 64" className="block">
        <circle cx={32} cy={32} r={r} fill="none" stroke="rgba(34,211,238,0.12)" strokeWidth={5} />
        <circle
          cx={32}
          cy={32}
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.9s ease, stroke 0.4s" }}
        />
      </svg>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[70%] text-mono font-medium text-[13px] text-jarvis-cyan">
        {Math.round(value)}
      </div>
      <span className="text-mono text-[10px] text-jarvis-cyan/50 tracking-[0.1em] mt-1">{label}</span>
    </div>
  );
}
