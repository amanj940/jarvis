/**
 * Settings → System → Diagnostics sub-tab (health check, logs download, GPU test, shell mode).
 * Extracted from Settings.tsx: JSX unchanged; the diagnostics-only handlers live here now.
 */

import { useStore } from "../../../lib/store";
import { useTranslations } from "../../../lib/i18n";
import { authFetch } from "../../../lib/api";
import { Row, Toggle } from "./ui";
import { APP_VERSION, type Health } from "./constants";

export interface SystemDiagnosticsSectionProps {
  agents: string[];
  health: Health;
  permMode: string;
  pushToast: (text: string, kind?: "ok" | "error") => void;
}

export default function SystemDiagnosticsSection({
  agents,
  health,
  permMode,
  pushToast,
}: SystemDiagnosticsSectionProps) {
  const lang = useStore((s) => s.language);
  const t = useTranslations(lang);

  const shellMode = useStore((s) => s.shellMode);

  const setShellMode = useStore((s) => s.setShellMode);

  const authToken = useStore((s) => s.authToken);

  // ── Diagnostics ───────────────────────────────────────────────────────────
  const runHealthCheck = async () => {
    try {
      const r = await authFetch("/api/health");
      const d = await r.json();
      pushToast(`Health: ${d.status} — ${d.model?.provider}/${d.model?.model} (${d.tools} tools)`);
    } catch {
      pushToast("Health check failed — backend unreachable", "error");
    }
  };

  const downloadLogs = () => {
    const url = authToken ? `/api/logs/download?token=${encodeURIComponent(authToken)}` : "/api/logs/download";
    window.open(url, "_blank");
  };

  const testGpu = async () => {
    try {
      const r = await authFetch("/api/stats");
      const d = await r.json();
      if (d.gpu?.available) {
        pushToast(`GPU: ${d.gpu.name} — ${d.gpu.load_percent}% load, ${(d.gpu.mem_used_gb ?? 0).toFixed(1)}/${(d.gpu.mem_total_gb ?? 0).toFixed(1)} GB`);
      } else {
        pushToast("No GPU detected (running on CPU)");
      }
    } catch {
      pushToast("Stats request failed", "error");
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-3">
        <h3 className="text-lg font-semibold text-cyan-400 mb-1">System Status</h3>
        <Row label="Provider" value={health?.model?.provider || "—"} />
        <Row label="Model" value={health?.model?.model || "—"} />
        <Row label="Image Model" value={health?.image_model || "—"} />
        <Row label="Tools Loaded" value={String(health?.tools || 0)} />
        <Row label="Plugins" value={String(health?.plugins?.length || 0)} />
        <Row label="Agents" value={String(agents.length || 0)} />
        <Row label="Permission Mode" value={health?.permission_mode || permMode} />
      </div>
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-3">
        <h3 className="text-lg font-semibold text-cyan-400 mb-1">Diagnostics</h3>
        <button onClick={runHealthCheck}
          className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition text-left">Run health check</button>
        <button onClick={downloadLogs}
          className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition text-left">Download logs</button>
        <button onClick={testGpu}
          className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition text-left">Test GPU availability</button>
      </div>
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-3">
        <h3 className="text-lg font-semibold text-cyan-400 mb-1">About</h3>
        <Row label="Version" value={APP_VERSION} />
        <Row label="Backend" value={health?.model.provider || "—"} />
        <Row label="Behavior" value={shellMode} />
        <Toggle label="Start in widget mode" value={shellMode === "widget"} onChange={(v) => setShellMode(v ? "widget" : "full")} />
      </div>
    </div>
  );
}
