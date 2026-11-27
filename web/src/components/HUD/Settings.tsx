/**
 * SETTINGS PANEL — full-page UI with sidebar navigation.
 *
 * MERGED (2026-11-24, merge-v2): audit/fixes base (6266 lines, full tab set:
 * ai/tools/mcp/integrations/system/monitor/auth/vault) + the ui-hud-upgrade
 * Settings-UI gap fixes (FG-003 pool position/failures, FG-007 ToolParams,
 * FG-009 plugin expand, FG-010 logs-unavailable state, FG-014/016 test
 * history). All other FG fixes were already present in the audit/fixes base
 * — see merged/REPORT-settings-api.md for the per-fix checklist.
 *
 * Follow-up (2026-11-24, merge-v2 fixups): the cascade/keys/verified
 * loaders now call the api.ts wrappers (FG-004/005/006: getCascadeStatus,
 * getKeysStatus, getVerifiedModels), MCP logs go through getMcpServerLogs
 * (FG-010), the plugin-disable confirm dialog is ported from ui (FG-009),
 * handleTestAllIntegrations tests every integration in turn (FG-016), and
 * the Settings Backup section (export / import / reset, FG-019/020) is
 * ported from ui. All ports are client-side + existing config endpoints;
 * no new backend calls were added.
 *
 * Every control is wired to the backend GET/POST /api/config endpoints.
 * API keys are POSTed to /api/models (body, not URL) and persisted to .env
 * by the backend.  No alert()/confirm() — all feedback is inline.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../../lib/store";
import { useTranslations } from "../../lib/i18n";
import {
  getTools,
  getPlugins,
  togglePlugin,
  getMcpServers,
  getMcpPresets,
  getHealth,
  getCascadeStatus,
  getKeysStatus,
  getVerifiedModels,
  authFetch,
} from "../../lib/api";
import AuthTab from "./AuthTab";
import VaultTab from "./VaultTab";
import {
  PROVIDER_ENDPOINTS,
  PREDEFINED_MODELS,
  PROVIDER_INFO,
  type Toast,
  type ToolItem,
  type IntegrationsConfig,
  type PlatformModalTarget,
  type McpServerItem,
  type McpPresetItem,
  type ConfirmDialogState,
  type KeyPoolItem,
  type BenchmarkEntry,
  type RosterMember,
  type OllamaStatus,
  type VerifiedModelInfo,
  type AiSubTab,
} from "./SettingsParts/constants";
import ToolsTab from "./SettingsParts/ToolsTab";
import {
  BRAIN_DEFAULTS,
  brainMergeImported,
  brainMergeLoaded,
  brainToServer,
  type BrainConfig,
} from "./SettingsParts/brainConfig";
import {
  VAD_DEFAULTS,
  vadApplyImported,
  vadFromServer,
  vadToServer,
  type VadConfig,
} from "./SettingsParts/vadConfig";
import IntegrationsTab from "./SettingsParts/IntegrationsTab";
import McpTab from "./SettingsParts/McpTab";
import SystemDisplaySection from "./SettingsParts/SystemDisplaySection";
import SystemVoiceSection from "./SettingsParts/SystemVoiceSection";
import SwarmSection from "./SettingsParts/SwarmSection";
import ProvidersSection from "./SettingsParts/ProvidersSection";
import CouncilSection from "./SettingsParts/CouncilSection";
import BrainConfigPanel from "./SettingsParts/BrainConfigPanel";
import InferenceOllamaCard from "./SettingsParts/InferenceOllamaCard";
import InferenceProviderSection from "./SettingsParts/InferenceProviderSection";
import SystemDiagnosticsSection from "./SettingsParts/SystemDiagnosticsSection";
import SystemDataSection from "./SettingsParts/SystemDataSection";
import MonitorTab from "./SettingsParts/MonitorTab";
import PlatformDetailModal from "./SettingsParts/PlatformDetailModal";

interface SettingsProps {
  onClose: () => void;
  initialTab?: string;
}

export default function Settings({ onClose, initialTab }: SettingsProps) {
  const health = useStore((s) => s.health);

  // Tab normalization into Master Tabs
  const normalizeTab = (t?: string) => {
    if (!t) return "ai";
    if (t === "auth") return "auth";
    if (t === "vault") return "vault";
    if (["ai", "model", "providers"].includes(t)) return "ai";
    if (["tools", "plugins"].includes(t)) return "tools";
    if (["mcp"].includes(t)) return "mcp";
    if (["integrations", "smart_home"].includes(t)) return "integrations";
    if (["system", "general", "voice", "display", "data"].includes(t)) return "system";
    if (["monitor", "learning", "stats"].includes(t)) return "monitor";
    return "ai";
  };

  // ── Language / i18n ───────────────────────────────────────────────────────
  const lang = useStore((s) => s.language);
  const t = useTranslations(lang);

  const [activeTab, setActiveTab] = useState(normalizeTab(initialTab));
  const [aiSubTab, setAiSubTab] = useState<AiSubTab>(
    initialTab === "providers" ? "providers" : "inference"
  );

  // ── Ollama Service Control state ───────────────────────────────────────────
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);

  const [benchmarkLeaderboard, setBenchmarkLeaderboard] = useState<BenchmarkEntry[]>([]);
  const [dynamicRoster, setDynamicRoster] = useState<RosterMember[]>([]);

  // ── Bulk API Keys Import state ──────────────────────────────────────────────
  const bulkFileInputRef = useRef<HTMLInputElement>(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkProvider, setBulkProvider] = useState("auto");
  const [bulkResult, setBulkResult] = useState<{
    ok: boolean;
    total_found: number;
    total_added: number;
    total_rejected: number;
    total_duplicates: number;
    by_provider: Record<string, number>;
    details: Array<{ provider: string; masked: string; status: string; message: string }>;
    message?: string;
  } | null>(null);

  const [systemSubTab, setSystemSubTab] = useState<"voice" | "display" | "diagnostics" | "data">(
    initialTab === "voice" ? "voice" : initialTab === "display" ? "display" : initialTab === "data" ? "data" : "voice"
  );

  const [agents, setAgents] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // ── Tools & Plugins state ──────────────────────────────────────────────────
  const [toolsList, setToolsList] = useState<ToolItem[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);

  // Plugins list & toggling
  const [pluginsMap, setPluginsMap] = useState<Record<string, boolean>>({});
  const [pluginsLoaded, setPluginsLoaded] = useState(false);
  const [pluginToggleLoading, setPluginToggleLoading] = useState<string | null>(null);

  // ── MCP State ─────────────────────────────────────────────────────────────


  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([]);
  const [mcpPresets, setMcpPresets] = useState<McpPresetItem[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [selectedPlatformModal, setSelectedPlatformModal] = useState<PlatformModalTarget | null>(null);

  // ── Integrations State ────────────────────────────────────────────────────
  const [integrations, setIntegrations] = useState<IntegrationsConfig>({
    home_assistant: { url: "", token: "", enabled: false },
    calendar: { ical_url: "", enabled: false },
    email: { smtp_host: "", smtp_port: 587, username: "", password: "", enabled: false },
    telegram: { bot_token: "", chat_id: "", enabled: false },
    facebook: { page_id: "", page_access_token: "", enabled: false },
    youtube: { client_id: "", client_secret: "", refresh_token: "", channel_id: "", enabled: false },
    instagram: { user_id: "", access_token: "", enabled: false },
    tiktok: { client_key: "", client_secret: "", access_token: "", open_id: "", enabled: false },
    social_platforms: {},
  });

  useEffect(() => {
    if (initialTab) {
      const norm = normalizeTab(initialTab);
      setActiveTab(norm);
      if (initialTab === "providers") setAiSubTab("providers");
      if (initialTab === "model") setAiSubTab("inference");
      if (["voice", "display", "data"].includes(initialTab)) {
        setSystemSubTab(initialTab as any);
      }
    }
  }, [initialTab]);

  useEffect(() => {
    if ((activeTab === "tools" || activeTab === "ai") && toolsList.length === 0) {
      setToolsLoading(true);
      getTools()
        .then((data) => {
          if (data?.tools) setToolsList(data.tools);
        })
        .catch((e) => console.error("failed to fetch tools", e))
        .finally(() => setToolsLoading(false));
    }
  }, [activeTab, toolsList.length]);

  // ── Config state (loaded from GET /api/config) ───────────────────────────
  const [provider, setProvider] = useState("openai_compatible");
  const [model, setModel] = useState("qwen2.5:1.5b");
  const [endpoint, setEndpoint] = useState("http://localhost:11434/v1");
  const [maxTokens, setMaxTokens] = useState(1024);
  const [temperature, setTemperature] = useState(0.3);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, boolean>>({});
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  // true = models came from a live API call, false = still on predefined fallback
  const [modelsFetched, setModelsFetched] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Multi-key pool & Fallback state
  const [keyPools, setKeyPools] = useState<Record<string, KeyPoolItem[]>>({});
  const [newKeyInput, setNewKeyInput] = useState("");
  const [addingKey, setAddingKey] = useState(false);
  const [keyAddError, setKeyAddError] = useState<string | null>(null);
  const [keyAddSuccess, setKeyAddSuccess] = useState<string | null>(null);
  const [enableFallback, setEnableFallback] = useState(false);
  const [fallbackProvider, setFallbackProvider] = useState("gemini");
  const [fallbackModel, setFallbackModel] = useState("gemini-2.0-flash");

  // ── Model Verification Status state ───────────────────────────────────────
  const [verifiedModels, setVerifiedModels] = useState<Record<string, VerifiedModelInfo>>({});

  // ── Cascade Status state (shared between Inference and Monitor tabs) ─────────
  const [cascadeInfo, setCascadeInfo] = useState<{
    online: boolean;
    tiers: { name: string; provider: string; model: string; is_local: boolean; timeout: number; ttft_timeout: number }[];
  } | null>(null);

  // FG-004: fetch the live cascade configuration via the api.ts wrapper.
  const fetchCascadeInfo = async () => {
    try {
      const d = await getCascadeStatus();
      if (d.ok) setCascadeInfo(d);
    } catch { /* ignore */ }
  };

  // FG-006: fetch verified-model statuses via the api.ts wrapper.
  const fetchVerifiedModels = async () => {
    try {
      const d = await getVerifiedModels();
      if (d.ok && d.models) {
        const modelMap: Record<string, { status: string; latency_ms: number | null; last_tested: string }> = {};
        d.models.forEach((m: any) => {
          modelMap[m.model_name] = {
            status: m.status,
            latency_ms: m.latency_ms,
            last_tested: m.last_tested,
          };
        });
        setVerifiedModels(modelMap);
      }
    } catch { /* ignore */ }
  };

  // ── Brain / Ultimate Config state — one object; field list, wire names and merge
  // rules live in SettingsParts/brainConfig.ts ───────────────────────────────────
  const [brain, setBrain] = useState<BrainConfig>(BRAIN_DEFAULTS);

  // Provider config modal state (Providers tab)
  const [providerConfigModal, setProviderConfigModal] = useState<string | null>(null);
  const [modalNewKey, setModalNewKey] = useState("");
  const [modalAddingKey, setModalAddingKey] = useState(false);
  const [modalKeyError, setModalKeyError] = useState<string | null>(null);
  const [modalKeySuccess, setModalKeySuccess] = useState<string | null>(null);
  const [modalLoadingModels, setModalLoadingModels] = useState(false);
  const [modalModelCounts, setModalModelCounts] = useState<Record<string, number>>({});
  const [voiceProvider, setVoiceProvider] = useState("auto");
  const [edgeRate, setEdgeRate] = useState("-6%");
  const [ttsVolume, setTtsVolume] = useState(0.9);
  const [chatLanguage, setChatLanguage] = useState<"en" | "ar">("en");
  const [edgeVoiceAr, setEdgeVoiceAr] = useState("ar-SA-HamedNeural");
  const [edgeVoiceEn, setEdgeVoiceEn] = useState("en-GB-ThomasNeural");

  // VAD Calibration state — one object; field list, wire names and default
  // tables live in SettingsParts/vadConfig.ts.
  const [vad, setVad] = useState<VadConfig>(VAD_DEFAULTS);

  // UI settings
  const [theme, setTheme] = useState("jarvis");
  const [showEmojis, setShowEmojis] = useState(true);
  const [showStatusBar, setShowStatusBar] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(1500);

  // Permissions
  const [permMode, setPermMode] = useState("confirm");

  // ── Toast helper ─────────────────────────────────────────────────────────
  const pushToast = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const [modelError, setModelError] = useState<string | null>(null);

  // ── Fetch models via POST (key in body, not URL) ─────────────────────────
  // Defined before useEffect so the initial load can call it immediately.
  const fetchModels = useCallback(async (prov: string, key: string, ep: string) => {
    setLoadingModels(true);
    setKeyValid(null);
    setModelError(null);
    try {
      const cleanKey = (key || "").trim();
      // Only send api_key if it's non-empty - let backend fetch from KeyManager otherwise
      const body: any = { provider: prov, endpoint: ep };
      if (cleanKey) {
        body.api_key = cleanKey;
      }
      const resp = await authFetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (data.models && data.models.length > 0) {
        const isLive = Boolean(data.fetched);
        setModelsFetched(isLive);
        setAvailableModels(data.models); // Always update availableModels with fetched data
        console.log(`[fetchModels] ${prov}: ${data.models.length} models, isLive=${isLive}`);
        if (isLive) {
          setKeyValid(true);
          setModelError(null);
          setModel((curr) => (data.models.includes(curr) ? curr : data.models[0]));
          setDirty(true);
        } else if (data.error) {
          // Has models from fallback, but key validation failed
          setKeyValid(false);
          setModelError(data.error);
        } else {
          setKeyValid(null);
          setModelError(null);
        }
      } else {
        // Fallback to predefined
        setAvailableModels(PREDEFINED_MODELS[prov] || []);
        setModelsFetched(false);
        setKeyValid(false);
        if (data.error) {
          setModelError(data.error);
          pushToast("Model error: " + data.error, "error");
        }
      }
    } catch (err: any) {
      setAvailableModels(PREDEFINED_MODELS[prov] || []);
      setModelsFetched(false);
      setKeyValid(false);
      setModelError(err?.message || "Failed to reach server");
    } finally {
      setLoadingModels(false);
    }
  }, [pushToast]);

  // Load MCP servers and presets
  const loadMcp = useCallback(() => {
    setMcpLoading(true);
    Promise.all([
      getMcpServers().catch((e) => {
        console.error("failed to fetch mcp servers", e);
        return { servers: [] };
      }),
      getMcpPresets().catch((e) => {
        console.error("failed to fetch mcp presets", e);
        return { presets: [] };
      }),
    ])
      .then(([serversRes, presetsRes]) => {
        if (serversRes?.servers) setMcpServers(serversRes.servers);
        if (presetsRes?.presets) setMcpPresets(presetsRes.presets);
      })
      .finally(() => setMcpLoading(false));
  }, []);


  // ── Load config on mount ─────────────────────────────────────────────────
  useEffect(() => {
    authFetch("/api/config")
      .then((r) => r.json())
      .then((j) => {
        if (j.model) {
          setProvider(j.model.provider ?? "openai_compatible");
          setModel(j.model.model ?? "");
          setEndpoint(j.model.endpoint ?? "");
          setMaxTokens(j.model.max_tokens ?? 1024);
          setTemperature(j.model.temperature ?? 0.3);
          if (j.model.fallback_provider) {
            setFallbackProvider(j.model.fallback_provider);
            setEnableFallback(true);
          }
          if (j.model.fallback_model) {
            setFallbackModel(j.model.fallback_model);
          }
        }
        if (j.api_keys) setApiKeyStatus(j.api_keys);
        if (j.voice) {
          setVoiceProvider(j.voice.provider ?? "auto");
          setEdgeVoiceAr(j.voice.edge_voice?.startsWith("ar-") ? j.voice.edge_voice : "ar-SA-HamedNeural");
          setEdgeVoiceEn(j.voice.edge_voice_en?.startsWith("en-") ? j.voice.edge_voice_en : "en-GB-ThomasNeural");
          setEdgeRate(j.voice.edge_rate ?? "-6%");
          setTtsVolume(j.voice.pyttsx3_volume ?? 0.9);
          setChatLanguage(j.voice.chat_language ?? "en");
          useStore.getState().setSpeechLanguage(j.voice.chat_language === "ar" ? "ar" : "en");
        }
        if (j.vad) setVad(vadFromServer(j.vad));
        if (j.ui) {
          setTheme(j.ui.theme ?? "jarvis");
          setShowEmojis(j.ui.emoji ?? true);
          setShowStatusBar(j.ui.show_status_bar ?? true);
          setRefreshInterval(j.ui.refresh_interval_ms ?? 1500);
        }
        if (j.permissions) {
          setPermMode(j.permissions.mode ?? "auto");
        }
        if (j.integrations) {
          setIntegrations((prev) => ({
            ...prev,
            ...j.integrations,
            email: {
              ...prev.email,
              ...j.integrations.email,
              smtp_host: j.integrations.email?.smtp_host || "",
              smtp_port: j.integrations.email?.smtp_port || 587,
              username: j.integrations.email?.username || "",
              enabled: j.integrations.email?.enabled ?? false,
            },
            calendar: {
              ...prev.calendar,
              ...j.integrations.calendar,
              ical_url: j.integrations.calendar?.ical_url || "",
              enabled: j.integrations.calendar?.enabled ?? false,
            },
            telegram: {
              ...prev.telegram,
              ...j.integrations.telegram,
              chat_id: j.integrations.telegram?.chat_id || "",
              enabled: j.integrations.telegram?.enabled ?? false,
            },
            home_assistant: {
              ...prev.home_assistant,
              ...j.integrations.home_assistant,
              url: j.integrations.home_assistant?.url || "",
            },
          }));
        }
        if (j.ultimate) setBrain((cur) => brainMergeLoaded(cur, j.ultimate));
        if (j.plugins) {
          setPluginsMap(j.plugins);
          setPluginsLoaded(true);
        }

        // Fetch key pools (FG-005: via the api.ts wrapper)
        getKeysStatus()
          .then((kd) => {
            if (kd.keys) setKeyPools(kd.keys);
            if (kd.api_keys) setApiKeyStatus(kd.api_keys);
          })
          .catch(() => undefined);
        // Auto-fetch models on load if a key is set (in .env) or the
        // provider is local (Ollama) — so the dropdown is live on page open.
        const loadedProv = j.model?.provider ?? "openai_compatible";
        const loadedEp = j.model?.endpoint ?? "";
        const hasKey = j.api_keys?.[loadedProv] ?? false;
        setAvailableModels(PREDEFINED_MODELS[loadedProv] ?? []);
        setModelsFetched(false);
        if (loadedProv === "openai_compatible" && loadedEp) {
          fetchModels(loadedProv, "", loadedEp);
        } else if (hasKey) {
          fetchModels(loadedProv, "", loadedEp);
        }
      })
      .catch(() => pushToast("Failed to load configuration", "error"));

    authFetch("/api/agents")
      .then((r) => r.json())
      .then((j) => setAgents(j?.agents ?? []))
      .catch(() => undefined);

    getPlugins()
      .then((data) => {
        if (data?.plugins) { setPluginsMap(data.plugins); setPluginsLoaded(true); }
      })
      .catch(() => undefined);

    loadMcp();
    fetchCascadeInfo();
    fetchVerifiedModels();
  }, [fetchModels, loadMcp, pushToast]);

  // ── Save all settings ────────────────────────────────────────────────────
  const saveConfig = async () => {
    // Validate numeric inputs
    const t = Number(temperature);
    const mt = Number(maxTokens);
    if (isNaN(t) || t < 0 || t > 2) {
      pushToast("Temperature must be between 0 and 2", "error");
      return;
    }
    if (isNaN(mt) || mt < 1 || mt > 8192) {
      pushToast("Max tokens must be between 1 and 8192", "error");
      return;
    }

    // Filter out empty API keys (don't overwrite existing .env keys with blanks)
    const nonEmptyKeys: Record<string, string> = {};
    for (const [k, v] of Object.entries(apiKeys)) {
      if (v && v.trim()) nonEmptyKeys[k] = v.trim();
    }

    try {
      const resp = await authFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: {
            provider,
            model,
            endpoint,
            max_tokens: mt,
            temperature: t,
            fallback_provider: enableFallback ? fallbackProvider : null,
            fallback_model: enableFallback ? fallbackModel : null,
          },
          voice: {
            provider: voiceProvider,
            edge_voice: edgeVoiceAr,
            edge_voice_en: edgeVoiceEn,
            edge_rate: edgeRate,
            pyttsx3_volume: ttsVolume,
            chat_language: chatLanguage,
          },
          vad: vadToServer(vad),
          ui: {
            theme,
            emoji: showEmojis,
            show_status_bar: showStatusBar,
            refresh_interval_ms: refreshInterval,
          },
          integrations,
          plugins: pluginsMap,
          ultimate: brainToServer(brain),
        }),
      });
      const data = await resp.json();
      if (data.ok) {
        pushToast(data.message || "Settings saved successfully.");
        setDirty(false);
        // Sync speech-language store with backend config after saving
        if (data.voice?.chat_language) {
          useStore.getState().setSpeechLanguage(data.voice.chat_language === "ar" ? "ar" : "en");
        }
      } else {
        pushToast("Save failed: " + (data.message || "unknown error"), "error");
      }
    } catch {
      pushToast("Failed to reach backend", "error");
    }
  };

  // ── Settings export / import / reset (FG-019 / FG-020, ported from ui) ──
  // Client-side only: no new backend calls. Export uses the same payload
  // shape as saveConfig; import applies only known fields and marks the
  // form dirty so the user reviews before pressing Save; reset restores
  // defaults the same way. API keys are never included — they stay in the
  // backend .env. The hidden file input is triggered from the Settings
  // Backup section in the System → Data sub-tab.
  const settingsImportRef = useRef<HTMLInputElement>(null);

  const exportSettings = () => {
    const data = {
      model: {
        provider,
        model,
        endpoint,
        max_tokens: maxTokens,
        temperature,
        fallback_provider: enableFallback ? fallbackProvider : null,
        fallback_model: enableFallback ? fallbackModel : null,
      },
      // Prevent bulk config saves from sending API secrets or restricted permission changes.
      // (FG-019/020: Only allow safe fields in export/import/reset, never api_keys or permissions.)
      voice: {
        provider: voiceProvider,
        edge_voice: edgeVoiceAr,
        edge_voice_en: edgeVoiceEn,
        edge_rate: edgeRate,
        pyttsx3_volume: ttsVolume,
        chat_language: chatLanguage,
      },
      vad: vadToServer(vad),
      ui: {
        theme,
        emoji: showEmojis,
        show_status_bar: showStatusBar,
        refresh_interval_ms: refreshInterval,
      },
      // permissions intentionally excluded from export/import/reset (FG-019/020)
      integrations,
      plugins: pluginsMap,
      ultimate: brainToServer(brain),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jarvis-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast("Settings exported");
  };

  const handleImportSettings = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const j = JSON.parse(String(reader.result));
        if (j.model) {
          if (j.model.provider) setProvider(j.model.provider);
          if (j.model.model) setModel(j.model.model);
          if (j.model.endpoint) setEndpoint(j.model.endpoint);
          if (typeof j.model.max_tokens === "number") setMaxTokens(j.model.max_tokens);
          if (typeof j.model.temperature === "number") setTemperature(j.model.temperature);
          if (j.model.fallback_provider) { setFallbackProvider(j.model.fallback_provider); setEnableFallback(true); }
          if (j.model.fallback_model) setFallbackModel(j.model.fallback_model);
        }
        if (j.voice) {
          if (j.voice.provider) setVoiceProvider(j.voice.provider);
          if (typeof j.voice.edge_voice === "string") {
            if (j.voice.edge_voice.startsWith("ar-")) setEdgeVoiceAr(j.voice.edge_voice);
            else if (j.voice.edge_voice.startsWith("en-")) setEdgeVoiceEn(j.voice.edge_voice);
          }
          if (typeof j.voice.edge_voice_en === "string") setEdgeVoiceEn(j.voice.edge_voice_en);
          if (j.voice.edge_rate) setEdgeRate(j.voice.edge_rate);
          if (typeof j.voice.pyttsx3_volume === "number") setTtsVolume(j.voice.pyttsx3_volume);
          if (j.voice.chat_language === "ar" || j.voice.chat_language === "en") {
            setChatLanguage(j.voice.chat_language);
            useStore.getState().setSpeechLanguage(j.voice.chat_language);
          }
        }
        if (j.vad) setVad((cur) => vadApplyImported(cur, j.vad));
        if (j.ui) {
          if (j.ui.theme) setTheme(j.ui.theme);
          if (typeof j.ui.emoji === "boolean") setShowEmojis(j.ui.emoji);
          if (typeof j.ui.show_status_bar === "boolean") setShowStatusBar(j.ui.show_status_bar);
          if (typeof j.ui.refresh_interval_ms === "number") setRefreshInterval(j.ui.refresh_interval_ms);
        }
        if (j.permissions?.mode) setPermMode(j.permissions.mode);
        if (j.integrations) setIntegrations((prev) => ({ ...prev, ...j.integrations }));
        if (j.plugins) setPluginsMap(j.plugins);
        if (j.ultimate) setBrain((cur) => brainMergeImported(cur, j.ultimate));
        setDirty(true);
        pushToast("Settings imported — review and press Save to apply");
      } catch {
        pushToast("Invalid settings file", "error");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const resetSettingsToDefaults = () => {
    setProvider("openai_compatible");
    setModel("qwen2.5:1.5b");
    setEndpoint("http://localhost:11434/v1");
    setMaxTokens(1024);
    setTemperature(0.3);
    setEnableFallback(false);
    setFallbackProvider("gemini");
    setFallbackModel("gemini-2.0-flash");
    setVoiceProvider("auto");
    setEdgeVoiceAr("ar-SA-HamedNeural");
    setEdgeVoiceEn("en-GB-ThomasNeural");
    setEdgeRate("-6%");
    setTtsVolume(0.9);
    setChatLanguage("en");
    setVad(VAD_DEFAULTS);
    setTheme("jarvis");
    setShowEmojis(true);
    setShowStatusBar(true);
    setRefreshInterval(1500);
    setPermMode("confirm");
    setIntegrations({
      home_assistant: { url: "", token: "", enabled: false },
      calendar: { ical_url: "", enabled: false },
      email: { smtp_host: "", smtp_port: 587, username: "", password: "", enabled: false },
      telegram: { bot_token: "", chat_id: "", enabled: false },
      facebook: { page_id: "", page_access_token: "", enabled: false },
      youtube: { client_id: "", client_secret: "", refresh_token: "", channel_id: "", enabled: false },
      instagram: { user_id: "", access_token: "", enabled: false },
      tiktok: { client_key: "", client_secret: "", access_token: "", open_id: "", enabled: false },
      social_platforms: {},
    });
    setBrain(BRAIN_DEFAULTS);
    setDirty(true);
    pushToast("Settings reset to defaults — press Save to apply");
  };

  // Plugin toggle
  // `force` is only set by the explicit "Disable anyway" confirm dialog
  // (FG-009, ported from ui): a user-initiated, reversible override of the
  // cross-plugin block below. Every other caller keeps the stricter af
  // behaviour — disabling a plugin whose tools other plugins use is
  // refused with an error toast.
  const handleTogglePlugin = async (pName: string, currentVal: boolean, force = false) => {
    const nextVal = !currentVal;

    // Check if disabling would affect other tools
    if (!nextVal && !force) {
      const pluginTools = toolsList.filter((t) => t.plugin === pName);
      const usedByOtherPlugins = toolsList.filter((t) => t.plugin !== pName && pluginTools.some((pt) => t.name === pt.name));
      if (usedByOtherPlugins.length > 0) {
        const toolNames = usedByOtherPlugins.map((t) => t.name).slice(0, 3).join(", ");
        const more = usedByOtherPlugins.length > 3 ? ` and ${usedByOtherPlugins.length - 3} more` : "";
        pushToast(`⚠ Plugin '${pName}' provides tools used by other plugins: ${toolNames}${more}. Disabling may break functionality.`, "error");
        return;
      }
    }
    
    setPluginToggleLoading(pName);
    setPluginsMap((prev) => ({ ...prev, [pName]: nextVal }));
    try {
      const res = await togglePlugin(pName, nextVal);
      if (res.ok) {
        pushToast(`Plugin '${pName}' ${nextVal ? "enabled" : "disabled"} (reloaded)`);
        getTools().then((d) => d?.tools && setToolsList(d.tools));
      } else {
        pushToast(`Failed to toggle ${pName}: ${res.error}`, "error");
        setPluginsMap((prev) => ({ ...prev, [pName]: currentVal }));
      }
    } catch {
      pushToast("Server unreachable", "error");
      setPluginsMap((prev) => ({ ...prev, [pName]: currentVal }));
    } finally {
      setPluginToggleLoading(null);
    }
  };

  // Autonomy mode change
  const handlePermModeChange = async (newMode: string) => {
    setPermMode(newMode);
    setDirty(true);
    try {
      await authFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: { mode: newMode } }),
      });
      pushToast(`Autonomy Mode set to '${newMode.toUpperCase()}'`);
    } catch {
      /* ignore */
    }
  };


  // ── Auto-fetch when API key changes (debounced, cloud providers) ─────────
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keyValid, setKeyValid] = useState<boolean | null>(null); // null = not tested, true = valid, false = invalid
  
  useEffect(() => {
    if (provider === "openai_compatible") return;
    const cleanKey = apiKeyInput.trim();
    if (!cleanKey || cleanKey.length < 8) {
      setKeyValid(null);
      setModelError(null);
      return;
    }
    
    // Mark as testing
    setKeyValid(null);
    
    const timer = setTimeout(() => {
      fetchModels(provider, cleanKey, endpoint);
    }, 400);
    return () => clearTimeout(timer);
  }, [apiKeyInput, provider, endpoint, fetchModels]);

  // ── Auto-fetch Ollama models when endpoint changes ────────────────────────
  useEffect(() => {
    if (provider !== "openai_compatible") return;
    if (!endpoint || !endpoint.startsWith("http")) return;
    const timer = setTimeout(() => fetchModels(provider, "", endpoint), 800);
    return () => clearTimeout(timer);
  }, [endpoint, provider, fetchModels]);

  // ── Ollama Service Status helper ──────────────────────────────────────────
  const fetchOllamaStatus = useCallback(async () => {
    try {
      const r = await authFetch("/api/ollama/status");
      const d = await r.json();
      setOllamaStatus(d);
      if (d.models && d.models.length > 0) {
        setAvailableModels(d.models);
        setModelsFetched(true);
      }
    } catch {
      setOllamaStatus({ running: false, systemd_active: false, reachable: false, models: [], model_count: 0 });
    }
  }, []);

  // Auto-fetch when provider is ollama
  useEffect(() => {
    if (provider === "ollama") {
      fetchOllamaStatus();
      fetchModels("ollama", "", endpoint || "http://localhost:11434/v1");
    }
  }, [provider, endpoint, fetchOllamaStatus, fetchModels]);

  // ── Multi-Key Management Helpers ──────────────────────────────────────────
  const refreshKeyPools = useCallback(async () => {
    try {
      const d = await getKeysStatus();
      if (d.keys) setKeyPools(d.keys);
      if (d.api_keys) setApiKeyStatus(d.api_keys);
    } catch {
      // ignore
    }
  }, []);

  const fetchCouncilRoster = useCallback(async () => {
    try {
      const r = await authFetch("/api/council/roster");
      const d = await r.json();
      if (d.ok) {
        if (d.members && d.members.length > 0) setDynamicRoster(d.members);
        if (d.leaderboard && d.leaderboard.length > 0) setBenchmarkLeaderboard(d.leaderboard);
      }
    } catch {
      // ignore
    }
  }, []);


  const handleBulkImport = async (textToImport: string, prov: string = "auto") => {
    const clean = textToImport.trim();
    if (!clean) {
      pushToast("الرجاء إدخال أو اختيار ملف يحتوي على مفاتيح API", "error");
      return;
    }
    setBulkImporting(true);
    pushToast("جاري فحص المفاتيح والتحقق من صلاحيتها آلياً...", "ok");
    try {
      const resp = await authFetch("/api/keys/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, default_provider: prov }),
      });
      const data = await resp.json();
      if (data.ok) {
        setBulkResult(data);
        setShowBulkModal(true);
        await refreshKeyPools();
        pushToast(`✓ ${data.message || `تمت إضافة ${data.total_added} مفاتيح بنجاح`}`, "ok");
      } else {
        pushToast(`فشل الاستيراد: ${data.message || "خطأ غير معروف"}`, "error");
      }
    } catch (err: any) {
      pushToast(`خطأ في الاتصال: ${err?.message || ""}`, "error");
    } finally {
      setBulkImporting(false);
    }
  };


  useEffect(() => {
    if (activeTab === "ai" && aiSubTab === "council") {
      fetchCouncilRoster();
    }
  }, [activeTab, aiSubTab, fetchCouncilRoster]);

  const handleAddKey = async () => {
    const cleanKey = newKeyInput.trim();
    if (!cleanKey) return;
    setAddingKey(true);
    setKeyAddError(null);
    setKeyAddSuccess(null);
    try {
      const res = await authFetch("/api/keys/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: cleanKey }),
      });
      let data: any = {};
      try {
        data = await res.json();
      } catch {
        // non-json response
      }
      if (res.ok && data.ok) {
        setKeyAddSuccess(`Key verified & added! ${data.message || ""}`);
        setNewKeyInput("");
        await refreshKeyPools();
        fetchModels(provider, cleanKey, endpoint);
        pushToast("API key added and verified successfully");
      } else {
        const errMsg = data.message || data.error || data.detail || (res.status ? `Server error (HTTP ${res.status})` : "Failed to add key");
        setKeyAddError(errMsg);
        pushToast("Key validation failed: " + errMsg, "error");
      }
    } catch (err: any) {
      setKeyAddError(err?.message || "Network error");
    } finally {
      setAddingKey(false);
    }
  };

  const handleRemoveKey = async (targetKey: string) => {
    try {
      const res = await authFetch("/api/keys/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: targetKey }),
      });
      if (res.ok) {
        await refreshKeyPools();
        pushToast("API key removed");
      }
    } catch {
      pushToast("Failed to remove key", "error");
    }
  };

  const handleProbeKey = async (targetKey: string) => {
    pushToast("Testing key...", "ok");
    try {
      const res = await authFetch("/api/keys/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: targetKey }),
      });
      const d = await res.json();
      if (d.status === "verified") {
        pushToast(`✓ Key verified: ${d.message}`);
      } else {
        pushToast(`Probe: ${d.message}`, d.status === "rejected" ? "error" : "ok");
      }
    } catch (err: any) {
      pushToast(`Probe failed: ${err?.message || ""}`, "error");
    }
  };

  // ── Provider Config Modal handlers ───────────────────────────────────────
  const openProviderConfig = async (prov: string) => {
    setProviderConfigModal(prov);
    setModalNewKey("");
    setModalKeyError(null);
    setModalKeySuccess(null);
    // Refresh key pools for this provider
    await refreshKeyPools();
    // Fetch model count for this provider (let backend use KeyManager)
    if (prov !== "openai_compatible") {
      setModalLoadingModels(true);
      try {
        const ep = PROVIDER_ENDPOINTS[prov] || "";
        const res = await authFetch("/api/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: prov, endpoint: ep }),
        });
        const d = await res.json();
        if (d.fetched && d.models?.length) {
          setModalModelCounts((c) => ({ ...c, [prov]: d.models.length }));
        }
      } catch { /* ignore */ }
      finally { setModalLoadingModels(false); }
    }
  };

  const modalHandleAddKey = async (force: boolean = false) => {
    const prov = providerConfigModal;
    if (!prov) return;
    const cleanKey = modalNewKey.trim();
    if (!cleanKey) return;
    setModalAddingKey(true);
    setModalKeyError(null);
    setModalKeySuccess(null);
    try {
      const res = await authFetch("/api/keys/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: prov, key: cleanKey, force }),
      });
      let data: any = {};
      try { data = await res.json(); } catch { /* non-json */ }
      if (res.ok && data.ok) {
        setModalKeySuccess(`✓ Key saved! Status: ${data.status}`);
        setModalNewKey("");
        await refreshKeyPools();
        // Refresh model count (use KeyManager after key is added)
        setModalLoadingModels(true);
        try {
          const ep = PROVIDER_ENDPOINTS[prov] || "";
          const r2 = await authFetch("/api/models", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: prov, endpoint: ep }),
          });
          const d2 = await r2.json();
          if (d2.fetched && d2.models?.length) {
            setModalModelCounts((c) => ({ ...c, [prov]: d2.models.length }));
            // Also update the main models if this is the active provider
            if (prov === provider) {
              setAvailableModels(d2.models);
              setModelsFetched(true);
            }
          }
        } catch { /* ignore */ }
        finally { setModalLoadingModels(false); }
        pushToast("API key added and verified");
      } else {
        const msg = data.message || data.error || `HTTP ${res.status}`;
        setModalKeyError(msg);
        pushToast("Key failed: " + msg, "error");
      }
    } catch (err: any) {
      setModalKeyError(err?.message || "Network error");
    } finally {
      setModalAddingKey(false);
    }
  };

  const modalHandleRemoveKey = async (targetKey: string) => {
    const prov = providerConfigModal;
    if (!prov) return;
    try {
      const res = await authFetch("/api/keys/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: prov, key: targetKey }),
      });
      if (res.ok) {
        await refreshKeyPools();
        pushToast("Key removed");
      }
    } catch { pushToast("Failed to remove key", "error"); }
  };

  const modalHandleProbeKey = async (targetKey: string) => {
    const prov = providerConfigModal;
    if (!prov) return;
    pushToast("Testing key…", "ok");
    try {
      const res = await authFetch("/api/keys/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: prov, key: targetKey }),
      });
      const d = await res.json();
      pushToast(d.status === "verified" ? `✓ ${d.message}` : `${d.status}: ${d.message}`,
        d.status === "rejected" ? "error" : "ok");
    } catch (err: any) {
      pushToast(`Probe failed: ${err?.message || ""}`, "error");
    }
  };

  const modalRefreshModels = async () => {
    const prov = providerConfigModal;
    if (!prov) return;
    setModalLoadingModels(true);
    try {
      const ep = PROVIDER_ENDPOINTS[prov] || "";
      const res = await authFetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: prov, endpoint: ep }),
      });
      const d = await res.json();
      if (d.models?.length) {
        setModalModelCounts((c) => ({ ...c, [prov]: d.models.length }));
        if (d.fetched) pushToast(`✓ ${d.models.length} models loaded from ${PROVIDER_INFO[prov]?.name || prov}`);
        else pushToast(`${d.models.length} suggested models (add key to fetch live list)`, "ok");
      } else pushToast("No models returned — check key/endpoint", "error");
    } catch { pushToast("Failed to fetch models", "error"); }
    finally { setModalLoadingModels(false); }
  };


  // ── Confirm dialog state ──────────────────────────────────────────────────
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  const tabs = [
    { id: "ai",           label: t("tab_ai"),           icon: "🧠" },
    { id: "tools",        label: `${t("tab_tools")} (${toolsLoading ? "…" : toolsList.length})`, icon: "🛠" },
    { id: "mcp",          label: `${t("tab_mcp")} (${mcpServers.filter(s => s.enabled).length})`, icon: "🔌" },
    { id: "integrations", label: t("tab_integrations"), icon: "🌐" },
    { id: "system",       label: t("tab_system"),       icon: "⚙" },
    { id: "monitor",      label: t("tab_monitor"),      icon: "🧬" },
    { id: "auth",         label: t("tab_auth"),         icon: "🔐" },
    { id: "vault",        label: t("tab_vault"),        icon: "🛡️" },
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex overflow-hidden" dir={lang === "ar" ? "rtl" : "ltr"}>
      {/* Sidebar */}
      <div className="w-64 bg-slate-900/50 border-e border-slate-700/50 flex flex-col flex-shrink-0">
        {/* Sidebar header */}
        <div className="p-4 border-b border-slate-700/50 flex items-center justify-between">
          <h1 className="text-base font-semibold text-white tracking-wide">{t("settings")}</h1>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full text-start px-3 py-2.5 rounded-lg transition-all text-sm flex items-center gap-2 ${
                activeTab === tab.id
                  ? "bg-slate-800 text-white"
                  : "text-slate-500 hover:bg-slate-800/50 hover:text-slate-200"
              }`}
            >
              <span className="text-base w-5 text-center">{tab.icon}</span>
              <span className="truncate">{tab.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-700/50 space-y-1.5">
          <button
            onClick={saveConfig}
            className={`w-full px-3 py-2 rounded-lg transition font-medium text-sm ${
              dirty
                ? "bg-cyan-600 text-white hover:bg-cyan-500"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
            }`}
          >
            {dirty ? `● ${t("saveChanges")}` : t("saveSettings")}
          </button>
          <button
            onClick={onClose}
            className="w-full px-3 py-2 bg-slate-900 text-slate-500 rounded-lg hover:bg-slate-800 hover:text-slate-300 transition text-sm"
          >
            {t("close")}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-8">

        {/* ── Tools & Plugins (77 Tools) ─────────────────────────────────── */}
        {activeTab === "tools" && (
          <ToolsTab
            toolsList={toolsList}
            setToolsList={setToolsList}
            toolsLoading={toolsLoading}
            setToolsLoading={setToolsLoading}
            pluginsMap={pluginsMap}
            pluginsLoaded={pluginsLoaded}
            pluginToggleLoading={pluginToggleLoading}
            permMode={permMode}
            health={health}
            handleTogglePlugin={handleTogglePlugin}
            handlePermModeChange={handlePermModeChange}
          />
        )}

        {/* ══ AI & Brain ═══════════════════════════════════════════════════ */}
        {activeTab === "ai" && (() => {
          return (
            <div className="max-w-6xl mx-auto space-y-8">
              <div className="flex items-center justify-between border-b border-slate-700/50 pb-5">
                <div>
                  <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                    <span>🧠</span> {t("ai_title")}
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">{t("ai_desc")}</p>
                </div>
                <div className="flex gap-2">
                  {(["inference", "providers", "council", "swarm"] as const).map((s) => (
                    <button key={s}
                      onClick={() => setAiSubTab(s)}
                      className={`px-4 py-2 rounded-lg text-sm font-mono font-semibold transition border ${
                        aiSubTab === s
                          ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                          : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white"
                      }`}
                    >
                      {s === "inference" ? `🔧 ${t("subtab_inference")}` : s === "providers" ? `🔑 ${t("subtab_providers")}` : s === "council" ? `🏛️ ${t("subtab_council")}` : `🐝 ${t("subtab_swarm")}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* ─ Inference sub-tab ─ */}
              {aiSubTab === "inference" && (
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-6">
                  {/* 1. Provider */}
                  <InferenceProviderSection
                    apiKeyStatus={apiKeyStatus}
                    apiKeys={apiKeys}
                    endpoint={endpoint}
                    fetchModels={fetchModels}
                    keyPools={keyPools}
                    provider={provider}
                    setApiKeyInput={setApiKeyInput}
                    setAvailableModels={setAvailableModels}
                    setDirty={setDirty}
                    setEndpoint={setEndpoint}
                    setIsCustomModel={setIsCustomModel}
                    setKeyValid={setKeyValid}
                    setModel={setModel}
                    setModelError={setModelError}
                    setModelsFetched={setModelsFetched}
                    setProvider={setProvider}
                  />

                  {/* ── Ollama Service Control Card ── */}
                  <InferenceOllamaCard
                    fetchOllamaStatus={fetchOllamaStatus}
                    model={model}
                    ollamaStatus={ollamaStatus}
                    provider={provider}
                    setDirty={setDirty}
                    setIsCustomModel={setIsCustomModel}
                    setModel={setModel}
                    setOllamaStatus={setOllamaStatus}
                  />

                  {/* Key status banner */}
                  {provider !== "openai_compatible" && (
                    <div className="flex items-center justify-between bg-slate-900/60 border border-slate-700/50 rounded-xl px-4 py-3">
                      <div className="flex items-center gap-2 text-sm">
                        {["kilo", "pollinations", "ovhcloud", "omniroute", "ollama", "lmstudio"].includes(provider) ? (
                          <>
                            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
                            <span className="text-emerald-300 font-medium">
                              ⚡ مزود مجاني نشط — يعمل بدون مفتاح API (Free Keyless Tier)
                            </span>
                          </>
                        ) : (keyPools[provider] || []).length > 0 || apiKeyStatus[provider] ? (
                          <>
                            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                            <div className="flex flex-col">
                              <span className="text-emerald-300 font-medium">
                                {(keyPools[provider] || []).length > 1
                                  ? `${(keyPools[provider] || []).length} keys — ⚡ Auto-Rotation active`
                                  : "API key configured"}
                              </span>
                              {(keyPools[provider] || []).length > 0 && (
                                <span className="text-[10px] text-slate-400 font-mono">
                                  Active: {keyPools[provider]?.[0]?.masked || "Loading..."}
                                  {/* FG-003 (ported from ui): pool position + failures. */}
                                  <span className="ml-2 text-slate-500">
                                    1 of {(keyPools[provider] || []).length} in pool
                                  </span>
                                  {keyPools[provider]?.[0]?.successes && (
                                    <span className="ml-2 text-emerald-400">
                                      ✓ {keyPools[provider][0].successes} successes
                                    </span>
                                  )}
                                  {keyPools[provider]?.[0]?.failures ? (
                                    <span className="ml-2 text-rose-400">
                                      ✗ {keyPools[provider][0].failures} failures
                                    </span>
                                  ) : null}
                                  {keyPools[provider]?.[0]?.cooldown_remaining && keyPools[provider][0].cooldown_remaining > 0 && (
                                    <span className="ml-2 text-amber-400">
                                      ⏱ {Math.ceil(keyPools[provider][0].cooldown_remaining)}s cooldown
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                            <span className="text-amber-300">No API key — model calls will fail</span>
                          </>
                        )}
                      </div>
                      <button
                        onClick={() => { setActiveTab("ai"); setAiSubTab("providers"); }}
                        className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition"
                      >
                        {["kilo", "pollinations", "ovhcloud", "omniroute", "ollama", "lmstudio"].includes(provider) ? "🌐 عرض المزودات" : "🔑 Manage Keys"}
                      </button>
                    </div>
                  )}

                  {/* Endpoint */}
                  <div className="space-y-2">
                    <label className="text-sm text-slate-300">Endpoint {provider === "openai_compatible" ? "" : "(auto-filled)"}</label>
                    <input
                      type="text"
                      value={endpoint}
                      onChange={(e) => { setEndpoint(e.target.value); setDirty(true); }}
                      placeholder="https://api.example.com/v1"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>

                  {/* Model Name */}
                  <div className="space-y-2">
                    <label className="text-sm text-slate-300 flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        Model Name
                        {loadingModels && (<span className="text-cyan-400 text-xs animate-pulse">● fetching…</span>)}
                        {!loadingModels && modelsFetched && (<span className="text-emerald-400 text-xs font-semibold">✓ {availableModels.length} live</span>)}
                      </span>
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={availableModels.includes(model) ? model : (isCustomModel ? "__custom__" : model)}
                        onChange={(e) => {
                          if (e.target.value === "__custom__") { setIsCustomModel(true); }
                          else { setIsCustomModel(false); setModel(e.target.value); setDirty(true); }
                        }}
                        className={`flex-1 bg-slate-900 border rounded-lg px-4 py-3 text-white transition-colors ${
                          loadingModels ? "border-cyan-500/50" : modelsFetched ? "border-emerald-500/40" : "border-slate-600"
                        }`}
                      >
                        {modelsFetched ? (
                          <optgroup label={`✓ Verified Live Models (${availableModels.length})`}>
                            {availableModels.map((m) => {
                              const verified = verifiedModels[m];
                              const statusIcon = verified?.status === "verified" ? "✓" : verified?.status === "failed" ? "✗" : "?";
                              const latencyInfo = verified?.latency_ms ? ` (${verified.latency_ms}ms)` : "";
                              return (
                                <option key={m} value={m}>
                                  {statusIcon} {m}{latencyInfo}
                                </option>
                              );
                            })}
                          </optgroup>
                        ) : (
                          <optgroup label="Suggested Models">
                            {(availableModels.length > 0 ? availableModels : PREDEFINED_MODELS[provider] || []).map((m) => {
                              const verified = verifiedModels[m];
                              const statusIcon = verified?.status === "verified" ? "✓" : verified?.status === "failed" ? "✗" : "";
                              return (
                                <option key={m} value={m}>
                                  {statusIcon} {m}
                                </option>
                              );
                            })}
                          </optgroup>
                        )}
                        <option value="__custom__">⚙ Enter custom model name…</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => fetchModels(provider, (apiKeys[provider] || apiKeyInput || "").trim(), endpoint)}
                        disabled={loadingModels}
                        className="px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition disabled:opacity-40 text-lg"
                      >
                        {loadingModels ? "⏳" : "↻"}
                      </button>
                    </div>
                    {(isCustomModel || (!availableModels.includes(model) && Boolean(model))) && (
                      <input
                        type="text"
                        value={model}
                        onChange={(e) => { setModel(e.target.value); setDirty(true); }}
                        placeholder="e.g. llama-3.3-70b-versatile"
                        className="w-full bg-slate-900 border border-cyan-500/50 rounded-lg px-4 py-2.5 text-white text-sm mt-1.5"
                      />
                    )}
                    {modelsFetched && !loadingModels && availableModels.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1 max-h-32 overflow-y-auto">
                        {availableModels.map((m) => (
                          <button key={m} onClick={() => { setModel(m); setDirty(true); }}
                            className={`text-xs px-2 py-1 rounded-md border transition ${
                              model === m
                                ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300"
                                : "bg-slate-800 border-emerald-600/30 text-emerald-300/80 hover:text-emerald-200"
                            }`}
                          >{m}</button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Parameters */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm text-slate-300">Max Tokens</label>
                      <input type="number" value={maxTokens}
                        onChange={(e) => { setMaxTokens(parseInt(e.target.value) || 0); setDirty(true); }}
                        min="1" max="8192" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-slate-300">Temperature (0–2)</label>
                      <input type="number" value={temperature}
                        onChange={(e) => { setTemperature(parseFloat(e.target.value) || 0); setDirty(true); }}
                        min="0" max="2" step="0.1" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white" />
                    </div>
                  </div>

                  {/* Fallback chain */}
                  <div className="space-y-3 bg-slate-900/60 border border-slate-700/60 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                          🛡️ Automatic Provider Fallback (Failover Protection)
                        </label>
                        <p className="text-xs text-slate-400">
                          If {provider} is rate-limited or unreachable, JARVIS auto-reroutes to the backup provider.
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={enableFallback}
                          onChange={(e) => { setEnableFallback(e.target.checked); setDirty(true); }} className="sr-only peer" />
                        <div className="w-11 h-6 bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600" />
                      </label>
                    </div>
                    {enableFallback && (
                      <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-800">
                        <div className="space-y-1.5">
                          <label className="text-xs text-slate-300">Backup Provider</label>
                          <select value={fallbackProvider}
                            onChange={(e) => { setFallbackProvider(e.target.value); setFallbackModel(PREDEFINED_MODELS[e.target.value]?.[0] || ""); setDirty(true); }}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm">
                            <optgroup label="🆓 Free / No-Key (Recommended)">
                              <option value="kilo">Kilo Gateway — 200 req/hr free</option>
                              <option value="pollinations">Pollinations — Unlimited free</option>
                              <option value="ovhcloud">OVHcloud AI — Free Qwen/Llama</option>
                              <option value="omniroute">9Router Proxy — Local Free Aggregator</option>
                            </optgroup>
                            <optgroup label="☁️ Cloud (Requires Key)">
                              <option value="gemini">Google Gemini</option>
                              <option value="groq">Groq</option>
                              <option value="openai">OpenAI</option>
                              <option value="mistral">Mistral</option>
                              <option value="cerebras">Cerebras</option>
                              <option value="anthropic">Anthropic</option>
                              <option value="openrouter">OpenRouter</option>
                            </optgroup>
                            <optgroup label="🏠 Local">
                              <option value="ollama">Ollama (Local)</option>
                              <option value="lmstudio">LM Studio (Local)</option>
                              <option value="openai_compatible">Custom Compatible</option>
                            </optgroup>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs text-slate-300">Backup Model Name</label>
                          <input type="text" value={fallbackModel}
                            onChange={(e) => { setFallbackModel(e.target.value); setDirty(true); }}
                            placeholder="e.g. gemini-2.0-flash"
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Cascade Status - Real-tier display */}
                  <div className="space-y-3 bg-slate-900/60 border border-purple-500/30 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                          🌊 Multi-Tier Cascade Status
                        </label>
                        <p className="text-xs text-slate-400">
                          Live adaptive routing configuration with 4-tier fallback chain
                        </p>
                      </div>
                      <button
                        onClick={fetchCascadeInfo}
                        className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition"
                      >
                        ↻ Refresh
                      </button>
                    </div>
                    {cascadeInfo && cascadeInfo.tiers.length > 0 ? (
                      <div className="space-y-2 pt-2 border-t border-slate-800">
                        {cascadeInfo.tiers.map((tier, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-slate-950/40 border border-slate-800 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                                Tier {idx}
                              </span>
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                tier.is_local ? "bg-amber-500/15 text-amber-400" : "bg-cyan-500/10 text-cyan-400"
                              }`}>
                                {tier.is_local ? "local" : "cloud"}
                              </span>
                              <span className="text-xs font-mono text-slate-300 truncate max-w-[200px]">
                                <bdi dir="auto">{tier.provider}/{tier.model}</bdi>
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-500 font-mono">
                                {tier.timeout}s
                              </span>
                              <span className="w-2 h-2 rounded-full bg-emerald-400" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 italic pt-2 border-t border-slate-800">
                        Cascade status not loaded. Click Refresh to fetch live configuration.
                      </div>
                    )}
                  </div>

                  <button onClick={saveConfig}
                    className="w-full px-4 py-3 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition font-semibold">
                    Save Settings
                  </button>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => {
                        const configData = {
                          model: { provider, model, endpoint, max_tokens: maxTokens, temperature, fallback_provider: enableFallback ? fallbackProvider : null, fallback_model: enableFallback ? fallbackModel : null },
                          api_keys: apiKeys,
                          voice: { provider: voiceProvider, edge_voice: edgeVoiceAr, edge_voice_en: edgeVoiceEn, edge_rate: edgeRate, pyttsx3_volume: ttsVolume, chat_language: chatLanguage },
                          vad: vadToServer(vad),
                          ui: { theme, emoji: showEmojis, show_status_bar: showStatusBar, refresh_interval_ms: refreshInterval },
                          permissions: { mode: permMode },
                          integrations,
                          plugins: pluginsMap,
                          ultimate: brainToServer(brain),
                        };
                        const blob = new Blob([JSON.stringify(configData, null, 2)], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `jarvis-settings-${new Date().toISOString().split("T")[0]}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                        pushToast("Settings exported successfully");
                      }}
                      className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition font-semibold text-sm"
                    >
                      📤 Export
                    </button>
                    <button
                      onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = "application/json";
                        input.onchange = async (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (file) {
                            try {
                              const text = await file.text();
                              const imported = JSON.parse(text);
                              if (imported.model) {
                                setProvider(imported.model.provider ?? "openai_compatible");
                                setModel(imported.model.model ?? "");
                                setEndpoint(imported.model.endpoint ?? "");
                                setMaxTokens(imported.model.max_tokens ?? 1024);
                                setTemperature(imported.model.temperature ?? 0.3);
                                if (imported.model.fallback_provider) {
                                  setFallbackProvider(imported.model.fallback_provider);
                                  setEnableFallback(true);
                                }
                                if (imported.model.fallback_model) {
                                  setFallbackModel(imported.model.fallback_model);
                                }
                              }
                              if (imported.api_keys) setApiKeys(imported.api_keys);
                              if (imported.voice) {
                                setVoiceProvider(imported.voice.provider ?? "auto");
                                setEdgeVoiceAr(imported.voice.edge_voice?.startsWith("ar-") ? imported.voice.edge_voice : "ar-SA-HamedNeural");
                                setEdgeVoiceEn(imported.voice.edge_voice_en?.startsWith("en-") ? imported.voice.edge_voice_en : "en-GB-ThomasNeural");
                                setEdgeRate(imported.voice.edge_rate ?? "-6%");
                                setTtsVolume(imported.voice.pyttsx3_volume ?? 0.9);
                                setChatLanguage(imported.voice.chat_language ?? "en");
                              }
                              if (imported.vad) setVad(vadFromServer(imported.vad));
                              if (imported.ui) {
                                setTheme(imported.ui.theme ?? "jarvis");
                                setShowEmojis(imported.ui.emoji ?? true);
                                setShowStatusBar(imported.ui.show_status_bar ?? true);
                                setRefreshInterval(imported.ui.refresh_interval_ms ?? 1500);
                              }
                              if (imported.permissions) {
                                setPermMode(imported.permissions.mode ?? "auto");
                              }
                              if (imported.integrations) {
                                setIntegrations((prev) => ({ ...prev, ...imported.integrations }));
                              }
                              if (imported.plugins) {
                                setPluginsMap(imported.plugins);
                              }
                              if (imported.ultimate) setBrain((cur) => brainMergeLoaded(cur, imported.ultimate));
                              setDirty(true);
                              pushToast("Settings imported successfully");
                            } catch (err) {
                              pushToast("Failed to import settings: Invalid JSON", "error");
                            }
                          }
                        };
                        input.click();
                      }}
                      className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition font-semibold text-sm"
                    >
                      📥 Import
                    </button>
                    <button
                      onClick={() => {
                        if (!confirm("This will reset all settings to default values. Are you sure?")) return;
                        setProvider("openai_compatible");
                        setModel("qwen2.5:1.5b");
                        setEndpoint("http://localhost:11434/v1");
                        setMaxTokens(1024);
                        setTemperature(0.3);
                        setEnableFallback(false);
                        setFallbackProvider("gemini");
                        setFallbackModel("gemini-2.0-flash");
                        setApiKeys({});
                        setApiKeyStatus({});
                        setVoiceProvider("auto");
                        setEdgeVoiceAr("ar-SA-HamedNeural");
                        setEdgeVoiceEn("en-GB-ThomasNeural");
                        setEdgeRate("-6%");
                        setTtsVolume(0.9);
                        setChatLanguage("en");
                        setVad(vadFromServer({})); // table B: same fallbacks as load/import
                        setTheme("jarvis");
                        setShowEmojis(true);
                        setShowStatusBar(true);
                        setRefreshInterval(1500);
                        setPermMode("confirm");
                        setIntegrations({
                          home_assistant: { url: "", token: "", enabled: false },
                          calendar: { ical_url: "", enabled: false },
                          email: { smtp_host: "", smtp_port: 587, username: "", password: "", enabled: false },
                          telegram: { bot_token: "", chat_id: "", enabled: false },
                          facebook: { page_id: "", page_access_token: "", enabled: false },
                          youtube: { client_id: "", client_secret: "", refresh_token: "", channel_id: "", enabled: false },
                          instagram: { user_id: "", access_token: "", enabled: false },
                          tiktok: { client_key: "", client_secret: "", access_token: "", open_id: "", enabled: false },
                          social_platforms: {},
                        });
                        setPluginsMap({});
                        setBrain(BRAIN_DEFAULTS);
                        setDirty(true);
                        pushToast("Settings reset to defaults");
                      }}
                      className="flex-1 px-4 py-2 bg-rose-700 text-white rounded-lg hover:bg-rose-600 transition font-semibold text-sm"
                    >
                      🔄 Reset
                    </button>
                  </div>
                </div>
              )}

              {/* ─ Brain Config sub-section (always shown inside inference tab) ─ */}
              {aiSubTab === "inference" && (
                <BrainConfigPanel
                  brain={brain}
                  setBrain={setBrain}
                  setDirty={setDirty}
                  saveConfig={saveConfig}
                />
              )}

              {/* ─ Providers sub-tab ─ */}
              {aiSubTab === "providers" && (
                <ProvidersSection
                  bulkFileInputRef={bulkFileInputRef}
                  bulkImporting={bulkImporting}
                  bulkProvider={bulkProvider}
                  handleBulkImport={handleBulkImport}
                  setBulkText={setBulkText}
                  setShowBulkModal={setShowBulkModal}
            apiKeyStatus={apiKeyStatus}
            keyPools={keyPools}
            modalModelCounts={modalModelCounts}
            openProviderConfig={openProviderConfig}
          />
              )}

              {aiSubTab === "council" && (
                <CouncilSection
                  apiKeyStatus={apiKeyStatus}
                  benchmarkLeaderboard={benchmarkLeaderboard}
                  dynamicRoster={dynamicRoster}
                  keyPools={keyPools}
                  model={model}
                  openProviderConfig={openProviderConfig}
                  provider={provider}
                  pushToast={pushToast}
                  setBenchmarkLeaderboard={setBenchmarkLeaderboard}
                  setDynamicRoster={setDynamicRoster}
                />
              )}

              {/* ─ Swarm sub-tab ─ */}
              {aiSubTab === "swarm" && (
                <SwarmSection />
              )}

            </div>
          );
        })()}

        {/* ══ MCP Ecosystem ════════════════════════════════════════════════ */}
        {activeTab === "mcp" && (
          <McpTab
            endpoint={endpoint}
            loadMcp={loadMcp}
            mcpLoading={mcpLoading}
            mcpPresets={mcpPresets}
            mcpServers={mcpServers}
            pushToast={pushToast}
            setSelectedPlatformModal={setSelectedPlatformModal}
            setToolsList={setToolsList}
          />
        )}

        {/* ══ Integrations ═════════════════════════════════════════════════ */}
        {activeTab === "integrations" && (
          <IntegrationsTab
            integrations={integrations}
            setIntegrations={setIntegrations}
            setDirty={setDirty}
            saveConfig={saveConfig}
            pushToast={pushToast}
            setSelectedPlatformModal={setSelectedPlatformModal}
          />
        )}

        {/* ══ System & Config ═══════════════════════════════════════════════ */}
        {activeTab === "system" && (() => {
          const sysSubTabs = [
            { id: "voice", label: `🎙 ${t("subtab_voice")}` },
            { id: "display", label: `🖥 ${t("subtab_display")}` },
            { id: "diagnostics", label: `🩺 ${t("subtab_diagnostics")}` },
            { id: "data", label: `🗑 ${t("subtab_data")}` },
          ] as const;
          return (
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="flex items-center justify-between border-b border-slate-700/50 pb-5">
                <div>
                  <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                    <span>⚙</span> {t("system_title")}
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">{t("system_desc")}</p>
                </div>
                <div className="flex gap-2">
                  {sysSubTabs.map((s) => (
                    <button key={s.id} onClick={() => setSystemSubTab(s.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition border ${
                        systemSubTab === s.id
                          ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                          : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white"
                      }`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Voice sub-tab */}
              {systemSubTab === "voice" && (
                <SystemVoiceSection
                  chatLanguage={chatLanguage}
                  setChatLanguage={setChatLanguage}
                  edgeRate={edgeRate}
                  setEdgeRate={setEdgeRate}
                  edgeVoiceAr={edgeVoiceAr}
                  setEdgeVoiceAr={setEdgeVoiceAr}
                  edgeVoiceEn={edgeVoiceEn}
                  setEdgeVoiceEn={setEdgeVoiceEn}
                  ttsVolume={ttsVolume}
                  setTtsVolume={setTtsVolume}
                  voiceProvider={voiceProvider}
                  setVoiceProvider={setVoiceProvider}
                  endpoint={endpoint}
                  model={model}
                  vad={vad}
                  setVad={setVad}
                  setDirty={setDirty}
                />
              )}

              {/* Display sub-tab */}
              {systemSubTab === "display" && (
                <SystemDisplaySection
                  theme={theme}
                  setTheme={setTheme}
                  showEmojis={showEmojis}
                  setShowEmojis={setShowEmojis}
                  showStatusBar={showStatusBar}
                  setShowStatusBar={setShowStatusBar}
                  refreshInterval={refreshInterval}
                  setRefreshInterval={setRefreshInterval}
                  setDirty={setDirty}
                  setConfirmDialog={setConfirmDialog}
                />
              )}

              {/* Diagnostics sub-tab */}
              {systemSubTab === "diagnostics" && (
                <SystemDiagnosticsSection
                  agents={agents}
                  health={health}
                      permMode={permMode}
                      pushToast={pushToast}
                />
              )}

              {/* Data sub-tab */}
              {systemSubTab === "data" && (
                <SystemDataSection
                  exportSettings={exportSettings}
                  handleImportSettings={handleImportSettings}
                  resetSettingsToDefaults={resetSettingsToDefaults}
                  settingsImportRef={settingsImportRef}
                  pushToast={pushToast}
                  setConfirmDialog={setConfirmDialog}
                />
              )}
            </div>
          );
        })()}

        {/* ── 🧬 Learning Monitor Tab ──────────────────────────────────────── */}
        {activeTab === "monitor" && <MonitorTab lang={lang} cascadeInfo={cascadeInfo} fetchCascadeInfo={fetchCascadeInfo} />}

        {/* ── 🔐 Authentication Tab ───────────────────────────────────────────── */}
        {activeTab === "auth" && <AuthTab t={t} />}

        {/* ── 🛡️ Keyring Vault Tab ────────────────────────────────────────────── */}
        {activeTab === "vault" && <VaultTab t={t} lang={lang} />}
      </div>

      {/* ── Toast notifications ─────────────────────────────────────────────── */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[110] space-y-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`px-4 py-3 rounded-lg text-sm shadow-lg border ${
                t.kind === "ok"
                  ? "bg-slate-800/95 border-cyan-500/40 text-cyan-200"
                  : "bg-slate-800/95 border-red-500/40 text-red-200"
              }`}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}

      {/* Platform Detail Inspection Modal */}
      {selectedPlatformModal && (
        <PlatformDetailModal
          platformId={selectedPlatformModal.id}
          platformName={selectedPlatformModal.name}
          platformIcon={selectedPlatformModal.icon}
          serverConfig={selectedPlatformModal.serverConfig}
          integrationConfig={selectedPlatformModal.integrationConfig}
          lang={lang}
          onClose={() => setSelectedPlatformModal(null)}
          onToast={(text: string, kind?: "ok" | "error") => pushToast(text, kind)}
        />
      )}

      {/* ── Provider Config Modal ────────────────────────────────────────── */}
      {providerConfigModal && (() => {
        const prov = providerConfigModal;
        const info = PROVIDER_INFO[prov];
        const keys = keyPools[prov] || [];
        const modalKeyCount = modalModelCounts[prov];
        return (
          <div
            className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70"
            onClick={(e) => { if (e.target === e.currentTarget) setProviderConfigModal(null); }}
          >
            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[85vh]">
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{info?.icon}</span>
                  <div>
                    <h3 className="font-bold text-white">{info?.name || prov}</h3>
                    {info?.keyUrl && (
                      <a href={info.keyUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-cyan-400 hover:text-cyan-300 underline">
                        Get API key ↗
                      </a>
                    )}
                  </div>
                </div>
                <button
                  onClick={modalRefreshModels}
                  disabled={modalLoadingModels}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm transition disabled:opacity-40"
                >
                  {modalLoadingModels
                    ? <span className="animate-spin">⏳</span>
                    : <span>↻</span>
                  }
                  Refresh models
                  {modalKeyCount && !modalLoadingModels && (
                    <span className="text-emerald-400 text-xs font-semibold">({modalKeyCount})</span>
                  )}
                </button>
              </div>

              {/* Scrollable body */}
              <div className="overflow-y-auto flex-1 p-6 space-y-5">
                {/* Keys list */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                    API Keys {keys.length > 0 && `(${keys.length})`}
                  </h4>
                  {keys.length === 0 && (
                    <div className="text-sm text-slate-400 bg-slate-800/60 border border-slate-700 rounded-lg p-3">
                      No keys configured yet. Add a key below.
                    </div>
                  )}
                  <div className="space-y-2">
                    {keys.map((kItem, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-slate-800/70 border border-slate-700 rounded-lg px-4 py-2.5 text-sm">
                        <div className="flex items-center gap-2.5">
                          <span className="text-xs text-slate-400 font-mono w-5">{idx + 1}.</span>
                          <span className="font-mono text-cyan-300">{kItem.masked}</span>
                          {kItem.status === "active" && (
                            <span className="px-2 py-0.5 text-xs rounded bg-emerald-950 border border-emerald-600/50 text-emerald-300">✓ Active</span>
                          )}
                          {kItem.status === "cooldown" && (
                            <span className="px-2 py-0.5 text-xs rounded bg-amber-950 border border-amber-600/50 text-amber-300">⏳ Cooldown</span>
                          )}
                          {kItem.status === "invalid" && (
                            <span className="px-2 py-0.5 text-xs rounded bg-red-950 border border-red-600/50 text-red-300">✗ Invalid</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => modalHandleProbeKey(kItem.masked)}
                            className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded border border-slate-600 transition"
                          >↻ Test</button>
                          <button
                            onClick={() => modalHandleRemoveKey(kItem.masked)}
                            className="px-2 py-1 text-xs bg-red-950/60 hover:bg-red-900/80 text-red-300 rounded border border-red-800/50 transition"
                          >✕ Remove</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Add key section */}
                <div className="border-t border-slate-700 pt-4 space-y-3">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Add Key</h4>
                  {prov === "openai_compatible" ? (
                    <p className="text-sm text-slate-400">Local providers (Ollama / LM Studio) don't require API keys. Configure the endpoint in the Model tab.</p>
                  ) : (
                    <>
                      <p className="text-xs text-slate-400">
                        Enter your {info?.name || prov} API key. JARVIS will verify it without consuming any tokens.
                        {keys.length >= 1 && " Multiple keys rotate automatically on rate-limit (429)."}
                      </p>
                      <div className="relative">
                        <input
                          id="modal-key-input"
                          type="password"
                          value={modalNewKey}
                          onChange={(e) => { setModalNewKey(e.target.value); setModalKeyError(null); setModalKeySuccess(null); }}
                          onKeyDown={(e) => { if (e.key === "Enter") modalHandleAddKey(); }}
                          placeholder={`Paste ${info?.name || prov} API key…`}
                          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 pr-10 text-white text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const el = document.getElementById("modal-key-input") as HTMLInputElement;
                            if (el) el.type = el.type === "password" ? "text" : "password";
                          }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                        >👁</button>
                      </div>
                      {modalKeySuccess && (
                        <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-700/50 rounded-lg p-2 font-mono">{modalKeySuccess}</div>
                      )}
                      {modalKeyError && (
                        <div className="flex items-center justify-between text-xs text-red-300 bg-red-950/40 border border-red-700/50 rounded-lg p-2 font-mono">
                          <span className="flex-1 mr-2">✗ {modalKeyError}</span>
                          <button
                            type="button"
                            onClick={() => modalHandleAddKey(true)}
                            className="px-2 py-1 bg-red-800 hover:bg-red-700 text-white rounded text-[11px] font-sans font-semibold transition whitespace-nowrap"
                            title="Save this key anyway"
                          >
                            Save Anyway
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700 bg-slate-900">
                <button
                  onClick={() => setProviderConfigModal(null)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-sm transition"
                >
                  Close
                </button>
                {prov !== "openai_compatible" && (
                  <button
                    onClick={() => modalHandleAddKey(false)}
                    disabled={modalAddingKey || !modalNewKey.trim()}
                    className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-semibold transition disabled:opacity-40"
                  >
                    {modalAddingKey ? "Verifying…" : "Save"}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Bulk Keys Import Modal ────────────────────────────────────────── */}
      {showBulkModal && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-4 animate-fadeIn"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowBulkModal(false); setBulkResult(null); } }}
        >
          <div className="bg-slate-900 border border-cyan-500/30 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📁</span>
                <div>
                  <h3 className="font-bold text-white text-base font-mono">استيراد وفحص المفاتيح الجماعية</h3>
                  <p className="text-xs text-slate-400 mt-0.5">تحميل ملف نصي أو لصق مفاتيح متعددة للفحص والحفظ الآلي</p>
                </div>
              </div>
              <button
                onClick={() => { setShowBulkModal(false); setBulkResult(null); }}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm transition"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(90vh-140px)]">
              {/* File Upload Zone */}
              <div
                onClick={() => bulkFileInputRef.current?.click()}
                className="border-2 border-dashed border-cyan-500/40 hover:border-cyan-400 rounded-xl p-5 text-center cursor-pointer bg-slate-950/40 hover:bg-cyan-500/5 transition flex flex-col items-center justify-center gap-2 group"
              >
                <span className="text-3xl group-hover:scale-110 transition">📄</span>
                <div className="font-semibold text-slate-200 text-sm">
                  انقر هنا لاختيار ملف (.txt أو .env أو .json)
                </div>
                <div className="text-xs text-slate-500">
                  يدعم صيغ: gemini: AIza... | GROQ_API_KEY=gsk_... | قائمة مفاتيح مجردة
                </div>
              </div>

              {/* Target Provider & Direct Text Area */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">أو الصق نص المفاتيح مباشرة هنا:</label>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">المزود المستهدف:</span>
                    <select
                      value={bulkProvider}
                      onChange={(e) => setBulkProvider(e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-cyan-300 font-mono outline-none focus:border-cyan-400"
                    >
                      <option value="auto">🔍 كشف تلقائي ذكي (Auto-Detect)</option>
                      <option value="gemini">Google Gemini</option>
                      <option value="groq">Groq Cloud</option>
                      <option value="anthropic">Anthropic (Claude)</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="openai">OpenAI</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="mistral">Mistral AI</option>
                      <option value="cerebras">Cerebras</option>
                      <option value="nvidia">NVIDIA NIM</option>
                    </select>
                  </div>
                </div>

                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={`الصق المفاتيح بأي شكل تريده:\ngemini: AIzaSy...\nGROQ_API_KEY=gsk_...\nsk-ant-api03-...\nAIzaSy...`}
                  rows={5}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-200 font-mono placeholder-slate-600 outline-none focus:border-cyan-400 transition"
                />

                <button
                  onClick={() => handleBulkImport(bulkText, bulkProvider)}
                  disabled={bulkImporting || !bulkText.trim()}
                  className={`w-full py-2.5 rounded-xl text-xs font-semibold font-mono flex items-center justify-center gap-2 transition shadow-lg ${
                    bulkImporting || !bulkText.trim()
                      ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                      : "bg-cyan-600 hover:bg-cyan-500 text-white cursor-pointer shadow-[0_0_20px_rgba(34,211,238,0.3)]"
                  }`}
                >
                  <span>{bulkImporting ? "⏳" : "🚀"}</span>
                  <span>{bulkImporting ? "جاري الفحص والتحقق والحفظ..." : "فحص وتفعيل وحفظ المفاتيح"}</span>
                </button>
              </div>

              {/* Bulk Result Report */}
              {bulkResult && (
                <div className="space-y-4 pt-4 border-t border-slate-800 animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-white font-mono flex items-center gap-2">
                      <span>📊</span> تقرير نتائج الفحص والاستيراد
                    </h4>
                    <span className="text-[11px] font-mono text-slate-400">
                      إجمالي المفاتيح: {bulkResult.total_found}
                    </span>
                  </div>

                  {/* Summary Pills */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-center">
                      <div className="text-lg font-bold text-emerald-400 font-mono">{bulkResult.total_added}</div>
                      <div className="text-[10px] text-emerald-300">تم فحصها وإضافتها</div>
                    </div>
                    <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-center">
                      <div className="text-lg font-bold text-rose-400 font-mono">{bulkResult.total_rejected}</div>
                      <div className="text-[10px] text-rose-300">مرفوضة / منتهية</div>
                    </div>
                    <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 text-center">
                      <div className="text-lg font-bold text-slate-300 font-mono">{bulkResult.total_duplicates}</div>
                      <div className="text-[10px] text-slate-400">مكررة مسبقاً</div>
                    </div>
                  </div>

                  {/* Per provider breakdown */}
                  {Object.keys(bulkResult.by_provider || {}).length > 0 && (
                    <div className="flex flex-wrap gap-2 items-center text-xs">
                      <span className="text-slate-400 text-[11px]">التوزيع على المزودين:</span>
                      {Object.entries(bulkResult.by_provider).map(([prov, cnt]) => (
                        <span key={prov} className="px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[11px] font-mono font-medium">
                          {prov.toUpperCase()}: +{cnt}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Detailed list */}
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {bulkResult.details.map((d, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-200">{d.masked}</span>
                          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{d.provider}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-400 truncate max-w-xs">{d.message}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                            d.status === "added"
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : d.status === "duplicate"
                              ? "bg-slate-700 text-slate-300"
                              : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                          }`}>
                            {d.status === "added" ? "✓ تمت الإضافة" : d.status === "duplicate" ? "مكرر" : "مرفوض"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/60 flex justify-end">
              <button
                onClick={() => { setShowBulkModal(false); setBulkResult(null); }}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm dialog ──────────────────────────────────────────────────── */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl p-6 max-w-md shadow-2xl">
            <p className="text-slate-200 mb-6">{confirmDialog.text}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onYes}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
