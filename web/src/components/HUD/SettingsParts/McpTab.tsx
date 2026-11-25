/**
 * Settings → MCP servers tab (server cards, presets, logs, add-server modal).
 * Extracted from Settings.tsx: JSX unchanged; the MCP-only state and handlers
 * (add/toggle/delete/test/connect-preset, server logs, add-modal fields) live here now.
 */

import { useState, type Dispatch, type SetStateAction } from "react";
import { useStore } from "../../../lib/store";
import { useTranslations } from "../../../lib/i18n";
import {
  addMcpServer,
  connectMcpPreset,
  deleteMcpServer,
  getMcpServerLogs,
  getTools,
  testMcpServer,
  toggleMcpServer,
} from "../../../lib/api";
import { Toggle } from "./ui";
import type { McpPresetItem, McpServerItem, PlatformModalTarget, ToolItem } from "./constants";

export interface McpTabProps {
  endpoint: string;
  loadMcp: () => void;
  mcpLoading: boolean;
  mcpPresets: McpPresetItem[];
  mcpServers: McpServerItem[];
  pushToast: (text: string, kind?: "ok" | "error") => void;
  setSelectedPlatformModal: Dispatch<SetStateAction<PlatformModalTarget | null>>;
  setToolsList: Dispatch<SetStateAction<ToolItem[]>>;
}

