/**
 * Settings → Monitor tab (learning stats, council, cascade, autonomous engine).
 * Extracted verbatim from Settings.tsx (no logic changes).
 */

import { useEffect, useState } from "react";
import { type Lang, useTranslations } from "../../../lib/i18n";
import { authFetch, getCascadeStatus, getVerifiedModels } from "../../../lib/api";

// ── MonitorTab ────────────────────────────────────────────────────────────────
interface CouncilMemberInfo {
  id: string;
  name: string;
  provider: string;
  model: string;
  icon: string;
  role: string;
  specialty: string;
}

interface RecentEntry {
  instruction: string;
  output: string;
  language?: string;
  provider?: string;
  timestamp?: number;
  is_distilled?: boolean;
  tags?: string[];
}

interface AutonomousInsightItem {
  id: string;
  topic: string;
  consensus_snippet: string;
  agreement_score: number;
  participating_models: string[];
  timestamp: number;
  source: string;
}

interface AutonomousEngineStatus {
  enabled: boolean;
  running: boolean;
  in_progress: boolean;
  interval_seconds: number;
  last_cycle_ago_seconds: number | null;
  next_cycle_in_seconds: number | null;
  total_insights_count: number;
  recent_insights: AutonomousInsightItem[];
}

interface LearningStats {
  ok: boolean;
  dataset: { total: number; cloud_distilled: number; local: number; size_kb: number; last_entry_ago_sec: number | null };
  memory_db: Record<string, number>;
  hybrid: { internet_online: boolean; active_provider: string; active_model: string; local_provider: string; local_model: string; cloud_provider: string; cloud_model: string };
  key_pools?: Record<string, number>;
  council_members?: CouncilMemberInfo[];
  autonomous_engine?: AutonomousEngineStatus | null;
  ollama: { models: { name: string; size_gb: number }[] };
  system: { cpu_percent: number; ram_used_gb: number; ram_total_gb: number; ram_percent: number };
}

