/**
 * Settings → Tools & Plugins tab.
 * Extracted from Settings.tsx: the JSX/logic is unchanged; the six UI-only
 * state hooks (search, filters, expanded cards, disable-warning) now live here.
 */

import { useState, type Dispatch, type SetStateAction } from "react";
import { useStore } from "../../../lib/store";
import { useTranslations } from "../../../lib/i18n";
import { getTools } from "../../../lib/api";
import { ToolParams } from "./ui";
import type { ToolItem } from "./constants";

type Health = ReturnType<typeof useStore.getState>["health"];

export interface ToolsTabProps {
  toolsList: ToolItem[];
  setToolsList: Dispatch<SetStateAction<ToolItem[]>>;
  toolsLoading: boolean;
  setToolsLoading: Dispatch<SetStateAction<boolean>>;
  pluginsMap: Record<string, boolean>;
  pluginsLoaded: boolean;
  pluginToggleLoading: string | null;
  permMode: string;
  health: Health;
  handleTogglePlugin: (pName: string, currentVal: boolean, force?: boolean) => Promise<void>;
  handlePermModeChange: (newMode: string) => Promise<void>;
}

export default function ToolsTab({
  toolsList,
  setToolsList,
  toolsLoading,
  setToolsLoading,
  pluginsMap,
  pluginsLoaded,
  pluginToggleLoading,
  permMode,
  health,
  handleTogglePlugin,
  handlePermModeChange,
}: ToolsTabProps) {
  const lang = useStore((s) => s.language);
  const t = useTranslations(lang);
  const [toolSearch, setToolSearch] = useState("");
  const [selectedPlugin, setSelectedPlugin] = useState<string>("all");
  const [selectedPermission, setSelectedPermission] = useState<string>("all");
  // FG-009 (ported from ui): expanded plugin card (lists its tools).
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  // FG-009 (ported from ui): plugin awaiting disable confirmation — the
  // user must explicitly confirm before a plugin with live tools is
  // disabled ("Disable anyway"); cancelling leaves it enabled.
  const [pluginDisableWarn, setPluginDisableWarn] = useState<string | null>(null);

          const pluginsList = ["all", ...Array.from(new Set(toolsList.map((t) => t.plugin).filter(Boolean))).sort()];
          const q = toolSearch.toLowerCase().trim();
          const filtered = toolsList.filter((t) => {
            const matchPlugin = selectedPlugin === "all" || t.plugin === selectedPlugin;
            const matchPermission = selectedPermission === "all" || t.permission === selectedPermission;
            const matchSearch =
              !q ||
              t.name.toLowerCase().includes(q) ||
              (t.description || "").toLowerCase().includes(q) ||
              t.plugin.toLowerCase().includes(q);
            return matchPlugin && matchPermission && matchSearch;
          });

          return (
            <div className="max-w-6xl mx-auto space-y-6">
              {/* Header */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-700/50 pb-5">
                <div>
                  <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                    <span>🛠</span>
                    <span>{t("tools_title")}</span>
                    <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                      <bdi>{toolsLoading ? "…" : toolsList.length}</bdi> {t("tools_armed")}
                    </span>
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    {t("tools_desc")}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setToolsLoading(true);
                      getTools()
                        .then((d) => d?.tools && setToolsList(d.tools))
                        .finally(() => setToolsLoading(false));
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition border border-slate-700 flex items-center gap-1.5"
                  >
                    <span>↻</span> {t("refresh")}
                  </button>
                </div>
              </div>

              {/* 1. AUTONOMY PERMISSION MODE BANNER */}
              <div className="bg-gradient-to-r from-slate-900 via-slate-800/80 to-slate-900 border border-cyan-500/30 rounded-2xl p-5 shadow-xl">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs uppercase font-mono tracking-wider text-cyan-400 font-semibold">
                        {t("tools_autonomy")}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300">
                        {permMode.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1">
                      {t("tools_autonomy_desc")}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 bg-slate-950/70 p-1.5 rounded-xl border border-slate-700/60">
                    <button
                      onClick={() => handlePermModeChange("auto")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition ${
                        permMode === "auto"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                          : "text-slate-400 hover:text-white"
                      }`}
                      title="Autonomous for safe/caution tools; prompts for dangerous actions"
                    >
                      🛡 AUTO (Recommended)
                    </button>
                    <button
                      onClick={() => handlePermModeChange("confirm")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition ${
                        permMode === "confirm"
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          : "text-slate-400 hover:text-white"
                      }`}
                      title="Prompts confirmation for every non-safe action"
                    >
                      ✋ CONFIRM
                    </button>
                    <button
                      onClick={() => handlePermModeChange("bypass")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition ${
                        permMode === "bypass"
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                          : "text-slate-400 hover:text-white"
                      }`}
                      title="Unrestricted autonomous tool execution"
                    >
                      ⚡ BYPASS (Full Auto)
                    </button>
                  </div>
                </div>
              </div>

              {/* 2. PLUGINS DYNAMIC TOGGLE SECTION */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider font-mono">
                    Capability Plugins ({pluginsLoaded ? Object.keys(pluginsMap).length : "…"})
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">Instant hot-reload on toggle</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {Object.entries(pluginsMap).map(([pName, isEnabled]) => {
                    const isBusy = pluginToggleLoading === pName;
                    const toolCount = toolsList.filter((t) => t.plugin === pName).length;
                    const pluginTools = toolsList.filter((t) => t.plugin === pName);
                    const usedByOtherPlugins = toolsList.filter((t) => t.plugin !== pName && pluginTools.some((pt) => t.name === pt.name));
                    return (
                      <div
                        key={pName}
                        className={`bg-slate-800/40 border rounded-xl p-3 flex flex-col justify-between transition ${
                          isEnabled
                            ? "border-cyan-500/30 hover:border-cyan-500/50"
                            : "border-slate-800 opacity-60 hover:opacity-90"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <span className="font-mono text-xs font-semibold text-white block">
                              {pName.replace(/_/g, " ")}
                            </span>
                            <button
                              type="button"
                              onClick={() => setExpandedPlugin(expandedPlugin === pName ? null : pName)}
                              className="text-[10px] text-slate-400 font-mono hover:text-cyan-300 mt-0.5 block"
                              title="Show the tools that depend on this plugin (FG-009)"
                            >
                              {toolCount ? `${toolCount} tools ${expandedPlugin === pName ? "▾" : "▸"}` : "plugin"}
                            </button>
                            {usedByOtherPlugins.length > 0 && isEnabled && (
                              <span className="text-[10px] text-amber-400 mt-0.5 block">
                                ⚠ Used by {usedByOtherPlugins.length} other tool(s)
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              // FG-009: warn before disabling a plugin that still provides tools.
                              if (isEnabled && toolCount > 0) setPluginDisableWarn(pName);
                              else handleTogglePlugin(pName, isEnabled);
                            }}
                            className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
                              isEnabled ? "bg-cyan-500" : "bg-slate-700"
                            } ${isBusy ? "opacity-50" : ""}`}
                          >
                            <span
                              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                                isEnabled ? "left-5" : "left-1"
                              }`}
                            />
                          </button>
                        </div>
                        {/* FG-009: tools that depend on this plugin */}
                        {expandedPlugin === pName && (
                          <div className="mt-1 pt-2 border-t border-slate-800">
                            {toolCount === 0 ? (
                              <p className="text-[10px] text-slate-500 font-mono">No tools registered under this plugin.</p>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {pluginTools.map((t) => (
                                  <span key={t.name} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-cyan-300/90">
                                    {t.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {/* FG-009: confirm before disabling a plugin with live tools.
                            "Disable anyway" is an explicit user confirm and
                            overrides the cross-plugin block in
                            handleTogglePlugin (force=true); the disable stays
                            reversible — re-enabling restores the tools. */}
                        {pluginDisableWarn === pName && (
                          <div className="mt-2 p-2.5 bg-amber-950/50 border border-amber-600/40 rounded-lg space-y-2">
                            <p className="text-[11px] text-amber-200 leading-relaxed">
                              Disable &apos;{pName.replace(/_/g, " ")}&apos;? It provides {toolCount} tool(s) — they will stop working until it is re-enabled.
                            </p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => { setPluginDisableWarn(null); handleTogglePlugin(pName, isEnabled, true); }}
                                className="px-2.5 py-1 text-[11px] bg-amber-600 hover:bg-amber-500 text-white rounded font-semibold transition"
                              >
                                Disable anyway
                              </button>
                              <button
                                onClick={() => setPluginDisableWarn(null)}
                                className="px-2.5 py-1 text-[11px] bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Stats Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-3">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-mono">Total Tools</div>
                  <div className="text-2xl font-bold text-cyan-400 mt-0.5">{toolsLoading ? "…" : toolsList.length}</div>
                </div>
                <div className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-3">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-mono">Active Plugins</div>
                  <div className="text-2xl font-bold text-purple-400 mt-0.5">{health ? (health.plugins?.length ?? 0) : "…"}</div>
                </div>
                <div className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-3">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-mono">Safe (Auto-run)</div>
                  <div className="text-2xl font-bold text-emerald-400 mt-0.5">
                    {toolsLoading ? "…" : toolsList.filter((t) => t.permission === "safe").length}
                  </div>
                </div>
                <div className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-3">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-mono">Caution / Gated</div>
                  <div className="text-2xl font-bold text-amber-400 mt-0.5">
                    {toolsLoading ? "…" : toolsList.filter((t) => t.permission !== "safe").length}
                  </div>
                </div>
              </div>

              {/* Search & Plugin Filter */}
              <div className="space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    value={toolSearch}
                    onChange={(e) => setToolSearch(e.target.value)}
                    placeholder="Search tools by name, description or plugin (e.g. python, 3D, image, shell, browser, memory)..."
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-4 py-3 pl-10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/40 transition"
                  />
                  <span className="absolute left-3.5 top-3.5 text-slate-500 text-sm">🔍</span>
                  {toolSearch && (
                    <button
                      onClick={() => setToolSearch("")}
                      className="absolute right-3.5 top-3 text-slate-400 hover:text-white text-xs bg-slate-800 px-2 py-0.5 rounded"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Plugin filter pills */}
                <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto pb-1">
                  {pluginsList.map((p) => {
                    const count = p === "all" ? toolsList.length : toolsList.filter((t) => t.plugin === p).length;
                    return (
                      <button
                        key={p}
                        onClick={() => setSelectedPlugin(p)}
                        className={`text-xs px-3 py-1.5 rounded-lg font-mono transition flex items-center gap-1.5 ${
                          selectedPlugin === p
                            ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                            : "bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-700/40"
                        }`}
                      >
                        <span>{p}</span>
                        <span className="text-[10px] opacity-60">({count})</span>
                      </button>
                    );
                  })}
                </div>

                {/* Permission filter pills */}
                <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto pb-1">
                  {["all", "safe", "caution", "danger"].map((perm) => {
                    const count = perm === "all" ? toolsList.length : toolsList.filter((t) => t.permission === perm).length;
                    return (
                      <button
                        key={perm}
                        onClick={() => setSelectedPermission(perm as any)}
                        className={`text-xs px-3 py-1.5 rounded-lg font-mono transition flex items-center gap-1.5 ${
                          selectedPermission === perm
                            ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                            : "bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-700/40"
                        }`}
                      >
                        <span>{perm}</span>
                        <span className="text-[10px] opacity-60">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tools List */}
              {toolsLoading ? (
                <div className="text-center py-16 text-slate-400 font-mono text-sm">
                  <div className="animate-spin text-2xl mb-2">↻</div>
                  Loading tools catalog from backend...
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-16 bg-slate-900/30 border border-slate-800 rounded-xl text-slate-400 text-sm">
                  No tools found matching &quot;{toolSearch}&quot;
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {filtered.map((t) => {
                    const isExpanded = expandedTool === t.name;
                    const permColor =
                      t.permission === "safe"
                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                        : t.permission === "caution"
                        ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                        : "bg-rose-500/15 text-rose-400 border-rose-500/30";

                    return (
                      <div
                        key={t.name}
                        className="bg-slate-800/40 hover:bg-slate-800/70 border border-slate-700/50 hover:border-slate-600/80 rounded-xl p-4 transition flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <span className="font-mono text-cyan-300 font-semibold text-sm">
                              {t.name}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${permColor}`}>
                                {t.permission}
                              </span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
                                {t.plugin}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-slate-300 leading-relaxed">
                            {t.description || "No description provided."}
                          </p>
                        </div>

                        {t.parameters && (
                          <div className="mt-3 pt-2.5 border-t border-slate-700/40">
                            <button
                              onClick={() => setExpandedTool(isExpanded ? null : t.name)}
                              className="text-[11px] font-mono text-slate-400 hover:text-cyan-400 flex items-center gap-1 transition"
                            >
                              <span>{isExpanded ? "▾ Hide parameters" : "▸ View parameters"}</span>
                            </button>
                            {isExpanded && <ToolParams parameters={t.parameters} />}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
}
