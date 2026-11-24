/**
 * SETTINGS MONITOR TAB — read-only system monitor for the Settings panel.
 *
 * Standalone component: it is mounted by Settings.tsx as a sub-tab of
 * "System & Config" (see docs/settings-monitor-tab.md for the mount line).
 * It uses ONLY endpoints that already exist on the backend:
 *   GET /api/health  — server/model/voice health (existing getHealth wrapper)
 *   GET /api/stats   — CPU/RAM/disk/net/OS/GPU telemetry (existing getStats wrapper)
 *   GET /api/tasks   — persistent tasks (direct fetch, no api.ts wrapper exists)
 * Every section degrades gracefully: if an endpoint is missing or the
 * backend is unreachable, the section shows an honest
 * "not available on this backend build" state instead of fake data.
 * No writes, no POST/PATCH/DELETE — this tab only reads.
 */
import { useCallback, useEffect, useState } from "react";
import { API_BASE, getHealth, getStats } from "../../lib/api";
import type { SystemStats } from "../../lib/store";

const UNAVAILABLE = "not available on this backend build";
const REFRESH_MS = 10_000;

interface HealthData {
  status?: string;
  name?: string;
  model?: {
    provider?: string;
    model?: string;
    endpoint?: string;
    configured?: boolean;
    reachable?: boolean;
    status_code?: number | null;
  };
  image_model?: string;
  plugins?: string[];
  tools?: number;
  agents?: string[];
  permission_mode?: string;
  voice?: {
    wake_word?: string;
    stt_language?: string;
    state?: string;
    whisper_available?: boolean;
    piper_available?: boolean;
    edge_tts_available?: boolean;
    error?: string;
  };
  tasks?: { pending?: number | null };
}

interface TaskItem {
  id: number;
  title: string;
  kind: string;
  status: string;
  schedule?: string | null;
  next_run?: string | number | null;
  created_at?: string | number | null;
  result?: string | null;
}

type TaskFilter = "all" | "pending" | "running" | "completed" | "failed" | "cancelled";

const TASK_FILTERS: { id: TaskFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "running", label: "Running" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "cancelled", label: "Cancelled" },
];

function fmtGb(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(1)} GB`;
}

function fmtWhen(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
  }
  // Numeric run_at may be seconds or milliseconds since epoch.
  const ms = v > 1e12 ? v : v * 1000;
  return new Date(ms).toLocaleString();
}

function fmtBool(v: boolean | undefined): string {
  if (v === undefined) return "—";
  return v ? "yes" : "no";
}

function statusDot(status: string | undefined): string {
  if (status === "online") return "bg-emerald-400";
  if (status === "completed") return "bg-emerald-400";
  if (status === "running") return "bg-cyan-400 animate-pulse";
  if (status === "pending") return "bg-amber-400";
  if (status === "failed") return "bg-red-400";
  if (status === "cancelled") return "bg-slate-500";
  return "bg-slate-500";
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
      <h3 className="text-lg font-semibold text-cyan-400">{title}</h3>
      {children}
    </div>
  );
}

function Unavailable({ what }: { what: string }) {
  return (
    <p className="text-sm text-amber-300/90">
      {what} — {UNAVAILABLE}.
    </p>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-200 font-mono text-right break-all">{value}</span>
    </div>
  );
}

function Bar({ percent }: { percent: number | undefined }) {
  const p = percent === undefined || Number.isNaN(percent) ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="h-2 w-40 bg-slate-700 rounded-full overflow-hidden">
      <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${p}%` }} />
    </div>
  );
}