function MonitorTab({ lang, cascadeInfo, fetchCascadeInfo }: { lang: Lang; cascadeInfo: { online: boolean; tiers: { name: string; provider: string; model: string; is_local: boolean; timeout: number; ttft_timeout: number }[] } | null; fetchCascadeInfo: () => void }) {
  const t = useTranslations(lang);
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);
  const [localCascadeInfo, setLocalCascadeInfo] = useState<{ online: boolean; tiers: { name: string; provider: string; model: string; is_local: boolean; timeout: number; ttft_timeout: number }[] } | null>(cascadeInfo);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [triggeringAuto, setTriggeringAuto] = useState(false);

  // ── Model Verification State ───────────────────────────────────────────────
  const [verifyProgress, setVerifyProgress] = useState<{
    is_running: boolean; total: number; tested: number; active: number;
    failed: number; pct: number; current_model: string; elapsed_seconds: number;
    last_message: string;
  } | null>(null);
  const [verifiedModels, setVerifiedModels] = useState<{
    id: number; provider: string; model_name: string; model_key: string;
    status: string; last_tested: string; latency_ms: number | null;
  }[]>([]);
  const [verifyProviderFilter, setVerifyProviderFilter] = useState("all");
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);
  const [verifyStarting, setVerifyStarting] = useState(false);

  // Council Instant Deliberation State
  const [delibTopic, setDelibTopic] = useState("");
  const [deliberating, setDeliberating] = useState(false);
  const [delibResult, setDelibResult] = useState<{
    topic: string;
    consensus: string;
    agreement_score: number;
    proposals: { member_name: string; icon: string; model: string; content: string }[];
  } | null>(null);

  // Active section tab within Monitor
  const [section, setSection] = useState<"overview" | "models" | "council" | "feed">("overview");

  const fetchStats = async () => {
    setLoading(true);
    try {
      const r = await authFetch("/api/learning/stats");
      const data = await r.json();
      if (data.ok) { setStats(data); setLastRefresh(new Date()); }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const fetchRecent = async () => {
    try {
      const r = await authFetch("/api/learning/recent?limit=8");
      const data = await r.json();
      if (data.ok && Array.isArray(data.entries)) {
        setRecentEntries(data.entries);
      }
    } catch { /* ignore */ }
  };

  const localFetchCascadeInfo = async () => {
    try {
      const d = await getCascadeStatus();
      if (d.ok) setLocalCascadeInfo(d);
    } catch { /* ignore */ }
  };

  // Sync with parent's cascadeInfo when it changes
  useEffect(() => {
    if (cascadeInfo) setLocalCascadeInfo(cascadeInfo);
  }, [cascadeInfo]);

  // ── Model Verification handlers ────────────────────────────────────────────
  const fetchVerifyStatus = async () => {
    try {
      const r = await authFetch("/api/models/verify/status");
      const d = await r.json();
      if (d.ok && d.progress) setVerifyProgress(d.progress);
    } catch { /* ignore */ }
  };

  const fetchVerifiedModels = async () => {
    try {
      const d = await getVerifiedModels(verifyProviderFilter && verifyProviderFilter !== "all" ? verifyProviderFilter : "");
      if (d.ok && Array.isArray(d.models)) {
        // The wrapper's VerifiedModel has no id/model_key; the Monitor table
        // rows need them (key={m.id}), so derive them here. The old inline
        // fetch passed the backend rows through untyped (any).
        setVerifiedModels(d.models.map((m, i) => ({
          id: i,
          provider: m.provider ?? "",
          model_name: m.model_name,
          model_key: m.provider ? `${m.provider}:${m.model_name}` : m.model_name,
          status: m.status,
          last_tested: m.last_tested,
          latency_ms: m.latency_ms,
        })));
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    let iv: ReturnType<typeof setInterval> | null = null;
    if (verifyProgress?.is_running) {
      iv = setInterval(async () => {
        await fetchVerifyStatus();
        await fetchVerifiedModels();
      }, 2000);
    }
    return () => { if (iv) clearInterval(iv); };
  }, [verifyProgress?.is_running]);

  useEffect(() => { fetchVerifiedModels(); }, [verifyProviderFilter]);

  const handleStartVerification = async () => {
    setVerifyStarting(true);
    setPurgeResult(null);
    try {
      const r = await authFetch("/api/models/verify/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: verifyProviderFilter }),
      });
      const d = await r.json();
      if (d.ok) { await fetchVerifyStatus(); }
    } catch { /* ignore */ }
    finally { setVerifyStarting(false); }
  };

  const handlePurgeDead = async () => {
    if (!confirm("هذا سيحذف جميع النماذج غير الشغالة من قاعدة البيانات نهائياً. هل أنت متأكد؟")) return;
    setPurging(true);
    setPurgeResult(null);
    try {
      const r = await authFetch("/api/models/purge-dead", { method: "POST" });
      const d = await r.json();
      if (d.ok) {
        setPurgeResult(`تم حذف ${d.purged_count} نموذج معطّل`);
        await fetchVerifiedModels();
      } else {
        setPurgeResult(d.error || "فشل الحذف");
      }
    } catch { setPurgeResult("خطأ في الاتصال"); }
    finally { setPurging(false); }
  };

  const handleCouncilDeliberate = async () => {
    if (!delibTopic.trim() || deliberating) return;
    setDeliberating(true);
    setDelibResult(null);
    try {
      const r = await authFetch("/api/council", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: delibTopic.trim(), full: false }),
      });
      const data = await r.json();
      if (data.ok) {
        setDelibResult({
          topic: data.topic,
          consensus: data.consensus,
          agreement_score: data.agreement_score ?? 0.95,
          proposals: data.proposals || [],
        });
        setDelibTopic("");
        fetchStats();
        fetchRecent();
      }
    } catch { /* ignore */ }
    finally { setDeliberating(false); }
  };

  const handleToggleAutonomous = async () => {
    try {
      const cur = stats?.autonomous_engine?.enabled ?? true;
      await authFetch("/api/learning/autonomous/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !cur }),
      });
      fetchStats();
    } catch { /* ignore */ }
  };

  const handleTriggerAutonomousCycle = async () => {
    setTriggeringAuto(true);
    try {
      await authFetch("/api/learning/autonomous/trigger", { method: "POST" });
      fetchStats();
      fetchRecent();
    } catch { /* ignore */ }
    finally { setTriggeringAuto(false); }
  };

  const fmtAgo = (sec: number | null) => {
    if (sec === null || sec === undefined) return "N/A";
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
  };

  const totalKeys = stats?.key_pools ? Object.values(stats.key_pools).reduce((a, b) => a + b, 0) : 0;

  // ── Section nav labels ─────────────────────────────────────────────────────
  const sections = [
    { id: "overview" as const, label: t("section_overview") },
    { id: "models"   as const, label: t("section_models") },
    { id: "council"  as const, label: t("section_council") },
    { id: "feed"     as const, label: t("section_feed") },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-8">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{t("monitor_title")}</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {t("monitor_desc")}
          </p>
        </div>
        <button
          onClick={() => { fetchStats(); fetchRecent(); localFetchCascadeInfo(); }}
          disabled={loading}
          className="text-xs text-slate-500 hover:text-slate-300 transition disabled:opacity-40 flex items-center gap-1.5"
        >
          <span className={loading ? "animate-spin inline-block" : ""}>↻</span>
          {lastRefresh ? lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : t("refresh")}
        </button>
      </div>

      {/* ── Section tabs ─────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-slate-800 pb-0">
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`px-4 py-2 text-sm transition rounded-t-md -mb-px border-b-2 ${
              section === s.id
                ? "text-white border-cyan-500"
                : "text-slate-500 border-transparent hover:text-slate-300"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Error state ──────────────────────────────────────────────────── */}
      {!stats && !loading && (
        <div className="text-center py-20 text-slate-600">
          <p className="text-sm">{t("no_server")}</p>
        </div>
      )}

      {loading && !stats && (
        <div className="text-center py-20 text-slate-700">
          <p className="text-sm animate-pulse">{t("loading")}</p>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          OVERVIEW SECTION
      ══════════════════════════════════════════════════════════════════ */}
      {section === "overview" && stats && (
        <div className="space-y-8">

          {/* ── Stat row ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: t("stat_training"), value: stats.dataset.total.toLocaleString(), sub: `${stats.dataset.size_kb} KB` },
              { label: t("stat_distilled"),  value: stats.dataset.cloud_distilled.toLocaleString(), sub: t("stat_council") },
              { label: t("stat_keys"),  value: totalKeys.toString(), sub: `${Object.keys(stats.key_pools || {}).length} ${t("stat_providers")}` },
              { label: t("stat_verified"),  value: verifiedModels.length.toString(), sub: t("stat_livetest") },
            ].map((s) => (
              <div key={s.label} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-500 mb-1">{s.label}</p>
                <p className="text-2xl font-semibold text-white font-mono"><bdi>{s.value}</bdi></p>
                <p className="text-xs text-slate-600 mt-1">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* ── Failover cascade ─────────────────────────────────────── */}
          {localCascadeInfo && localCascadeInfo.tiers.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-300">{t("failover_title")}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-mono ${
                  localCascadeInfo.online
                    ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                    : "text-amber-400 border-amber-500/30 bg-amber-500/10"
                }`}>
                  {localCascadeInfo.online ? t("failover_online") : t("failover_offline")}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {localCascadeInfo.tiers.map((tInfo: any, idx: number) => (
                  <div key={idx} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-600 font-mono uppercase">Tier {idx}</span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                        tInfo.is_local ? "bg-amber-500/15 text-amber-400" : "bg-cyan-500/10 text-cyan-400"
                      }`}>{tInfo.is_local ? t("tier_edge") : t("tier_cloud")}</span>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-200 truncate font-mono">
                        <bdi dir="auto">{tInfo.model}</bdi>
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                        <bdi dir="auto">{tInfo.provider}</bdi>
                      </p>
                    </div>
                    <p className="text-[10px] text-slate-600 font-mono">
                      <bdi>{tInfo.timeout}s</bdi> max · <bdi>{tInfo.ttft_timeout}s</bdi> TTFT
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Autonomous engine ────────────────────────────────────── */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-medium text-slate-200">{t("auto_title")}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{t("auto_desc")}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleAutonomous}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    stats.autonomous_engine?.enabled ? "bg-cyan-600" : "bg-slate-700"
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    stats.autonomous_engine?.enabled ? "translate-x-4" : "translate-x-1"
                  }`} />
                </button>
                <span className="text-xs text-slate-500">
                  {stats.autonomous_engine?.enabled ? t("on", "On") : t("off", "Off")}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-500 mb-1">{t("status_label", "Status")}</p>
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    stats.autonomous_engine?.in_progress
                      ? "bg-amber-400 animate-pulse"
                      : stats.autonomous_engine?.enabled
                      ? "bg-emerald-400"
                      : "bg-slate-600"
                  }`} />
                  <span className="text-xs text-slate-300">
                    {stats.autonomous_engine?.in_progress
                      ? t("status_running")
                      : stats.autonomous_engine?.enabled
                      ? t("status_standby")
                      : t("status_paused")}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">{t("next_cycle")}</p>
                <p className="text-xs text-slate-300 font-mono">
                  {stats.autonomous_engine?.next_cycle_in_seconds
                    ? `${Math.floor(stats.autonomous_engine.next_cycle_in_seconds / 60)}m ${stats.autonomous_engine.next_cycle_in_seconds % 60}s`
                    : t("ready")}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">{t("total_insights")}</p>
                <p className="text-xs text-slate-300 font-mono">
                  <bdi>{stats.autonomous_engine?.total_insights_count || 0}</bdi>
                </p>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-800">
              <button
                onClick={handleTriggerAutonomousCycle}
                disabled={triggeringAuto || stats.autonomous_engine?.in_progress}
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {triggeringAuto || stats.autonomous_engine?.in_progress ? t("running_cycle") : t("run_cycle")}
              </button>
            </div>
          </div>

          {/* ── Memory DB ────────────────────────────────────────────── */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-300">{t("memory_title")}</h3>
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl divide-y divide-slate-800">
              {Object.entries(stats.memory_db)
                .sort(([, a], [, b]) => b - a)
                .map(([table, count]) => {
                  const maxVal = Math.max(...Object.values(stats.memory_db), 1);
                  const pct = Math.round((count / maxVal) * 100);
                  const labels: Record<string, string> = {
                    conversations: t("mem_conversations"), frequent_commands: t("mem_frequent_commands"),
                    preferences: t("mem_preferences"), dynamic_store: t("mem_dynamic_store"),
                    project_notes: t("mem_project_notes"), semantic_memory: t("mem_semantic_memory"),
                    past_fixes: t("mem_past_fixes"), installed_tools: t("mem_installed_tools"), known_paths: t("mem_known_paths"),
                  };
                  return (
                    <div key={table} className="flex items-center gap-4 px-4 py-3">
                      <span className="text-xs text-slate-400 w-36 shrink-0">{labels[table] || table}</span>
                      <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-600 rounded-full transition-all duration-700"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-slate-400 w-10 text-right">{count.toLocaleString()}</span>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* ── System resources + Ollama ─────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-medium text-slate-300">{t("resources_title")}</h3>
              {[
                { label: "CPU", value: stats.system.cpu_percent, unit: `${stats.system.cpu_percent}%` },
                { label: "RAM", value: stats.system.ram_percent, unit: `${stats.system.ram_used_gb}/${stats.system.ram_total_gb} GB` },
              ].map((res) => (
                <div key={res.label}>
                  <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                    <span>{res.label}</span>
                    <span className="font-mono text-slate-300"><bdi>{res.unit}</bdi></span>
                  </div>
                  <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        res.value > 80 ? "bg-rose-500" : res.value > 60 ? "bg-amber-500" : "bg-emerald-500"
                      }`}
                      style={{ width: `${res.value}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-medium text-slate-300">{t("local_models_title")}</h3>
              {stats.ollama.models.length === 0 ? (
                <p className="text-xs text-slate-600">{t("no_ollama")}</p>
              ) : (
                <div className="space-y-2">
                  {stats.ollama.models.map((m) => (
                    <div key={m.name} className="flex items-center justify-between text-xs py-1">
                      <div className="flex items-center gap-2">
                        {m.name === stats.hybrid.local_model && (
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                        )}
                        <span className={`font-mono ${m.name === stats.hybrid.local_model ? "text-white" : "text-slate-400"}`}>
                          {m.name}
                        </span>
                      </div>
                      <span className="text-slate-600 font-mono">{m.size_gb} GB</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MODELS SECTION
      ══════════════════════════════════════════════════════════════════ */}
      {section === "models" && (
        <div className="space-y-6">

          {/* Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={verifyProviderFilter}
              onChange={(e) => setVerifyProviderFilter(e.target.value)}
              disabled={verifyProgress?.is_running}
              className="text-xs bg-slate-900 border border-slate-700 text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-slate-500 disabled:opacity-40"
            >
              <option value="all">{t("all_providers")}</option>
              <option value="groq">Groq</option>
              <option value="gemini">Gemini</option>
              <option value="cerebras">Cerebras</option>
              <option value="openrouter">OpenRouter</option>
              <option value="deepseek">DeepSeek</option>
              <option value="mistral">Mistral</option>
              <option value="nvidia">NVIDIA</option>
              <option value="cohere">Cohere</option>
              <option value="deepinfra">DeepInfra</option>
              <option value="pollinations">Pollinations</option>
            </select>

            <button
              onClick={handleStartVerification}
              disabled={verifyStarting || verifyProgress?.is_running}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {verifyProgress?.is_running ? `${t("scanning")} ${verifyProgress.pct}%` : t("scan_models")}
            </button>

            <button
              onClick={handlePurgeDead}
              disabled={purging || verifyProgress?.is_running}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-red-700 text-slate-500 hover:text-red-400 transition disabled:opacity-40"
            >
              {purging ? t("purging") : t("purge_dead")}
            </button>

            {purgeResult && (
              <span className="text-xs text-slate-400">{purgeResult}</span>
            )}

            <span className="ml-auto text-xs text-slate-600 font-mono">
              <bdi>{verifiedModels.length}</bdi> {t("stat_verified")}
            </span>
          </div>

          {/* Scan progress */}
          {verifyProgress?.is_running && (
            <div className="space-y-2">
              <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-600 rounded-full transition-all duration-500"
                  style={{ width: `${verifyProgress.pct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-600 font-mono">
                <span className="truncate max-w-xs"><bdi>{verifyProgress.current_model || "…"}</bdi></span>
                <span>
                  <bdi className="text-emerald-500">{verifyProgress.active}</bdi> ok ·{" "}
                  <bdi className="text-red-500">{verifyProgress.failed}</bdi> dead ·{" "}
                  <bdi>{verifyProgress.elapsed_seconds}s</bdi>
                </span>
              </div>
            </div>
          )}

          {/* Models table */}
          {verifiedModels.length > 0 ? (
            <div className="border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/80">
                    <th className="text-left px-4 py-3 text-slate-500 font-medium">{t("col_provider")}</th>
                    <th className="text-left px-4 py-3 text-slate-500 font-medium">{t("col_model")}</th>
                    <th className="text-right px-4 py-3 text-slate-500 font-medium">{t("col_latency")}</th>
                    <th className="text-right px-4 py-3 text-slate-500 font-medium">{t("col_tested")}</th>
                  </tr>
                </thead>
                <tbody>
                  {verifiedModels.map((m) => (
                    <tr key={m.id} className="border-t border-slate-800/60 hover:bg-slate-800/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className="text-slate-400 font-mono"><bdi dir="auto">{m.provider}</bdi></span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-200 font-mono max-w-[220px] truncate">
                        <bdi dir="auto">{m.model_name}</bdi>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {m.latency_ms != null ? (
                          <span className={
                            m.latency_ms < 500 ? "text-emerald-400" :
                            m.latency_ms < 1500 ? "text-amber-400" : "text-slate-500"
                          }>
                            <bdi>{m.latency_ms}ms</bdi>
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-600 font-mono">
                        {m.last_tested ? new Date(m.last_tested).toLocaleDateString("ar-SA") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-16 text-slate-600">
              <p className="text-sm">{t("no_models")}</p>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          COUNCIL SECTION
      ══════════════════════════════════════════════════════════════════ */}
      {section === "council" && (
        <div className="space-y-6">

          {/* API Keys summary */}
          {stats && (
            <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
              {stats.key_pools && Object.entries(stats.key_pools).map(([prov, count]) => (
                <div key={prov} className="bg-slate-900/60 border border-slate-800 rounded-xl px-3 py-3 text-center">
                  <p className="text-[10px] text-slate-600 uppercase font-mono mb-1">{prov}</p>
                  <p className="text-lg font-semibold text-white font-mono"><bdi>{count}</bdi></p>
                </div>
              ))}
            </div>
          )}

          {/* Council members */}
          {stats?.council_members && stats.council_members.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-slate-400">{t("council_roster")}</h3>
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                {stats.council_members.map((m, idx) => (
                  <div
                    key={m.id}
                    className={`flex items-center justify-between px-4 py-3 text-xs ${
                      idx > 0 ? "border-t border-slate-800/60" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span>{m.icon}</span>
                      <span className="font-medium text-slate-200">{m.name}</span>
                    </div>
                    <span className="font-mono text-slate-500"><bdi dir="auto">{m.provider}/{m.model}</bdi></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Deliberation input */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-400">{t("deliberate_title")}</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={delibTopic}
                onChange={(e) => setDelibTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCouncilDeliberate()}
                placeholder={t("deliberate_input")}
                disabled={deliberating}
                className="flex-1 bg-slate-900 border border-slate-700 focus:border-slate-500 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-600 outline-none transition"
              />
              <button
                onClick={handleCouncilDeliberate}
                disabled={deliberating || !delibTopic.trim()}
                className="text-sm px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {deliberating ? t("deliberating") : t("deliberate_btn")}
              </button>
            </div>
          </div>

          {/* Result */}
          {delibResult && (
            <div className="space-y-4">
              <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500 font-mono">«{delibResult.topic}»</p>
                  <span className="text-xs font-mono text-emerald-400">
                    <bdi>{Math.round(delibResult.agreement_score * 100)}%</bdi> {t("consensus_label")}
                  </span>
                </div>
                <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {delibResult.consensus}
                </p>
              </div>

              {delibResult.proposals.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {delibResult.proposals.map((p, idx) => (
                    <div key={idx} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-200">{p.icon} {p.member_name}</span>
                        <span className="font-mono text-slate-600">{p.model}</span>
                      </div>
                      <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed">{p.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          FEED SECTION
      ══════════════════════════════════════════════════════════════════ */}
      {section === "feed" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-400">{t("feed_title")}</h3>
            <span className="text-xs text-slate-600 font-mono"><bdi>{recentEntries.length}</bdi> {t("feed_entries")}</span>
          </div>

          {recentEntries.length === 0 ? (
            <div className="text-center py-16 text-slate-600">
              <p className="text-sm">{t("feed_empty")}</p>
            </div>
          ) : (
            <div className="border border-slate-800 rounded-xl overflow-hidden">
              {recentEntries.map((e, idx) => (
                <div key={idx} className={`px-4 py-4 space-y-2 ${idx > 0 ? "border-t border-slate-800/60" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                      e.provider === "council_consensus"
                        ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
                        : e.is_distilled
                        ? "text-purple-400 border-purple-500/30 bg-purple-500/10"
                        : "text-cyan-400 border-cyan-500/30 bg-cyan-500/10"
                    }`}>
                      {e.provider === "council_consensus" ? t("source_council") : e.is_distilled ? t("source_cloud") : t("source_local")}
                    </span>
                    <span className="text-[10px] text-slate-600 font-mono">{e.provider || "local"}</span>
                    {e.timestamp && (
                      <span className="text-[10px] text-slate-700 font-mono ml-auto">
                        {new Date(e.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-medium text-slate-200 leading-relaxed">Q: {e.instruction}</p>
                  <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">A: {e.output}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

export default MonitorTab;
