/**
 * StatusStrip — Compact Real-Time System Status Bar
 *
 * Ultra-slim (28px) status strip pinned to the bottom of the viewport.
 * Displays live system telemetry: CPU · RAM · Disk · Network · Battery.
 * - All values come from useStore.stats (polled every 2.5s by useSystemStats).
 * - Missing metrics render as "N/A" — no fake data ever.
 * - Color-codes values: green → yellow → red at 60/85% thresholds.
 * - Respects dark/light theme.
 * - Hidden when stats are not yet loaded (skeleton shimmer instead).
 * - Wraps numbers in <bdi> for mixed-direction safety.
 */
import { useStore } from "../../lib/store";

function colorForPercent(val: number | "N/A"): string {
  if (val === "N/A") return "rgba(100,116,139,0.8)";
  if (val >= 85) return "#fb7185";   // danger
  if (val >= 60) return "#fbbf24";   // warn
  return "#4ade80";                  // ok
}

interface MiniBarProps {
  value: number | "N/A";
  color: string;
}
function MiniBar({ value, color }: MiniBarProps) {
  if (value === "N/A") return null;
  return (
    <div
      className="rounded-full overflow-hidden"
      style={{ width: "36px", height: "3px", background: "rgba(255,255,255,0.08)" }}
    >
      <div
        style={{
          width: `${Math.min(100, value as number)}%`,
          height: "100%",
          background: color,
          borderRadius: "999px",
          transition: "width 0.6s ease",
        }}
      />
    </div>
  );
}

interface StatItemProps {
  label: string;
  value: number | string | "N/A";
  unit?: string;
  color?: string;
  showBar?: boolean;
}
function StatItem({ label, value, unit = "", color, showBar = false }: StatItemProps) {
  const displayColor = color || (typeof value === "number" ? colorForPercent(value as number) : "rgba(100,116,139,0.8)");
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 select-none">
        {label}
      </span>
      {showBar && typeof value === "number" && (
        <MiniBar value={value as number} color={displayColor} />
      )}
      <span
        className="text-[10px] font-mono font-semibold tabular-nums"
        style={{ color: displayColor }}
      >
        <bdi dir="auto">{value}{value !== "N/A" ? unit : ""}</bdi>
      </span>
    </div>
  );
}

function Divider() {
  return (
    <div
      className="h-3 w-px"
      style={{ background: "rgba(96,165,250,0.15)" }}
    />
  );
}

export default function StatusStrip() {
  const stats = useStore((s) => s.stats);
  const statsLoading = useStore((s) => s.statsLoading);
  const themeMode = useStore((s) => s.themeMode);
  const connected = useStore((s) => s.connected);

  const isDark = themeMode === "dark";

  const cpu = typeof stats?.cpu === "number" ? Math.round(stats.cpu) : "N/A";
  const ram = stats?.ram?.percent ? Math.round(stats.ram.percent) : "N/A";
  const ramUsed = stats?.ram?.used_gb?.toFixed(1) ?? "N/A";
  const ramTotal = stats?.ram?.total_gb?.toFixed(1) ?? null;
  const disk = stats?.disk?.percent ? Math.round(stats.disk.percent) : "N/A";
  const netSent = stats?.net?.sent_mb ? `↑${stats.net.sent_mb.toFixed(1)}` : "N/A";
  const netRecv = stats?.net?.recv_mb ? `↓${stats.net.recv_mb.toFixed(1)}` : "N/A";
  const gpuLoad = stats?.gpu?.load_percent != null ? Math.round(stats.gpu.load_percent) : null;
  const battery = stats?.battery?.percent != null ? Math.round(stats.battery.percent) : null;
  const batteryPlugged = stats?.battery?.plugged;

  const bgColor = isDark
    ? "rgba(1, 5, 18, 0.88)"
    : "rgba(248, 250, 252, 0.90)";
  const borderColor = isDark
    ? "rgba(96,165,250,0.12)"
    : "rgba(148,163,184,0.25)";

  return (
    <div
      className="relative w-full flex items-center justify-between px-4"
      style={{
        height: "28px",
        background: bgColor,
        borderTop: `1px solid ${borderColor}`,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        zIndex: 20, // z-panels
        flexShrink: 0,
        overflowX: "auto",
        scrollbarWidth: "none",
      }}
    >
      {/* Left: Connection indicator */}
      <div className="flex items-center gap-2 shrink-0">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: connected ? "#4ade80" : "#ef4444",
            boxShadow: connected ? "0 0 5px #4ade80" : "0 0 5px #ef4444",
          }}
        />
        <span className="text-[9px] font-mono uppercase tracking-widest text-slate-500 select-none hidden sm:block">
          {connected ? "ONLINE" : "OFFLINE"}
        </span>
      </div>

      {/* Center: Telemetry items */}
      {statsLoading ? (
        <div className="flex items-center gap-2 flex-1 justify-center">
          <span className="text-[9px] font-mono text-slate-600 animate-pulse select-none">
            Loading telemetry...
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3 flex-1 justify-center flex-wrap">
          <StatItem label="CPU" value={cpu} unit="%" showBar color={colorForPercent(cpu)} />
          <Divider />
          <StatItem
            label="RAM"
            value={ram}
            unit="%"
            showBar
            color={colorForPercent(ram)}
          />
          {ramTotal && (
            <span className="text-[9px] font-mono text-slate-500 select-none">
              <bdi dir="auto">{ramUsed}/{ramTotal}GB</bdi>
            </span>
          )}
          <Divider />
          <StatItem label="DISK" value={disk} unit="%" color={colorForPercent(disk)} />
          <Divider />
          <span className="text-[10px] font-mono font-semibold text-slate-400 tabular-nums">
            <bdi dir="auto">{netSent !== "N/A" ? netSent : "N/A"} {netRecv !== "N/A" ? netRecv : ""} MB/s</bdi>
          </span>
          {gpuLoad !== null && (
            <>
              <Divider />
              <StatItem
                label="GPU"
                value={gpuLoad}
                unit="%"
                showBar
                color={colorForPercent(gpuLoad)}
              />
            </>
          )}
          {battery !== null && (
            <>
              <Divider />
              <span
                className="text-[10px] font-mono"
                style={{
                  color: battery < 20 ? "#fb7185" : battery < 40 ? "#fbbf24" : "#4ade80",
                }}
              >
                {batteryPlugged ? "⚡" : "🔋"}
                <bdi dir="auto">{battery}%</bdi>
              </span>
            </>
          )}
        </div>
      )}

      {/* Right: Clock */}
      <ClockDisplay isDark={isDark} />
    </div>
  );
}

function ClockDisplay({ isDark }: { isDark: boolean }) {
  const [time, setTime] = useState(() => formatTime(new Date()));

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(formatTime(new Date()));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span
      className="text-[9px] font-mono tracking-widest shrink-0 select-none"
      style={{ color: isDark ? "rgba(96,165,250,0.5)" : "rgba(100,116,139,0.7)" }}
    >
      {time}
    </span>
  );
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Need useState/useEffect for the clock
import { useState, useEffect } from "react";