export default function SettingsMonitor() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");

  const refresh = useCallback(async () => {
    // Health — GET /api/health (existing wrapper).
    try {
      const h = (await getHealth()) as unknown as HealthData;
      setHealth(h);
      setHealthError(false);
    } catch {
      setHealth(null);
      setHealthError(true);
    }
    // Telemetry — GET /api/stats (existing wrapper).
    try {
      const s = await getStats();
      setStats(s);
      setStatsError(false);
    } catch {
      setStats(null);
      setStatsError(true);
    }
    // Persistent tasks — GET /api/tasks (direct fetch; no api.ts wrapper).
    try {
      const r = await fetch(`${API_BASE}/api/tasks`);
      if (r.status === 503) {
        // Backend replies 503 when the task system was never initialised.
        setTasks([]);
        setTasksError("task system not initialised");
      } else if (!r.ok) {
        throw new Error(`Tasks request failed: ${r.status}`);
      } else {
        const data = (await r.json()) as { tasks?: TaskItem[] };
        setTasks(Array.isArray(data.tasks) ? data.tasks : []);
        setTasksError(null);
      }
    } catch {
      setTasks([]);
      setTasksError("unreachable");
    }
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refresh();
    const timer = window.setInterval(() => {
      if (!cancelled) void refresh();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const visibleTasks =
    taskFilter === "all" ? tasks : tasks.filter((t) => t.status === taskFilter);
  const counts = TASK_FILTERS.reduce<Record<string, number>>((acc, f) => {
    acc[f.id] =
      f.id === "all" ? tasks.length : tasks.filter((t) => t.status === f.id).length;
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">
          Read-only live monitor — refreshes every {REFRESH_MS / 1000}s.
          {lastUpdated ? ` Last updated ${lastUpdated.toLocaleTimeString()}.` : ""}
        </p>
        <button
          onClick={() => void refresh()}
          className="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:text-white transition"
        >
          ↻ Refresh
        </button>
      </div>

      {/* ── Backend health — GET /api/health ─────────────────────────── */}
      <Section title="Backend Health">
        {loading && !health && !healthError ? (
          <p className="text-sm text-slate-400">Loading health…</p>
        ) : healthError || !health ? (
          <Unavailable what="Backend health" />
        ) : (
          <div className="space-y-2">
            <Row
              label="Status"
              value={
                <span className="inline-flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${statusDot(health.status)}`} />
                  {health.status ?? "—"}
                </span>
              }
            />
            <Row label="Server" value={health.name ?? "—"} />
            <Row
              label="Model"
              value={
                health.model
                  ? `${health.model.provider ?? "—"} / ${health.model.model ?? "—"}`
                  : "—"
              }
            />
            <Row label="Model endpoint" value={health.model?.endpoint ?? "—"} />
            <Row label="Model key configured" value={fmtBool(health.model?.configured)} />
            <Row
              label="Model endpoint reachable"
              value={
                health.model?.reachable === undefined
                  ? "—"
                  : health.model.reachable
                    ? `yes${health.model.status_code ? ` (HTTP ${health.model.status_code})` : ""}`
                    : "no"
              }
            />
            <Row label="Image model" value={health.image_model ?? "—"} />
            <Row label="Plugins loaded" value={health.plugins ? health.plugins.length : "—"} />
            <Row label="Tools registered" value={health.tools ?? "—"} />
            <Row label="Agents" value={health.agents ? health.agents.join(", ") : "—"} />
            <Row label="Permission mode" value={health.permission_mode ?? "—"} />
            <Row label="Voice state" value={health.voice?.state ?? "—"} />
            <Row label="Wake word" value={health.voice?.wake_word ?? "—"} />
            <Row label="STT language" value={health.voice?.stt_language ?? "—"} />
            <Row label="Whisper available" value={fmtBool(health.voice?.whisper_available)} />
            <Row label="Piper available" value={fmtBool(health.voice?.piper_available)} />
            <Row label="Edge TTS available" value={fmtBool(health.voice?.edge_tts_available)} />
            <Row
              label="Pending tasks"
              value={health.tasks?.pending === null || health.tasks?.pending === undefined ? "—" : health.tasks.pending}
            />
          </div>
        )}
      </Section>

      {/* ── System telemetry — GET /api/stats ────────────────────────── */}
      <Section title="System Telemetry">
        {loading && !stats && !statsError ? (
          <p className="text-sm text-slate-400">Loading telemetry…</p>
        ) : statsError || !stats ? (
          <Unavailable what="System telemetry" />
        ) : (
          <div className="space-y-2">
            <Row
              label="CPU"
              value={
                <span className="inline-flex items-center gap-2">
                  <Bar percent={stats.cpu} />
                  {stats.cpu?.toFixed(0) ?? "—"}% ({stats.cpu_count ?? "—"} cores)
                </span>
              }
            />
            <Row
              label="RAM"
              value={
                <span className="inline-flex items-center gap-2">
                  <Bar percent={stats.ram?.percent} />
                  {fmtGb(stats.ram?.used_gb)} / {fmtGb(stats.ram?.total_gb)} ({stats.ram?.percent?.toFixed(0) ?? "—"}%)
                </span>
              }
            />
            <Row
              label="Disk"
              value={
                <span className="inline-flex items-center gap-2">
                  <Bar percent={stats.disk?.percent} />
                  {fmtGb(stats.disk?.used_gb)} / {fmtGb(stats.disk?.total_gb)} ({stats.disk?.percent?.toFixed(0) ?? "—"}%)
                </span>
              }
            />
            <Row
              label="Network"
              value={`↑ ${stats.net?.sent_mb?.toFixed(1) ?? "—"} MB / ↓ ${stats.net?.recv_mb?.toFixed(1) ?? "—"} MB`}
            />
            <Row
              label="OS"
              value={
                stats.os
                  ? `${stats.os.system ?? "—"} ${stats.os.release ?? ""} (${stats.os.node ?? "—"})`
                  : "—"
              }
            />
            <Row
              label="GPU"
              value={
                !stats.gpu || !stats.gpu.available
                  ? "not available"
                  : `${stats.gpu.name ?? "GPU"} — ${stats.gpu.load_percent?.toFixed(0) ?? "—"}% load, ` +
                    `${stats.gpu.mem_used_gb?.toFixed(1) ?? "—"} / ${stats.gpu.mem_total_gb?.toFixed(1) ?? "—"} GB` +
                    (stats.gpu.temp_c !== null && stats.gpu.temp_c !== undefined ? `, ${stats.gpu.temp_c}°C` : "")
              }
            />
            {stats.battery && (
              <Row
                label="Battery"
                value={`${stats.battery.percent}%${stats.battery.plugged ? " (plugged in)" : ""}`}
              />
            )}
          </div>
        )}
      </Section>

      {/* ── Persistent tasks — GET /api/tasks ────────────────────────── */}
      <Section title="Persistent Tasks">
        {loading && !tasksError && tasks.length === 0 ? (
          <p className="text-sm text-slate-400">Loading tasks…</p>
        ) : tasksError ? (
          <Unavailable
            what={
              tasksError === "task system not initialised"
                ? "Persistent tasks (task system not initialised)"
                : "Persistent tasks"
            }
          />
        ) : tasks.length === 0 ? (
          <p className="text-sm text-slate-400">No persistent tasks yet.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {TASK_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setTaskFilter(f.id)}
                  className={`px-3 py-1 rounded-full text-xs font-mono transition border ${
                    taskFilter === f.id
                      ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                      : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white"
                  }`}
                >
                  {f.label} ({counts[f.id] ?? 0})
                </button>
              ))}
            </div>
            {visibleTasks.length === 0 ? (
              <p className="text-sm text-slate-400">No tasks with this status.</p>
            ) : (
              <ul className="divide-y divide-slate-700/50">
                {visibleTasks.map((t) => (
                  <li key={t.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-slate-200">{t.title}</span>
                      <span className="inline-flex items-center gap-2 text-xs font-mono text-slate-400">
                        <span className={`inline-block w-2 h-2 rounded-full ${statusDot(t.status)}`} />
                        {t.status}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400 font-mono">
                      #{t.id} · {t.kind}
                      {t.schedule ? ` · cron ${t.schedule}` : ""}
                      {t.next_run ? ` · next run ${fmtWhen(t.next_run)}` : ""}
                      {t.created_at ? ` · created ${fmtWhen(t.created_at)}` : ""}
                    </div>
                    {t.result && (
                      <p className="mt-1 text-xs text-slate-400 break-words">{t.result}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