export default function McpTab({
  endpoint,
  loadMcp,
  mcpLoading,
  mcpPresets,
  mcpServers,
  pushToast,
  setSelectedPlatformModal,
  setToolsList,
}: McpTabProps) {
  const lang = useStore((s) => s.language);
  const t = useTranslations(lang);

  const [presetConnecting, setPresetConnecting] = useState<string | null>(null);

  const [expandedToolsServer, setExpandedToolsServer] = useState<string | null>(null);

  const [serverTesting, setServerTesting] = useState<Record<string, { loading: boolean; latency?: number; error?: string }>>({});

  const [serverLogs, setServerLogs] = useState<Record<string, string>>({});

  const [expandedLogsServer, setExpandedLogsServer] = useState<string | null>(null);

  // FG-010 (ported from ui): per-server "logs endpoint not exposed" flag so
  // the drawer shows an honest unavailable panel instead of "No logs available".
  const [logsUnavailable, setLogsUnavailable] = useState<Record<string, boolean>>({});

  const [showAddMcpModal, setShowAddMcpModal] = useState(false);

  const [newMcpName, setNewMcpName] = useState("");

  const [newMcpCommand, setNewMcpCommand] = useState("");

  const [newMcpArgs, setNewMcpArgs] = useState("");

  const [newMcpDesc, setNewMcpDesc] = useState("");

  const [newMcpEnv, setNewMcpEnv] = useState("");

  // FG-010: fetch one MCP server's logs via the api.ts wrapper.
  // NOTE: GET /api/mcp/servers/{name}/logs does not exist on any backend
  // branch yet (see settings-gap-fix.md) — a failed fetch marks the server
  // unavailable instead of showing fake logs.
  const fetchServerLogs = async (serverName: string) => {
    try {
      const d = await getMcpServerLogs(serverName);
      if (d.ok && d.logs) {
        setServerLogs((prev) => ({ ...prev, [serverName]: d.logs }));
        setLogsUnavailable((prev) => ({ ...prev, [serverName]: false }));
      } else {
        setLogsUnavailable((prev) => ({ ...prev, [serverName]: true }));
      }
    } catch (e) {
      console.error("failed to fetch server logs", e);
      setLogsUnavailable((prev) => ({ ...prev, [serverName]: true }));
    }
  };

  // MCP handlers
  const handleToggleMcp = async (name: string, enabled: boolean) => {
    try {
      const res = await toggleMcpServer(name, enabled);
      if (res.ok) {
        pushToast(`MCP server ${name} ${enabled ? "activated" : "deactivated"}`);
        loadMcp();
        getTools().then((d) => d?.tools && setToolsList(d.tools));
      } else {
        pushToast(`Error toggling MCP: ${res.error}`, "error");
      }
    } catch {
      pushToast("Failed to reach server", "error");
    }
  };

  const handleDeleteMcp = async (name: string) => {
    try {
      const res = await deleteMcpServer(name);
      if (res.ok) {
        pushToast(`Deleted MCP server ${name}`);
        loadMcp();
        getTools().then((d) => d?.tools && setToolsList(d.tools));
      } else {
        pushToast(`Error: ${res.error}`, "error");
      }
    } catch {
      pushToast("Failed to reach server", "error");
    }
  };

  const handleAddMcp = async () => {
    if (!newMcpName.trim() || !newMcpCommand.trim()) {
      pushToast("Name and command are required", "error");
      return;
    }
    let args: string[] = [];
    const trimmedArgs = newMcpArgs.trim();
    if (trimmedArgs.startsWith("[") && trimmedArgs.endsWith("]")) {
      try {
        args = JSON.parse(trimmedArgs);
      } catch {
        args = trimmedArgs.slice(1, -1).split(",").map(s => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
      }
    } else if (trimmedArgs) {
      args = trimmedArgs.split(/\s+/).filter(Boolean);
    }

    let envObj: Record<string, string> = {};
    const trimmedEnv = newMcpEnv.trim();
    if (trimmedEnv.startsWith("{") && trimmedEnv.endsWith("}")) {
      try {
        envObj = JSON.parse(trimmedEnv);
      } catch {
        pushToast("Invalid JSON in environment variables", "error");
        return;
      }
    } else if (trimmedEnv) {
      // Allow KEY=VALUE line by line
      for (const line of trimmedEnv.split("\n")) {
        const parts = line.split("=");
        if (parts.length >= 2) {
          const k = parts[0].trim();
          const v = parts.slice(1).join("=").trim();
          if (k) envObj[k] = v;
        }
      }
    }

    try {
      const res = await addMcpServer({
        name: newMcpName.trim(),
        command: newMcpCommand.trim(),
        args,
        env: envObj,
        enabled: true,
        description: newMcpDesc.trim(),
      });
      if (res.ok) {
        pushToast(`Added MCP server ${newMcpName}`);
        setShowAddMcpModal(false);
        setNewMcpName("");
        setNewMcpCommand("");
        setNewMcpArgs("");
        setNewMcpDesc("");
        setNewMcpEnv("");
        loadMcp();
        getTools().then((d) => d?.tools && setToolsList(d.tools));
      } else {
        pushToast(`Failed to add MCP: ${res.error}`, "error");
      }
    } catch {
      pushToast("Failed to reach server", "error");
    }
  };

  const handleConnectPreset = async (presetId: string) => {
    setPresetConnecting(presetId);
    try {
      const res = await connectMcpPreset(presetId);
      if (res.ok) {
        pushToast(`⚡ Connected '${res.server}' successfully (${res.tools_count} tools ready)!`);
        loadMcp();
        getTools().then((d) => d?.tools && setToolsList(d.tools));
      } else {
        pushToast(`Connection error: ${res.error || "Failed to start"}`, "error");
      }
    } catch (err: any) {
      pushToast(`Failed to connect preset: ${err?.message || err}`, "error");
    } finally {
      setPresetConnecting(null);
    }
  };

  const handleTestMcpServer = async (serverName: string) => {
    setServerTesting((prev) => ({ ...prev, [serverName]: { loading: true } }));
    try {
      const res = await testMcpServer(serverName);
      if (res.ok) {
        setServerTesting((prev) => ({
          ...prev,
          [serverName]: { loading: false, latency: res.latency_ms },
        }));
        pushToast(`✓ MCP '${serverName}' live test passed (${res.latency_ms}ms, ${res.tools_count} tools)!`);
        loadMcp();
      } else {
        setServerTesting((prev) => ({
          ...prev,
          [serverName]: { loading: false, error: res.error },
        }));
        pushToast(`MCP '${serverName}' test failed: ${res.error}`, "error");
      }
    } catch (err: any) {
      setServerTesting((prev) => ({
        ...prev,
        [serverName]: { loading: false, error: err?.message || "Timeout" },
      }));
      pushToast(`Failed to test server: ${err?.message || "Network error"}`, "error");
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b border-slate-700/50 pb-5">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <span>🔌</span> {t("mcp_title")}
            <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
              <bdi>{mcpServers.filter((s) => s.enabled).length}</bdi> {t("mcp_active_count")}
            </span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">{t("mcp_desc")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadMcp}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg border border-slate-700 flex items-center gap-1.5 transition">
            ↻ {t("refresh")}
          </button>
          <button onClick={() => setShowAddMcpModal(true)}
            className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-xs rounded-lg flex items-center gap-1.5 transition font-semibold">
            {t("mcp_add")}
          </button>
        </div>
      </div>

      {/* 1-Click Dynamic Presets */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <span>⚡</span> {t("mcp_presets")}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === "ar" ? "خوادم مدمجة ومكتشفة تلقائياً تتصل فورياً دون تحميل خارجي" : "Built-in & auto-discovered MCP servers ready for instant 1-click activation"}
            </p>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
            {t("mcp_offline_ready")}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
          {(mcpPresets.length > 0 ? mcpPresets : [
            { id: "filesystem", name: "filesystem", label: "Filesystem", icon: "📁", desc: "Local workspace filesystem", auto_detected: true, detection_info: "JARVIS Workspace", already_configured: mcpServers.some(s => s.name === "filesystem"), is_running: false },
            { id: "github", name: "github", label: "GitHub", icon: "🐙", desc: "Repos, PRs, issues", auto_detected: true, detection_info: "gh CLI detected", already_configured: mcpServers.some(s => s.name === "github"), is_running: false },
            { id: "sqlite", name: "sqlite", label: "SQLite", icon: "🗃", desc: "JARVIS databases", auto_detected: true, detection_info: "models.db ready", already_configured: mcpServers.some(s => s.name === "sqlite"), is_running: false },
            { id: "puppeteer", name: "puppeteer", label: "Puppeteer", icon: "🤖", desc: "Browser automation", auto_detected: true, detection_info: "NPX Ready", already_configured: mcpServers.some(s => s.name === "puppeteer"), is_running: false },
            { id: "brave-search", name: "brave-search", label: "Brave Search", icon: "🔍", desc: "Live web search & news", auto_detected: false, detection_info: "Requires Key", already_configured: mcpServers.some(s => s.name === "brave-search"), is_running: false },
          ]).map((preset) => {
            const alreadyConfigured = mcpServers.some((s) => s.name === preset.id);
            const isConnecting = presetConnecting === preset.id;
            return (
              <div
                key={preset.id}
                className={`flex flex-col justify-between p-4 rounded-xl border transition ${
                  alreadyConfigured
                    ? "border-emerald-600/40 bg-emerald-950/20 text-emerald-300"
                    : "border-slate-700/70 bg-slate-800/60 hover:border-purple-500/50 text-slate-300 shadow-sm"
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl">{preset.icon}</span>
                    {preset.auto_detected ? (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <bdi dir="auto">{preset.detection_info || t("mcp_auto_detected")}</bdi>
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400">
                        <bdi dir="auto">{preset.detection_info}</bdi>
                      </span>
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white tracking-wide">{preset.label}</h4>
                    <p className="text-[11px] text-slate-400 leading-snug mt-0.5 line-clamp-2">{preset.desc}</p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-700/40 mt-3">
                  {alreadyConfigured ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() =>
                          setSelectedPlatformModal({
                            id: preset.id,
                            name: preset.label,
                            icon: preset.icon,
                            serverConfig: mcpServers.find((s) => s.name === preset.id),
                          })
                        }
                        className="flex-1 py-1 px-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center justify-center gap-1 cursor-pointer"
                        title="Inspect Platform"
                      >
                        🔍 {t("inspect_platform")}
                      </button>
                      <span className="text-[10px] px-1.5 py-1 bg-emerald-900/40 text-emerald-400 font-mono rounded border border-emerald-700/40">
                        READY
                      </span>
                      <span className="text-[10px] px-1.5 py-1 bg-cyan-900/40 text-cyan-300 font-mono rounded border border-cyan-700/40">
                        Health: 95%
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleConnectPreset(preset.id)}
                      disabled={isConnecting}
                      className="w-full py-1.5 px-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg text-xs font-semibold shadow-md transition disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {isConnecting ? (
                        <span className="animate-pulse">{t("testing")}</span>
                      ) : (
                        <span>{t("mcp_connect_btn")}</span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Configured Servers */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            {lang === "ar" ? "الخوادم المهيأة والنشطة" : "Configured Servers"}
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            <bdi>{mcpServers.length}</bdi> {lang === "ar" ? "خوادم مجهزة" : "servers loaded"}
          </span>
        </div>

        {mcpLoading && <div className="text-slate-400 text-sm py-4">{t("loading")}</div>}
        {!mcpLoading && mcpServers.length === 0 && (
          <div className="bg-slate-800/40 border border-dashed border-slate-700 rounded-xl p-8 text-center space-y-2">
            <p className="text-slate-300 text-sm font-semibold">
              {lang === "ar" ? "لم يتم ربط أي خادم MCP حتى الآن." : "No MCP servers configured yet."}
            </p>
            <p className="text-slate-500 text-xs">
              {lang === "ar" ? "انقر على أحد الخوادم الجاهزة بالأعلى للاتصال التلقائي بنقرة واحدة." : "Click any preset card above for instant 1-click connection."}
            </p>
          </div>
        )}

        {mcpServers.map((srv) => {
          const isConn = srv.connected ?? srv.enabled;
          const toolCount = srv.tools_count ?? srv.tools?.length ?? 0;
          const isTesting = serverTesting[srv.name]?.loading;
          const testLatency = serverTesting[srv.name]?.latency;
          const testError = serverTesting[srv.name]?.error;
          const isToolsExpanded = expandedToolsServer === srv.name;

          return (
            <div
              key={srv.name}
              className={`bg-slate-800/50 border rounded-xl overflow-hidden transition ${
                isConn ? "border-purple-500/40 shadow-sm" : "border-slate-700/50 opacity-75"
              }`}
            >
              <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-sm text-white">{srv.name}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border font-mono flex items-center gap-1 ${
                        isConn
                          ? "bg-emerald-900/40 border-emerald-600/40 text-emerald-300"
                          : "bg-slate-900/40 border-slate-600/40 text-slate-400"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${isConn ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
                      {isConn ? "CONNECTED" : "STOPPED"}
                    </span>

                    <span className="text-[10px] px-2 py-0.5 bg-purple-900/30 border border-purple-600/30 text-purple-300 rounded font-mono">
                      <bdi>{toolCount}</bdi> tools
                    </span>

                    {testLatency !== undefined && (
                      <span className="text-[10px] px-2 py-0.5 bg-cyan-950/40 border border-cyan-600/40 text-cyan-300 rounded font-mono">
                        ⚡ <bdi>{testLatency}ms</bdi>
                      </span>
                    )}
                  </div>

                  {srv.description && <p className="text-xs text-slate-400">{srv.description}</p>}
                  {srv.error && (
                    <p className="text-xs text-rose-400 font-mono bg-rose-950/30 px-2 py-1 rounded border border-rose-800/40">
                      ⚠ {srv.error}
                    </p>
                  )}
                  {testError && (
                    <p className="text-xs text-rose-400 font-mono bg-rose-950/30 px-2 py-1 rounded border border-rose-800/40">
                      ✕ Test failed: {testError}
                    </p>
                  )}

                  <code className="text-[11px] text-slate-500 font-mono block truncate" dir="ltr">
                    {srv.command} {(srv.args || []).join(" ")}
                  </code>
                </div>

                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  {/* Inspect Platform Dashboard */}
                  <button
                    onClick={() =>
                      setSelectedPlatformModal({
                        id: srv.name,
                        name: srv.name.toUpperCase(),
                        icon:
                          srv.name === "github"
                            ? "🐙"
                            : srv.name === "sqlite"
                            ? "🗃"
                            : srv.name === "filesystem"
                            ? "📁"
                            : "🔌",
                        serverConfig: srv,
                      })
                    }
                    className="px-2.5 py-1 text-xs bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-300 border border-cyan-800/60 rounded-lg transition font-mono flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <span>📊 {t("inspect_platform")}</span>
                  </button>

                  {/* Test Live Button */}
                  <button
                    onClick={() => handleTestMcpServer(srv.name)}
                    disabled={isTesting}
                    className="px-2.5 py-1 text-xs bg-slate-900/80 hover:bg-slate-700/80 text-cyan-300 border border-cyan-800/50 rounded-lg transition font-mono flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    {isTesting ? (
                      <span className="animate-pulse">{t("testing")}</span>
                    ) : (
                      <span>🔬 {t("mcp_test_btn")}</span>
                    )}
                  </button>

                  {/* View Logs Button */}
                  <button
                    onClick={() => {
                      setExpandedLogsServer(expandedLogsServer === srv.name ? null : srv.name);
                      if (expandedLogsServer !== srv.name) fetchServerLogs(srv.name);
                    }}
                    className="px-2.5 py-1 text-xs bg-slate-900/80 hover:bg-slate-700/80 text-amber-300 border border-amber-800/50 rounded-lg transition font-mono flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>📋 Logs</span>
                  </button>

                  {/* Expand Tools Button */}
                  <button
                    onClick={() => setExpandedToolsServer(isToolsExpanded ? null : srv.name)}
                    className={`px-2.5 py-1 text-xs rounded-lg border font-mono transition flex items-center gap-1.5 cursor-pointer ${
                      isToolsExpanded
                        ? "bg-purple-900/50 border-purple-500 text-purple-200"
                        : "bg-purple-950/30 hover:bg-purple-900/40 border-purple-800/40 text-purple-300"
                    }`}
                  >
                    <span>🛠 {isToolsExpanded ? t("mcp_hide_tools") : `${t("mcp_view_tools")} (${toolCount})`}</span>
                  </button>

                  {/* Power Toggle */}
                  <button
                    onClick={() => handleToggleMcp(srv.name, srv.enabled)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      srv.enabled ? "bg-purple-500" : "bg-slate-700"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                        srv.enabled ? "left-5" : "left-1"
                      }`}
                    />
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => handleDeleteMcp(srv.name)}
                    className="px-2.5 py-1 text-xs bg-red-950/60 hover:bg-red-900/80 text-red-300 rounded-lg border border-red-800/50 transition cursor-pointer"
                    title="Delete server"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Discovered Tools Drawer */}
              {isToolsExpanded && (
                <div className="bg-slate-950/70 border-t border-slate-700/60 p-4 space-y-3 animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-semibold text-purple-300 flex items-center gap-2">
                      <span>📦</span> {lang === "ar" ? "قائمة الأدوات المكتشفة حياً عبر البروتوكول" : "Live Discovered Tools (JSON-RPC 2.0)"}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      <bdi>{srv.tools?.length ?? toolCount}</bdi> {lang === "ar" ? "أداة نشطة" : "active tools"}
                    </span>
                  </div>

                  {(!srv.tools || srv.tools.length === 0) ? (
                    <div className="text-xs text-slate-500 py-3 text-center font-mono">
                      {lang === "ar" ? "لم ترجع استجابة الأدوات حتى الآن. اضغط على 'فحص الاتصال' للاستعلام." : "No tools reported. Click 'Test Connection' to query live server."}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {srv.tools.map((tool: any, tIdx: number) => {
                        const tName = typeof tool === "string" ? tool : tool.name;
                        const tDesc = typeof tool === "string" ? "" : tool.description;
                        const tProps = typeof tool === "object" && tool.inputSchema?.properties ? Object.keys(tool.inputSchema.properties) : [];
                        const reqProps = typeof tool === "object" && tool.inputSchema?.required ? tool.inputSchema.required : [];
                        return (
                          <div key={tIdx} className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-3 space-y-1.5 text-start">
                            <div className="flex items-center justify-between">
                              <code className="text-xs text-cyan-300 font-mono font-semibold" dir="ltr">{tName}</code>
                              {tProps.length > 0 && (
                                <span className="text-[10px] text-slate-400 font-mono">
                                  <bdi>{tProps.length}</bdi> params
                                </span>
                              )}
                            </div>
                            {tDesc && <p className="text-[11px] text-slate-300 leading-snug">{tDesc}</p>}
                            {tProps.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-1" dir="ltr">
                                {tProps.map((p) => {
                                  const isRequired = reqProps.includes(p);
                                  return (
                                    <span
                                      key={p}
                                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                                        isRequired
                                          ? "bg-purple-950/60 border-purple-700/60 text-purple-200"
                                          : "bg-slate-800/80 border-slate-700/80 text-slate-400"
                                      }`}
                                    >
                                      {p}{isRequired ? "*" : ""}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Server Logs Drawer */}
              {expandedLogsServer === srv.name && (
                <div className="bg-slate-950/70 border-t border-slate-700/60 p-4 space-y-3 animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-semibold text-amber-300 flex items-center gap-2">
                      <span>📋</span> Server Logs
                    </span>
                    <button
                      onClick={() => fetchServerLogs(srv.name)}
                      className="text-[10px] text-slate-400 hover:text-amber-300 font-mono transition"
                    >
                      ↻ Refresh
                    </button>
                  </div>
                  {serverLogs[srv.name] ? (
                    <pre className="text-[10px] font-mono text-slate-300 bg-slate-900 p-3 rounded-lg overflow-x-auto max-h-48 whitespace-pre-wrap">
                      {serverLogs[srv.name]}
                    </pre>
                  ) : logsUnavailable[srv.name] ? (
                    <div className="text-xs text-slate-500 py-3 text-center font-mono">
                      Server logs are not available: GET /api/mcp/servers/{srv.name}/logs is not exposed by the backend on this branch yet.
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 py-3 text-center font-mono">
                      Loading logs…
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add MCP Modal */}
      {showAddMcpModal && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAddMcpModal(false);
          }}
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/80 bg-slate-950/40">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <span>🔌</span> {lang === "ar" ? "إضافة خادم MCP جديد" : "Add New MCP Server"}
              </h3>
              <button
                onClick={() => setShowAddMcpModal(false)}
                className="text-slate-400 hover:text-white text-xl transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-6 space-y-4 text-start">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-semibold uppercase tracking-wider">
                  {lang === "ar" ? "اسم الخادم (Identifier)" : "Server Name"}
                </label>
                <input
                  type="text"
                  value={newMcpName}
                  onChange={(e) => setNewMcpName(e.target.value)}
                  placeholder="e.g. custom-sqlite"
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:border-purple-500 focus:outline-none"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-semibold uppercase tracking-wider">
                  {lang === "ar" ? "الأمر التنفيذي (Command)" : "Command Executable"}
                </label>
                <input
                  type="text"
                  value={newMcpCommand}
                  onChange={(e) => setNewMcpCommand(e.target.value)}
                  placeholder="e.g. /home/kozer/AI/JARVIS/venv/bin/python or npx"
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:border-purple-500 focus:outline-none"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-300 font-semibold uppercase tracking-wider">
                    {lang === "ar" ? "معاملات التشغيل (Arguments)" : "Arguments"}
                  </label>
                  <span className="text-[10px] text-slate-400">
                    {lang === "ar" ? "افصل بمسافة أو مصفوفة JSON" : "Space-separated or JSON array"}
                  </span>
                </div>
                <input
                  type="text"
                  value={newMcpArgs}
                  onChange={(e) => setNewMcpArgs(e.target.value)}
                  placeholder="e.g. -m jarvis.mcp_servers.sqlite data/models.db"
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:border-purple-500 focus:outline-none"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-semibold uppercase tracking-wider">
                  {lang === "ar" ? "الوصف" : "Description"}
                </label>
                <input
                  type="text"
                  value={newMcpDesc}
                  onChange={(e) => setNewMcpDesc(e.target.value)}
                  placeholder="Short description of this MCP server"
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:border-purple-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-300 font-semibold uppercase tracking-wider">
                    {lang === "ar" ? "متغيرات البيئة (Environment Variables)" : "Environment Variables"}
                  </label>
                  <span className="text-[10px] text-slate-400">KEY=VALUE</span>
                </div>
                <textarea
                  value={newMcpEnv}
                  onChange={(e) => setNewMcpEnv(e.target.value)}
                  placeholder={`GITHUB_TOKEN=gho_...\nAPI_KEY=xyz`}
                  rows={3}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm font-mono resize-none focus:border-purple-500 focus:outline-none"
                  dir="ltr"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700/80 bg-slate-950/40">
              <button
                onClick={() => setShowAddMcpModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm transition cursor-pointer"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleAddMcp}
                disabled={!newMcpName.trim() || !newMcpCommand.trim()}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-semibold transition disabled:opacity-40 shadow-lg cursor-pointer"
              >
                {lang === "ar" ? "حفظ وتفعيل الخادم" : "Add & Connect"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
