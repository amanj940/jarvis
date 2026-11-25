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
import { type Lang, useTranslations } from "../../lib/i18n";
import {
  getTools,
  getPlugins,
  togglePlugin,
  getMcpServers,
  getMcpPresets,
  connectMcpPreset,
  testMcpServer,
  testIntegration,
  addMcpServer,
  toggleMcpServer,
  deleteMcpServer,
  getHealth,
  getCascadeStatus,
  getKeysStatus,
  getVerifiedModels,
  getMcpServerLogs,
  authFetch,
} from "../../lib/api";
import { resetAllLayouts } from "./Floating";
import AuthTab from "./AuthTab";
import VaultTab from "./VaultTab";
import {
  PROVIDER_ENDPOINTS,
  PREDEFINED_MODELS,
  PROVIDER_INFO,
  type Toast,
} from "./SettingsParts/constants";
import { Toggle, Row, ToolParams } from "./SettingsParts/ui";
import MonitorTab from "./SettingsParts/MonitorTab";
import PlatformDetailModal from "./SettingsParts/PlatformDetailModal";

const APP_VERSION = "0.2.0";

interface SettingsProps {
  onClose: () => void;
  initialTab?: string;
}

export default function Settings({ onClose, initialTab }: SettingsProps) {
  const health = useStore((s) => s.health);
  const shellMode = useStore((s) => s.shellMode);
  const setShellMode = useStore((s) => s.setShellMode);
  const voiceEnabled = useStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useStore((s) => s.setVoiceEnabled);
  const wakeEnabled = useStore((s) => s.wakeEnabled);
  const setWakeEnabled = useStore((s) => s.setWakeEnabled);
  const bargeIn = useStore((s) => s.bargeIn);
  const setBargeIn = useStore((s) => s.setBargeIn);
  const clearChat = useStore((s) => s.clearChat);
  const clearMedia = useStore((s) => s.clearMedia);
  const clearTools = useStore((s) => s.clearTools);
  const setReader = useStore((s) => s.setReader);
  const prevSessionAvailable = useStore((s) => s.prevSessionAvailable);
  const restoreLastSession = useStore((s) => s.restoreLastSession);
  const authToken = useStore((s) => s.authToken);
  const sttEngine = useStore((s) => s.sttEngine);
  const setSttEngine = useStore((s) => s.setSttEngine);
  const sttModel = useStore((s) => s.sttModel);
  const setSttModel = useStore((s) => s.setSttModel);
  const sttCustomEndpoint = useStore((s) => s.sttCustomEndpoint);
  const setSttCustomEndpoint = useStore((s) => s.setSttCustomEndpoint);
  const sttCustomApiKey = useStore((s) => s.sttCustomApiKey);
  const setSttCustomApiKey = useStore((s) => s.setSttCustomApiKey);

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
  const setLanguage = useStore((s) => s.setLanguage);
  const t = useTranslations(lang);

  const [activeTab, setActiveTab] = useState(normalizeTab(initialTab));
  const [aiSubTab, setAiSubTab] = useState<"inference" | "providers" | "council" | "swarm">(
    initialTab === "providers" ? "providers" : "inference"
  );
  const [swarmTasks, setSwarmTasks] = useState([
    { role: "researcher", goal: "ابحث عن أفضل استراتيجيات التخزين المؤقت وحجم استهلاك الذاكرة." },
    { role: "coder", goal: "اكتب وحدة بايثون Asyncio لتطبيق LRU Cache مع اختبارات وحدة دقيقة." },
  ]);
  const [swarmRunning, setSwarmRunning] = useState(false);
  const [swarmResults, setSwarmResults] = useState<any[]>([]);

  // ── Ollama Service Control state ───────────────────────────────────────────
  const [ollamaStatus, setOllamaStatus] = useState<{
    running: boolean;
    systemd_active: boolean;
    reachable: boolean;
    models: string[];
    model_count: number;
  } | null>(null);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const [ollamaPullModel, setOllamaPullModel] = useState("");
  const [ollamaPullMsg, setOllamaPullMsg] = useState("");

  const [councilTopic, setCouncilTopic] = useState("");
  const [councilRunning, setCouncilRunning] = useState(false);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkLeaderboard, setBenchmarkLeaderboard] = useState<Array<{
    provider: string;
    model: string;
    status: string;
    latency_ms: number;
    tps: number;
    reasoning_score: number;
    quota_remaining_requests: string;
    assigned_seat?: string;
    seat_role?: string;
    seat_icon?: string;
    error_message?: string;
  }>>([]);
  const [dynamicRoster, setDynamicRoster] = useState<Array<{
    id: string;
    name: string;
    provider: string;
    model: string;
    icon: string;
    role: string;
    specialty: string;
    active: boolean;
  }>>([]);
  const [councilResult, setCouncilResult] = useState<{
    topic: string;
    members: Array<{ id: string; name: string; icon: string; role: string }>;
    proposals: Array<{ member_id: string; member_name: string; icon: string; model: string; content: string }>;
    peer_critiques: Array<{ member_id: string; member_name: string; icon: string; model: string; critique: string }>;
    consensus: string;
    agreement_score: number;
  } | null>(null);

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
  interface ToolItem {
    name: string;
    description: string;
    permission: string;
    plugin: string;
    parameters?: any;
  }
  const [toolsList, setToolsList] = useState<ToolItem[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolSearch, setToolSearch] = useState("");
  const [selectedPlugin, setSelectedPlugin] = useState<string>("all");
  const [selectedPermission, setSelectedPermission] = useState<string>("all");
  // FG-009 (ported from ui): expanded plugin card (lists its tools).
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  // Plugins list & toggling
  const [pluginsMap, setPluginsMap] = useState<Record<string, boolean>>({});
  const [pluginsLoaded, setPluginsLoaded] = useState(false);
  const [pluginToggleLoading, setPluginToggleLoading] = useState<string | null>(null);
  // FG-009 (ported from ui): plugin awaiting disable confirmation — the
  // user must explicitly confirm before a plugin with live tools is
  // disabled ("Disable anyway"); cancelling leaves it enabled.
  const [pluginDisableWarn, setPluginDisableWarn] = useState<string | null>(null);

  // ── MCP State ─────────────────────────────────────────────────────────────
  interface McpToolItem {
    name: string;
    description?: string;
    inputSchema?: {
      type?: string;
      properties?: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
  }

  interface McpServerItem {
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    enabled: boolean;
    description: string;
    connected?: boolean;
    status?: string;
    tools_count?: number;
    tools?: (string | McpToolItem)[];
    error?: string | null;
  }

  interface McpPresetItem {
    id: string;
    name: string;
    label: string;
    icon: string;
    desc: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    auto_detected: boolean;
    detection_info: string;
    token_preview?: string;
    already_configured: boolean;
    is_running: boolean;
  }

  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([]);
  const [mcpPresets, setMcpPresets] = useState<McpPresetItem[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [presetConnecting, setPresetConnecting] = useState<string | null>(null);
  const [expandedToolsServer, setExpandedToolsServer] = useState<string | null>(null);
  const [serverTesting, setServerTesting] = useState<Record<string, { loading: boolean; latency?: number; error?: string }>>({});
  const [serverLogs, setServerLogs] = useState<Record<string, string>>({});
  const [expandedLogsServer, setExpandedLogsServer] = useState<string | null>(null);
  // FG-010 (ported from ui): per-server "logs endpoint not exposed" flag so
  // the drawer shows an honest unavailable panel instead of "No logs available".
  const [logsUnavailable, setLogsUnavailable] = useState<Record<string, boolean>>({});
  const [integrationTesting, setIntegrationTesting] = useState<Record<string, { loading: boolean; success?: boolean; msg?: string; latency?: number }>>({});
  // FG-014 / FG-016 (ported from ui): per-integration test history, last 10
  // runs kept in localStorage, last 5 shown. Purely local; no backend call.
  const [integrationHistory, setIntegrationHistory] = useState<
    Record<string, Array<{ ok: boolean; msg: string; latency?: number; at: string }>>
  >(() => {
    try {
      return JSON.parse(localStorage.getItem("jarvis_integration_test_history") || "{}");
    } catch {
      return {};
    }
  });
  const [selectedPlatformModal, setSelectedPlatformModal] = useState<{
    id: string;
    name: string;
    icon: string;
    serverConfig?: any;
    integrationConfig?: any;
  } | null>(null);
  const [showAddMcpModal, setShowAddMcpModal] = useState(false);
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpCommand, setNewMcpCommand] = useState("");
  const [newMcpArgs, setNewMcpArgs] = useState("");
  const [newMcpDesc, setNewMcpDesc] = useState("");
  const [newMcpEnv, setNewMcpEnv] = useState("");

  // ── Integrations State ────────────────────────────────────────────────────
  interface IntegrationsConfig {
    home_assistant: {
      url: string;
      token: string;
      enabled: boolean;
      has_token?: boolean;
    };
    calendar: {
      ical_url: string;
      enabled: boolean;
    };
    email: {
      smtp_host: string;
      smtp_port: number;
      username: string;
      password?: string;
      enabled: boolean;
      has_credentials?: boolean;
    };
    telegram: {
      bot_token: string;
      chat_id: string;
      enabled: boolean;
      has_token?: boolean;
    };
    facebook?: {
      page_id: string;
      page_access_token: string;
      enabled: boolean;
      has_token?: boolean;
    };
    youtube?: {
      client_id: string;
      client_secret: string;
      refresh_token: string;
      channel_id: string;
      enabled: boolean;
      has_secret?: boolean;
      has_token?: boolean;
    };
    instagram?: {
      user_id: string;
      access_token: string;
      enabled: boolean;
      has_token?: boolean;
    };
    tiktok?: {
      client_key: string;
      client_secret: string;
      access_token: string;
      open_id: string;
      enabled: boolean;
      has_secret?: boolean;
      has_token?: boolean;
    };
    social_platforms?: Record<string, any>;
  }
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
  interface KeyPoolItem {
    masked: string;
    key_preview?: string;
    status: string;
    cooldown_remaining?: number;
    failures?: number;
    successes?: number;
    last_error?: string | null;
  }
  const [keyPools, setKeyPools] = useState<Record<string, KeyPoolItem[]>>({});
  const [newKeyInput, setNewKeyInput] = useState("");
  const [addingKey, setAddingKey] = useState(false);
  const [keyAddError, setKeyAddError] = useState<string | null>(null);
  const [keyAddSuccess, setKeyAddSuccess] = useState<string | null>(null);
  const [enableFallback, setEnableFallback] = useState(false);
  const [fallbackProvider, setFallbackProvider] = useState("gemini");
  const [fallbackModel, setFallbackModel] = useState("gemini-2.0-flash");

  // ── Model Verification Status state ───────────────────────────────────────
  const [verifiedModels, setVerifiedModels] = useState<Record<string, { status: string; latency_ms: number | null; last_tested: string }>>({});

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

  // ── Brain / Ultimate Config state ──────────────────────────────────────
  const [brainSemanticMemory, setBrainSemanticMemory] = useState(true);
  const [brainEmbedModel, setBrainEmbedModel] = useState("text-embedding-004");
  const [brainRecallK, setBrainRecallK] = useState(5);
  const [brainAutoRemember, setBrainAutoRemember] = useState(true);
  const [brainCompactionTrigger, setBrainCompactionTrigger] = useState(28);
  const [brainCompactionKeep, setBrainCompactionKeep] = useState(12);

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
  const edgeVoice = chatLanguage === "ar" ? edgeVoiceAr : edgeVoiceEn;

  // VAD Calibration state
  const [vadSilenceThreshold, setVadSilenceThreshold] = useState(0.08);
  const [vadSilenceTimeoutMs, setVadSilenceTimeoutMs] = useState(600);
  const [vadMinRecordingMs, setVadMinRecordingMs] = useState(500);
  const [vadMaxRecordingMs, setVadMaxRecordingMs] = useState(8000);
  const [vadBaselineWindowMs, setVadBaselineWindowMs] = useState(1200);
  const [vadBaselineMultiplier, setVadBaselineMultiplier] = useState(2.2);
  const [vadSileroThreshold, setVadSileroThreshold] = useState(0.5);
  const [vadSileroMinSilenceMs, setVadSileroMinSilenceMs] = useState(500);
  const [vadBargeInMultiplier, setVadBargeInMultiplier] = useState(3.5);
  const [vadBargeInFloor, setVadBargeInFloor] = useState(0.15);
  const [vadBargeInSustainMs, setVadBargeInSustainMs] = useState(250);
  const [vadSttCoalesceMs, setVadSttCoalesceMs] = useState(500);
  const [vadHallucinationFilter, setVadHallucinationFilter] = useState(true);
  const [vadFillerFilter, setVadFillerFilter] = useState(true);

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
        if (j.vad) {
          setVadSilenceThreshold(j.vad.silence_threshold ?? 0.08);
          setVadSilenceTimeoutMs(j.vad.silence_timeout_ms ?? 600);
          setVadMinRecordingMs(j.vad.min_recording_ms ?? 300);
          setVadMaxRecordingMs(j.vad.max_recording_ms ?? 30000);
          setVadBaselineWindowMs(j.vad.baseline_window_ms ?? 2000);
          setVadBaselineMultiplier(j.vad.baseline_multiplier ?? 2.2);
          setVadSileroThreshold(j.vad.silero_threshold ?? 0.5);
          setVadSileroMinSilenceMs(j.vad.silero_min_silence_duration_ms ?? 500);
          setVadBargeInMultiplier(j.vad.barge_in_multiplier ?? 3.0);
          setVadBargeInFloor(j.vad.barge_in_floor ?? 0.15);
          setVadBargeInSustainMs(j.vad.barge_in_sustain_ms ?? 120);
          setVadSttCoalesceMs(j.vad.stt_coalesce_ms ?? 120);
          setVadHallucinationFilter(j.vad.hallucination_filter_enabled ?? true);
          setVadFillerFilter(j.vad.filler_filter_enabled ?? true);
        }
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
        if (j.ultimate) {
          if (j.ultimate.semantic_memory !== undefined) setBrainSemanticMemory(j.ultimate.semantic_memory);
          if (j.ultimate.embed_model) setBrainEmbedModel(j.ultimate.embed_model);
          if (j.ultimate.recall_k !== undefined) setBrainRecallK(j.ultimate.recall_k);
          if (j.ultimate.auto_remember !== undefined) setBrainAutoRemember(j.ultimate.auto_remember);
          if (j.ultimate.compaction_trigger_messages !== undefined) setBrainCompactionTrigger(j.ultimate.compaction_trigger_messages);
          if (j.ultimate.compaction_keep_recent !== undefined) setBrainCompactionKeep(j.ultimate.compaction_keep_recent);
        }
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
          vad: {
            silence_threshold: vadSilenceThreshold,
            silence_timeout_ms: vadSilenceTimeoutMs,
            min_recording_ms: vadMinRecordingMs,
            max_recording_ms: vadMaxRecordingMs,
            baseline_window_ms: vadBaselineWindowMs,
            baseline_multiplier: vadBaselineMultiplier,
            silero_threshold: vadSileroThreshold,
            silero_min_silence_duration_ms: vadSileroMinSilenceMs,
            barge_in_multiplier: vadBargeInMultiplier,
            barge_in_floor: vadBargeInFloor,
            barge_in_sustain_ms: vadBargeInSustainMs,
            stt_coalesce_ms: vadSttCoalesceMs,
            hallucination_filter_enabled: vadHallucinationFilter,
            filler_filter_enabled: vadFillerFilter,
          },
          ui: {
            theme,
            emoji: showEmojis,
            show_status_bar: showStatusBar,
            refresh_interval_ms: refreshInterval,
          },
          integrations,
          plugins: pluginsMap,
          ultimate: {
            semantic_memory: brainSemanticMemory,
            embed_model: brainEmbedModel,
            recall_k: brainRecallK,
            auto_remember: brainAutoRemember,
            compaction_trigger_messages: brainCompactionTrigger,
            compaction_keep_recent: brainCompactionKeep,
          },
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
      vad: {
        silence_threshold: vadSilenceThreshold,
        silence_timeout_ms: vadSilenceTimeoutMs,
        min_recording_ms: vadMinRecordingMs,
        max_recording_ms: vadMaxRecordingMs,
        baseline_window_ms: vadBaselineWindowMs,
        baseline_multiplier: vadBaselineMultiplier,
        silero_threshold: vadSileroThreshold,
        silero_min_silence_duration_ms: vadSileroMinSilenceMs,
        barge_in_multiplier: vadBargeInMultiplier,
        barge_in_floor: vadBargeInFloor,
        barge_in_sustain_ms: vadBargeInSustainMs,
        stt_coalesce_ms: vadSttCoalesceMs,
        hallucination_filter_enabled: vadHallucinationFilter,
        filler_filter_enabled: vadFillerFilter,
      },
      ui: {
        theme,
        emoji: showEmojis,
        show_status_bar: showStatusBar,
        refresh_interval_ms: refreshInterval,
      },
      // permissions intentionally excluded from export/import/reset (FG-019/020)
      integrations,
      plugins: pluginsMap,
      ultimate: {
        semantic_memory: brainSemanticMemory,
        embed_model: brainEmbedModel,
        recall_k: brainRecallK,
        auto_remember: brainAutoRemember,
        compaction_trigger_messages: brainCompactionTrigger,
        compaction_keep_recent: brainCompactionKeep,
      },
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
        if (j.vad) {
          if (typeof j.vad.silence_threshold === "number") setVadSilenceThreshold(j.vad.silence_threshold);
          if (typeof j.vad.silence_timeout_ms === "number") setVadSilenceTimeoutMs(j.vad.silence_timeout_ms);
          if (typeof j.vad.min_recording_ms === "number") setVadMinRecordingMs(j.vad.min_recording_ms);
          if (typeof j.vad.max_recording_ms === "number") setVadMaxRecordingMs(j.vad.max_recording_ms);
          if (typeof j.vad.baseline_window_ms === "number") setVadBaselineWindowMs(j.vad.baseline_window_ms);
          if (typeof j.vad.baseline_multiplier === "number") setVadBaselineMultiplier(j.vad.baseline_multiplier);
          if (typeof j.vad.silero_threshold === "number") setVadSileroThreshold(j.vad.silero_threshold);
          if (typeof j.vad.silero_min_silence_duration_ms === "number") setVadSileroMinSilenceMs(j.vad.silero_min_silence_duration_ms);
          if (typeof j.vad.barge_in_multiplier === "number") setVadBargeInMultiplier(j.vad.barge_in_multiplier);
          if (typeof j.vad.barge_in_floor === "number") setVadBargeInFloor(j.vad.barge_in_floor);
          if (typeof j.vad.barge_in_sustain_ms === "number") setVadBargeInSustainMs(j.vad.barge_in_sustain_ms);
          if (typeof j.vad.stt_coalesce_ms === "number") setVadSttCoalesceMs(j.vad.stt_coalesce_ms);
          if (typeof j.vad.hallucination_filter_enabled === "boolean") setVadHallucinationFilter(j.vad.hallucination_filter_enabled);
          if (typeof j.vad.filler_filter_enabled === "boolean") setVadFillerFilter(j.vad.filler_filter_enabled);
        }
        if (j.ui) {
          if (j.ui.theme) setTheme(j.ui.theme);
          if (typeof j.ui.emoji === "boolean") setShowEmojis(j.ui.emoji);
          if (typeof j.ui.show_status_bar === "boolean") setShowStatusBar(j.ui.show_status_bar);
          if (typeof j.ui.refresh_interval_ms === "number") setRefreshInterval(j.ui.refresh_interval_ms);
        }
        if (j.permissions?.mode) setPermMode(j.permissions.mode);
        if (j.integrations) setIntegrations((prev) => ({ ...prev, ...j.integrations }));
        if (j.plugins) setPluginsMap(j.plugins);
        if (j.ultimate) {
          if (typeof j.ultimate.semantic_memory === "boolean") setBrainSemanticMemory(j.ultimate.semantic_memory);
          if (j.ultimate.embed_model) setBrainEmbedModel(j.ultimate.embed_model);
          if (typeof j.ultimate.recall_k === "number") setBrainRecallK(j.ultimate.recall_k);
          if (typeof j.ultimate.auto_remember === "boolean") setBrainAutoRemember(j.ultimate.auto_remember);
          if (typeof j.ultimate.compaction_trigger_messages === "number") setBrainCompactionTrigger(j.ultimate.compaction_trigger_messages);
          if (typeof j.ultimate.compaction_keep_recent === "number") setBrainCompactionKeep(j.ultimate.compaction_keep_recent);
        }
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
    setVadSilenceThreshold(0.08);
    setVadSilenceTimeoutMs(600);
    setVadMinRecordingMs(500);
    setVadMaxRecordingMs(8000);
    setVadBaselineWindowMs(1200);
    setVadBaselineMultiplier(2.2);
    setVadSileroThreshold(0.5);
    setVadSileroMinSilenceMs(500);
    setVadBargeInMultiplier(3.5);
    setVadBargeInFloor(0.15);
    setVadBargeInSustainMs(250);
    setVadSttCoalesceMs(500);
    setVadHallucinationFilter(true);
    setVadFillerFilter(true);
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
    setBrainSemanticMemory(true);
    setBrainEmbedModel("text-embedding-004");
    setBrainRecallK(5);
    setBrainAutoRemember(true);
    setBrainCompactionTrigger(28);
    setBrainCompactionKeep(12);
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

  // FG-014 / FG-016 (ported from ui): test one integration and record the
  // run in history. Latency prefers the backend-reported latency_ms and
  // falls back to client-measured time.
  const handleTestIntegration = async (type: "email" | "telegram" | "home_assistant" | "calendar") => {
    setIntegrationTesting((prev) => ({ ...prev, [type]: { loading: true } }));
    const started = Date.now();
    const record = (ok: boolean, msg: string, latency: number) => {
      const entry = { ok, msg, latency, at: new Date().toISOString() };
      setIntegrationTesting((prev) => ({ ...prev, [type]: { loading: false, success: ok, msg, latency } }));
      setIntegrationHistory((prev) => {
        const next = { ...prev, [type]: [entry, ...(prev[type] || [])].slice(0, 10) };
        try {
          localStorage.setItem("jarvis_integration_test_history", JSON.stringify(next));
        } catch {
          // storage unavailable — history stays in memory only
        }
        return next;
      });
    };
    try {
      const payload = (integrations as any)[type] || {};
      const res = await testIntegration(type, payload);
      const latency = res.latency_ms ?? (Date.now() - started);
      if (res.ok) {
        record(true, res.message, latency);
        pushToast(`✓ ${type.replace("_", " ").toUpperCase()}: ${res.message} (${latency}ms)`);
      } else {
        record(false, res.error, latency);
        pushToast(`${type.toUpperCase()} error: ${res.error}`, "error");
      }
    } catch (err: any) {
      const latency = Date.now() - started;
      record(false, err?.message || "Failed", latency);
      pushToast(`Failed to test ${type}: ${err?.message || "Error"}`, "error");
    }
  };

  // FG-016 (ported from ui): test every integration in turn, sequentially,
  // so each result lands in the same localStorage history as a single test.
  const handleTestAllIntegrations = async () => {
    setIntegrationTesting((prev) => ({ ...prev, all: { loading: true } }));
    try {
      for (const t of ["email", "telegram", "home_assistant", "calendar"] as const) {
        await handleTestIntegration(t);
      }
      setIntegrationTesting((prev) => ({ ...prev, all: { loading: false, success: true } }));
    } catch {
      setIntegrationTesting((prev) => ({ ...prev, all: { loading: false, success: false } }));
    }
  };

  // FG-014: per-integration test history (last 5 shown).
  const renderTestHistory = (type: "email" | "telegram" | "home_assistant" | "calendar") => {
    const hist = integrationHistory[type] || [];
    if (hist.length === 0) return null;
    return (
      <div className="pt-2 border-t border-slate-700/50 space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">
          Test history (last {Math.min(hist.length, 5)})
        </div>
        {hist.slice(0, 5).map((h, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
            <span className={h.ok ? "text-emerald-400" : "text-rose-400"}>{h.ok ? "✓" : "✗"}</span>
            <span className="text-slate-500">{new Date(h.at).toLocaleString()}</span>
            <span className="truncate">{h.msg || (h.ok ? "OK" : "failed")}</span>
            {h.latency !== undefined && <span className="text-slate-500">{h.latency}ms</span>}
          </div>
        ))}
      </div>
    );
  };

  // ── Provider change: update models + endpoint hint ───────────────────────
  const onProviderChange = useCallback((prov: string) => {
    setProvider(prov);
    const defaults = PREDEFINED_MODELS[prov] || [];
    setAvailableModels(defaults);
    if (defaults.length > 0) {
      setModel(defaults[0]);
    }
    setModelsFetched(false);
    setKeyValid(null);
    setModelError(null);
    setIsCustomModel(false);
    setDirty(true);
    const ep = PROVIDER_ENDPOINTS[prov];
    if (ep) setEndpoint(ep);
    setApiKeyInput("");
    const key = (apiKeys[prov] || "").trim();
    const finalEp = ep || endpoint;
    // Always fetch models for cloud providers (KeyManager will supply the key)
    if (prov === "openai_compatible") {
      if (finalEp) fetchModels(prov, "", finalEp);
    } else if (apiKeyStatus[prov] || keyPools[prov]?.length > 0) {
      fetchModels(prov, "", finalEp); // Let backend use KeyManager
    }
  }, [apiKeys, apiKeyStatus, endpoint, fetchModels, keyPools]);

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

  const runAutoBenchmarkAndElect = async () => {
    if (benchmarkRunning) return;
    setBenchmarkRunning(true);
    pushToast("جاري فحص جميع النماذج وقياس السرعة والحصص...", "ok");
    try {
      const resp = await authFetch("/api/council/benchmark", { method: "POST" });
      const data = await resp.json();
      if (data.ok) {
        setBenchmarkLeaderboard(data.leaderboard || []);
        if (data.elected_council && data.elected_council.length > 0) {
          setDynamicRoster(data.elected_council);
        }
        pushToast(`✓ تم فحص ${data.candidates_tested} نماذج وتعيين أعضاء المجلس بنجاح!`, "ok");
      } else {
        pushToast(`فشل الفحص: ${data.error || "خطأ غير معروف"}`, "error");
      }
    } catch (e: any) {
      pushToast(`خطأ في الاتصال: ${e.message}`, "error");
    } finally {
      setBenchmarkRunning(false);
    }
  };

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setBulkText(content);
        handleBulkImport(content, bulkProvider);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
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

  // ── Clean Slate ──────────────────────────────────────────────────────────
  const cleanSlate = async () => {
    clearChat();
    clearMedia();
    clearTools();
    setReader(null);
    try {
      await authFetch("/api/cleanslate", { method: "POST" });
      pushToast("Clean slate done. Conversation history wiped; memory preserved.");
    } catch {
      pushToast("Backend unreachable for clean slate", "error");
    }
  };

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

  // ── Export ────────────────────────────────────────────────────────────────
  const exportChat = () => {
    const chat = useStore.getState().chat;
    const blob = new Blob([JSON.stringify(chat, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jarvis-chat-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast("Chat history exported");
  };

  // ── Confirm dialog state ──────────────────────────────────────────────────
  const [confirmDialog, setConfirmDialog] = useState<{ text: string; onYes: () => void } | null>(null);

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
        {activeTab === "tools" && (() => {
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
        })()}

        {/* ══ AI & Brain ═══════════════════════════════════════════════════ */}
        {activeTab === "ai" && (() => {
          const cloudProviders = Object.entries(PROVIDER_INFO).filter(([, v]) => v.kind === "cloud");
          const localProviders = Object.entries(PROVIDER_INFO).filter(([, v]) => v.kind === "local");
          const ProviderCard = ({ pid, info }: { pid: string; info: typeof PROVIDER_INFO[string] }) => {
            const keys = keyPools[pid] || [];
            const hasKey = apiKeyStatus[pid] || keys.length > 0;
            const count = modalModelCounts[pid];
            return (
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 flex flex-col gap-3 hover:border-slate-600 transition">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{info.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-100 text-sm truncate">{info.name}</div>
                    <div className="text-xs text-slate-400">{info.desc}</div>
                  </div>
                </div>
                <div className="text-xs font-medium">
                  {hasKey
                    ? <span className="text-emerald-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                        {count ? <><bdi>{count}</bdi> {t("models_avail")}</> : t("configured")}
                      </span>
                    : <span className="text-amber-400/80 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                        {t("not_configured")}
                      </span>
                  }
                </div>
                <button
                  onClick={() => openProviderConfig(pid)}
                  className={`w-full px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
                    hasKey
                      ? "bg-slate-700 hover:bg-slate-600 text-slate-100"
                      : "bg-cyan-700 hover:bg-cyan-600 text-white"
                  }`}
                >
                  {hasKey ? t("edit") : t("configure")}
                </button>
              </div>
            );
          };
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
                  <div className="space-y-2">
                    <label className="text-sm text-slate-300">Provider</label>
                    <select
                      value={provider}
                      onChange={(e) => onProviderChange(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white"
                    >
                      <optgroup label="⚡ Core Cloud Providers">
                        <option value="groq">Groq — Fastest Cloud Inference</option>
                        <option value="gemini">Google Gemini</option>
                        <option value="openai">OpenAI (GPT)</option>
                        <option value="anthropic">Anthropic (Claude)</option>
                        <option value="openrouter">OpenRouter — Multi-Provider Gateway</option>
                        <option value="deepseek">DeepSeek</option>
                        <option value="nvidia">NVIDIA NIM</option>
                        <option value="mistral">Mistral AI</option>
                        <option value="cerebras">Cerebras</option>
                        <option value="sambanova">SambaNova</option>
                        <option value="cohere">Cohere</option>
                        <option value="xai">xAI (Grok)</option>
                      </optgroup>
                      <optgroup label="🌐 Extended Cloud Providers">
                        <option value="together">Together AI</option>
                        <option value="deepinfra">DeepInfra</option>
                        <option value="siliconflow">SiliconFlow</option>
                        <option value="nebius">Nebius</option>
                        <option value="fireworks">Fireworks AI</option>
                        <option value="novita">Novita AI</option>
                        <option value="huggingface">Hugging Face</option>
                        <option value="alibaba_cloud">Alibaba (Qwen)</option>
                        <option value="minimax">MiniMax</option>
                        <option value="kimi">Kimi (Moonshot)</option>
                        <option value="scaleway">Scaleway</option>
                        <option value="bedrock">Amazon Bedrock</option>
                        <option value="chutes">Chutes AI</option>
                        <option value="featherless">Featherless AI</option>
                        <option value="wandb">W&B Inference</option>
                        <option value="vercel_ai">Vercel AI Gateway</option>
                        <option value="ollama_cloud">Ollama Cloud</option>
                      </optgroup>
                      <optgroup label="🆓 Free / No-Key Providers">
                        <option value="kilo">Kilo Gateway — 200 req/hr free</option>
                        <option value="pollinations">Pollinations — Unlimited free</option>
                        <option value="ovhcloud">OVHcloud AI — Free Qwen/Llama</option>
                        <option value="omniroute">9Router Proxy — Local Free Aggregator</option>
                      </optgroup>
                      <optgroup label="🏠 Local Providers">
                        <option value="ollama">Ollama (Local)</option>
                        <option value="lmstudio">LM Studio (Local)</option>
                        <option value="openai_compatible">Custom OpenAI-Compatible</option>
                      </optgroup>
                    </select>
                  </div>

                  {/* ── Ollama Service Control Card ── */}
                  {provider === "ollama" && (
                    <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4 space-y-3">
                      {/* Header row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">🦙</span>
                          <span className="text-sm font-semibold text-cyan-300">Ollama Local Service</span>
                          {ollamaStatus === null ? (
                            <span className="text-xs text-slate-500">جارٍ التحقق…</span>
                          ) : ollamaStatus.running ? (
                            <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
                              يعمل
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-red-400 font-medium">
                              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                              متوقف
                            </span>
                          )}
                        </div>
                        {/* Refresh button */}
                        <button
                          onClick={fetchOllamaStatus}
                          className="text-slate-400 hover:text-cyan-300 text-sm transition-colors"
                          title="تحديث الحالة"
                        >🔄</button>
                      </div>

                      {/* Start / Stop buttons */}
                      <div className="flex gap-2">
                        <button
                          disabled={ollamaLoading || ollamaStatus?.running === true}
                          onClick={async () => {
                            setOllamaLoading(true);
                            try {
                              const r = await authFetch("/api/ollama/start", { method: "POST" });
                              const d = await r.json();
                              if (d.status) setOllamaStatus(d.status);
                            } finally { setOllamaLoading(false); }
                          }}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors"
                        >
                          {ollamaLoading ? "⏳" : "▶"} تشغيل
                        </button>
                        <button
                          disabled={ollamaLoading || ollamaStatus?.running === false}
                          onClick={async () => {
                            setOllamaLoading(true);
                            try {
                              const r = await authFetch("/api/ollama/stop", { method: "POST" });
                              const d = await r.json();
                              if (d.status) setOllamaStatus(d.status);
                            } finally { setOllamaLoading(false); }
                          }}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-red-700/70 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors"
                        >
                          {ollamaLoading ? "⏳" : "⏹"} إيقاف
                        </button>
                      </div>

                      {/* Installed models */}
                      {ollamaStatus && ollamaStatus.models.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                            <span>📦 النماذج المثبتة ({ollamaStatus.model_count}) — اضغط لاختيار:</span>
                            {model && (
                              <span className="text-cyan-300 font-mono text-[11px]">الحالي: {model}</span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {ollamaStatus.models.map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => {
                                  setModel(m);
                                  setIsCustomModel(false);
                                  setDirty(true);
                                }}
                                className={`text-xs px-2.5 py-1 rounded-lg border transition-all cursor-pointer font-mono ${
                                  model === m
                                    ? "bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-sm shadow-cyan-500/30 font-semibold ring-1 ring-cyan-400/50"
                                    : "bg-slate-800/80 hover:bg-slate-700/80 border-slate-600 text-slate-300 hover:text-white hover:border-slate-500"
                                }`}
                              >
                                {model === m ? "✓ " : ""}{m}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {ollamaStatus && ollamaStatus.models.length === 0 && ollamaStatus.running && (
                        <p className="text-xs text-slate-500 italic">لا توجد نماذج مثبتة حتى الآن.</p>
                      )}

                      {/* Quick pull */}
                      <div className="flex gap-2 items-center">
                        <input
                          value={ollamaPullModel}
                          onChange={(e) => setOllamaPullModel(e.target.value)}
                          placeholder="تحميل نموذج… مثال: llama3.2:1b"
                          className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500"
                        />
                        <button
                          disabled={!ollamaPullModel.trim()}
                          onClick={async () => {
                            setOllamaPullMsg("⏳ جارٍ تحميل النموذج في الخلفية…");
                            await authFetch("/api/ollama/pull", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ model: ollamaPullModel.trim() }),
                            });
                            setOllamaPullMsg(`✅ تحميل "${ollamaPullModel}" بدأ في الخلفية`);
                            setOllamaPullModel("");
                            setTimeout(() => setOllamaPullMsg(""), 4000);
                          }}
                          className="bg-cyan-700/80 hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                        >
                          ⬇ تحميل
                        </button>
                      </div>
                      {ollamaPullMsg && (
                        <p className="text-xs text-cyan-300">{ollamaPullMsg}</p>
                      )}
                    </div>
                  )}

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
                          vad: { silence_threshold: vadSilenceThreshold, silence_timeout_ms: vadSilenceTimeoutMs, min_recording_ms: vadMinRecordingMs, max_recording_ms: vadMaxRecordingMs, baseline_window_ms: vadBaselineWindowMs, baseline_multiplier: vadBaselineMultiplier, silero_threshold: vadSileroThreshold, silero_min_silence_duration_ms: vadSileroMinSilenceMs, barge_in_multiplier: vadBargeInMultiplier, barge_in_floor: vadBargeInFloor, barge_in_sustain_ms: vadBargeInSustainMs, stt_coalesce_ms: vadSttCoalesceMs, hallucination_filter_enabled: vadHallucinationFilter, filler_filter_enabled: vadFillerFilter },
                          ui: { theme, emoji: showEmojis, show_status_bar: showStatusBar, refresh_interval_ms: refreshInterval },
                          permissions: { mode: permMode },
                          integrations,
                          plugins: pluginsMap,
                          ultimate: { semantic_memory: brainSemanticMemory, embed_model: brainEmbedModel, recall_k: brainRecallK, auto_remember: brainAutoRemember, compaction_trigger_messages: brainCompactionTrigger, compaction_keep_recent: brainCompactionKeep },
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
                              if (imported.vad) {
                                setVadSilenceThreshold(imported.vad.silence_threshold ?? 0.08);
                                setVadSilenceTimeoutMs(imported.vad.silence_timeout_ms ?? 600);
                                setVadMinRecordingMs(imported.vad.min_recording_ms ?? 300);
                                setVadMaxRecordingMs(imported.vad.max_recording_ms ?? 30000);
                                setVadBaselineWindowMs(imported.vad.baseline_window_ms ?? 2000);
                                setVadBaselineMultiplier(imported.vad.baseline_multiplier ?? 2.2);
                                setVadSileroThreshold(imported.vad.silero_threshold ?? 0.5);
                                setVadSileroMinSilenceMs(imported.vad.silero_min_silence_duration_ms ?? 500);
                                setVadBargeInMultiplier(imported.vad.barge_in_multiplier ?? 3.0);
                                setVadBargeInFloor(imported.vad.barge_in_floor ?? 0.15);
                                setVadBargeInSustainMs(imported.vad.barge_in_sustain_ms ?? 120);
                                setVadSttCoalesceMs(imported.vad.stt_coalesce_ms ?? 120);
                                setVadHallucinationFilter(imported.vad.hallucination_filter_enabled ?? true);
                                setVadFillerFilter(imported.vad.filler_filter_enabled ?? true);
                              }
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
                              if (imported.ultimate) {
                                if (imported.ultimate.semantic_memory !== undefined) setBrainSemanticMemory(imported.ultimate.semantic_memory);
                                if (imported.ultimate.embed_model) setBrainEmbedModel(imported.ultimate.embed_model);
                                if (imported.ultimate.recall_k !== undefined) setBrainRecallK(imported.ultimate.recall_k);
                                if (imported.ultimate.auto_remember !== undefined) setBrainAutoRemember(imported.ultimate.auto_remember);
                                if (imported.ultimate.compaction_trigger_messages !== undefined) setBrainCompactionTrigger(imported.ultimate.compaction_trigger_messages);
                                if (imported.ultimate.compaction_keep_recent !== undefined) setBrainCompactionKeep(imported.ultimate.compaction_keep_recent);
                              }
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
                        setVadSilenceThreshold(0.08);
                        setVadSilenceTimeoutMs(600);
                        setVadMinRecordingMs(300);
                        setVadMaxRecordingMs(30000);
                        setVadBaselineWindowMs(2000);
                        setVadBaselineMultiplier(2.2);
                        setVadSileroThreshold(0.5);
                        setVadSileroMinSilenceMs(500);
                        setVadBargeInMultiplier(3.0);
                        setVadBargeInFloor(0.15);
                        setVadBargeInSustainMs(120);
                        setVadSttCoalesceMs(120);
                        setVadHallucinationFilter(true);
                        setVadFillerFilter(true);
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
                        setBrainSemanticMemory(true);
                        setBrainEmbedModel("text-embedding-004");
                        setBrainRecallK(5);
                        setBrainAutoRemember(true);
                        setBrainCompactionTrigger(28);
                        setBrainCompactionKeep(12);
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
                <div className="bg-gradient-to-br from-indigo-950/40 via-slate-900/80 to-slate-900/40 border border-indigo-500/30 rounded-2xl p-6 space-y-5 mt-2">
                  <div className="flex items-center gap-3 border-b border-indigo-500/20 pb-3">
                    <span className="text-2xl">🧬</span>
                    <div>
                      <h3 className="font-bold text-white text-base font-mono">Brain Config — Memory & Cognition</h3>
                      <p className="text-xs text-slate-400 mt-0.5">إعدادات الذاكرة الدلالية طويلة الأمد وضغط السياق وعدد الذكريات المستدعاة</p>
                    </div>
                  </div>

                  {/* Semantic Memory toggle */}
                  <div className="flex items-center justify-between bg-slate-900/60 border border-slate-700/50 rounded-xl px-4 py-3">
                    <div>
                      <label className="text-sm font-semibold text-slate-200">🧠 الذاكرة الدلالية (Semantic Memory)</label>
                      <p className="text-xs text-slate-400 mt-0.5">يستدعي JARVIS ذكريات ذات صلة من الجلسات السابقة عند كل سؤال</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={brainSemanticMemory}
                        onChange={(e) => { setBrainSemanticMemory(e.target.checked); setDirty(true); }} className="sr-only peer" />
                      <div className="w-11 h-6 bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
                    </label>
                  </div>

                  {/* Auto-Remember toggle */}
                  <div className="flex items-center justify-between bg-slate-900/60 border border-slate-700/50 rounded-xl px-4 py-3">
                    <div>
                      <label className="text-sm font-semibold text-slate-200">💾 الحفظ التلقائي (Auto-Remember)</label>
                      <p className="text-xs text-slate-400 mt-0.5">يحفظ JARVIS نقاط المعلومات المهمة تلقائياً في الذاكرة طويلة الأمد</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={brainAutoRemember}
                        onChange={(e) => { setBrainAutoRemember(e.target.checked); setDirty(true); }} className="sr-only peer" />
                      <div className="w-11 h-6 bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
                    </label>
                  </div>

                  {/* Embedding Model */}
                  <div className="space-y-2">
                    <label className="text-sm text-slate-300 flex items-center gap-2">
                      <span>🔮</span> نموذج التضمين (Embedding Model)
                    </label>
                    <select
                      value={brainEmbedModel}
                      onChange={(e) => { setBrainEmbedModel(e.target.value); setDirty(true); }}
                      className="w-full bg-slate-900 border border-indigo-500/40 rounded-lg px-4 py-3 text-white text-sm"
                    >
                      <optgroup label="Google Gemini (Recommended)">
                        <option value="text-embedding-004">text-embedding-004 (Recommended)</option>
                        <option value="text-embedding-preview-0815">text-embedding-preview-0815</option>
                      </optgroup>
                      <optgroup label="OpenAI">
                        <option value="text-embedding-3-small">text-embedding-3-small</option>
                        <option value="text-embedding-3-large">text-embedding-3-large</option>
                        <option value="text-embedding-ada-002">text-embedding-ada-002 (Legacy)</option>
                      </optgroup>
                      <optgroup label="Local (Ollama)">
                        <option value="nomic-embed-text">nomic-embed-text</option>
                        <option value="mxbai-embed-large">mxbai-embed-large</option>
                      </optgroup>
                    </select>
                  </div>

                  {/* Grid: recall_k + compaction settings */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs text-slate-300 font-mono uppercase tracking-wider">
                        📌 عدد الذكريات المستدعاة (recall_k)
                      </label>
                      <input
                        type="number"
                        value={brainRecallK}
                        onChange={(e) => { setBrainRecallK(parseInt(e.target.value) || 5); setDirty(true); }}
                        min={1} max={20}
                        className="w-full bg-slate-900 border border-indigo-500/40 rounded-lg px-3 py-2 text-white text-sm font-mono"
                      />
                      <p className="text-xs text-slate-500">عدد الذكريات التي تُستدعى لكل رسالة</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-slate-300 font-mono uppercase tracking-wider">
                        🗜️ ضغط بعد (compaction trigger)
                      </label>
                      <input
                        type="number"
                        value={brainCompactionTrigger}
                        onChange={(e) => { setBrainCompactionTrigger(parseInt(e.target.value) || 28); setDirty(true); }}
                        min={8} max={100}
                        className="w-full bg-slate-900 border border-indigo-500/40 rounded-lg px-3 py-2 text-white text-sm font-mono"
                      />
                      <p className="text-xs text-slate-500">عدد الرسائل قبل ضغط السياق</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-slate-300 font-mono uppercase tracking-wider">
                        📂 احتفاظ بآخر (keep recent)
                      </label>
                      <input
                        type="number"
                        value={brainCompactionKeep}
                        onChange={(e) => { setBrainCompactionKeep(parseInt(e.target.value) || 12); setDirty(true); }}
                        min={4} max={50}
                        className="w-full bg-slate-900 border border-indigo-500/40 rounded-lg px-3 py-2 text-white text-sm font-mono"
                      />
                      <p className="text-xs text-slate-500">عدد الرسائل الأخيرة المحفوظة بعد الضغط</p>
                    </div>
                  </div>

                  <button onClick={saveConfig}
                    className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition font-semibold text-sm">
                    حفظ إعدادات الذاكرة
                  </button>
                </div>
              )}

              {/* ─ Providers sub-tab ─ */}
              {aiSubTab === "providers" && (
                <div className="space-y-8">
                  {/* Bulk Key Import Action Card */}
                  <div className="bg-gradient-to-r from-slate-900 via-slate-800/80 to-slate-900 border border-cyan-500/30 rounded-2xl p-5 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex items-start gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-2xl shrink-0 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
                        📁
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-white text-base">استيراد وفحص المفاتيح الجماعية (Bulk API Keys)</h3>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                            .txt / .env / .json
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                          ارفع ملف نصي (.txt) أو الصق قائمة مفاتيح متعددة؛ يقوم النظام بالتعرف على المزودين آلياً، واختبار صلاحية كل مفتاح دون استهلاك توكن، وحفظ المفاتيح الصالحة في المصفوفة.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 w-full md:w-auto">
                      <input
                        type="file"
                        ref={bulkFileInputRef}
                        accept=".txt,.env,.json,.csv"
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                      <button
                        onClick={() => bulkFileInputRef.current?.click()}
                        disabled={bulkImporting}
                        className={`flex-1 md:flex-initial px-5 py-2.5 rounded-xl text-xs font-semibold font-mono flex items-center justify-center gap-2 transition ${
                          bulkImporting
                            ? "bg-amber-600/40 text-amber-300 border border-amber-500/50 cursor-wait animate-pulse"
                            : "bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_20px_rgba(34,211,238,0.3)] cursor-pointer"
                        }`}
                      >
                        <span>{bulkImporting ? "⏳" : "📄"}</span>
                        <span>{bulkImporting ? "جاري الفحص والاستيراد..." : "تحميل ملف TXT وفحص المفاتيح"}</span>
                      </button>
                      <button
                        onClick={() => setShowBulkModal(true)}
                        className="px-4 py-2.5 rounded-xl text-xs font-semibold font-mono bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5"
                      >
                        <span>✏️</span>
                        <span>لصق نص</span>
                      </button>
                    </div>
                  </div>

                  {/* Free Tier Banner */}
                  <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900/80 to-teal-950/40 border border-emerald-500/30 rounded-2xl p-5 shadow-xl">
                    <div className="flex items-start gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-2xl shrink-0">🆓</div>
                      <div>
                        <h3 className="font-bold text-white text-base flex items-center gap-2">
                          مزودون مجانيون بدون مفتاح API
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">NO API KEY REQUIRED</span>
                        </h3>
                        <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                          هذه المزودات تعمل فوراً بدون تسجيل أو مفاتيح. يمكنك اختيارها كمزود رئيسي أو احتياطي لضمان استمرارية الخدمة.
                        </p>
                        <div className="flex flex-wrap gap-2 mt-3">
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 font-mono">Kilo: 200 req/hr</span>
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 font-mono">Pollinations: Unlimited</span>
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 font-mono">OVHcloud: 2 req/min</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Free Tier Providers */}
                  <section>
                    <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-widest mb-4">🆓 Free / No-Key Providers</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {Object.entries(PROVIDER_INFO)
                        .filter(([pid]) => ["kilo", "pollinations", "ovhcloud"].includes(pid))
                        .map(([pid, info]) => <ProviderCard key={pid} pid={pid} info={info} />)}
                    </div>
                  </section>

                  <section>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">☁️ Cloud Providers</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {cloudProviders.map(([pid, info]) => <ProviderCard key={pid} pid={pid} info={info} />)}
                    </div>
                  </section>
                  <section>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">🏠 Local Providers</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {localProviders.map(([pid, info]) => <ProviderCard key={pid} pid={pid} info={info} />)}
                    </div>
                  </section>
                </div>
              )}

              {aiSubTab === "council" && (
                <div className="space-y-6">
                  {/* Banner */}
                  <div className="bg-gradient-to-r from-cyan-950/60 via-slate-900 to-indigo-950/60 border border-cyan-500/30 rounded-2xl p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-3">
                          <span className="text-3xl">🏛️</span>
                          <h3 className="text-xl font-bold text-white font-mono">
                            Multi-Model AI Council (Consensus Engine)
                          </h3>
                        </div>
                        <p className="text-xs text-slate-300 mt-2 leading-relaxed max-w-3xl">
                          نظام مداولة واتخاذ قرار جماعي متقدم (مستوحى من <strong>consoles.ai</strong> و Mixture-of-Agents). 
                          يطرح المسائل المعمارية والبرمجية المعقدة على نخبة من نماذج الذكاء الاصطناعي بالتوازي، 
                          وينظم جولة مراجعة ونقد متبادل، ثم يصيغ قراراً وإجماعاً نهائياً موحداً برئاسة J.A.R.V.I.S.
                        </p>
                      </div>
                      <span className="text-xs font-mono px-3 py-1.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shrink-0">
                        consoles.ai mode
                      </span>
                    </div>
                  </div>

                  {/* Benchmark & Seat Election Action Bar */}
                  <div className="bg-slate-900/90 border border-slate-700/60 rounded-2xl p-5 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm font-bold text-white font-mono">
                        <span className="text-cyan-400">⚡</span> فحص النماذج وقياس السرعة والحصص آلياً
                      </div>
                      <p className="text-xs text-slate-400 max-w-2xl">
                        يقوم المحرك باختبار استجابة وسرعة (TPS) ودقة استدلال نماذج كافة المزودين وقراءة حدود الحصص، 
                        ثم ينتخب المقاعد القيادية للمجلس تلقائياً وفق الأداء التجريبي الحي.
                      </p>
                    </div>
                    <button
                      onClick={runAutoBenchmarkAndElect}
                      disabled={benchmarkRunning}
                      className={`px-5 py-2.5 rounded-xl text-xs font-semibold font-mono flex items-center gap-2 transition shrink-0 ${
                        benchmarkRunning
                          ? "bg-amber-600/40 text-amber-300 border border-amber-500/50 cursor-wait animate-pulse"
                          : "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white border border-cyan-400/50 shadow-[0_0_20px_rgba(34,211,238,0.3)] cursor-pointer"
                      }`}
                    >
                      <span>{benchmarkRunning ? "⏳" : "🔍"}</span>
                      <span>{benchmarkRunning ? "جاري الفحص المباشر..." : "فحص وتقييم النماذج آلياً"}</span>
                    </button>
                  </div>

                  {/* Live Benchmark Leaderboard Table */}
                  {benchmarkLeaderboard.length > 0 && (
                    <div className="bg-slate-900/80 border border-slate-700/60 rounded-2xl p-5 space-y-3 shadow-xl">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-cyan-300 uppercase tracking-widest flex items-center gap-2 font-mono">
                          <span>📊</span> لوحة متصدرين النماذج والحصص (Live Benchmark Leaderboard)
                        </h3>
                        <span className="text-[11px] font-mono text-slate-400">
                          {benchmarkLeaderboard.length} نماذج تم فحصها
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-right text-xs text-slate-300">
                          <thead className="text-[11px] font-mono text-slate-400 bg-slate-950/60 border-b border-slate-800">
                            <tr>
                              <th className="py-2.5 px-3">المزود</th>
                              <th className="py-2.5 px-3">النموذج</th>
                              <th className="py-2.5 px-3">الحالة</th>
                              <th className="py-2.5 px-3 text-center">الاستجابة</th>
                              <th className="py-2.5 px-3 text-center">السرعة</th>
                              <th className="py-2.5 px-3 text-center">دقة الاستدلال</th>
                              <th className="py-2.5 px-3">الحصة المتبقية</th>
                              <th className="py-2.5 px-3">المقعد المنتخب</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {benchmarkLeaderboard.map((row, idx) => (
                              <tr key={idx} className="hover:bg-slate-800/40 transition">
                                <td className="py-2.5 px-3 font-semibold text-slate-200 uppercase font-mono text-[11px]">{row.provider}</td>
                                <td className="py-2.5 px-3 font-mono text-cyan-300">{row.model}</td>
                                <td className="py-2.5 px-3">
                                  {row.status === "operational" && <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">🟢 يعمل</span>}
                                  {row.status === "rate_limited" && <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30">🟡 حد الحصة</span>}
                                  {row.status === "rejected" && <span className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/20 text-rose-400 border border-rose-500/30">🔴 مرفوض</span>}
                                  {row.status === "unreachable" && <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-700 text-slate-400">⚪ مهلة</span>}
                                  {row.status === "error" && <span className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/20 text-rose-300">خطأ</span>}
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono">
                                  {row.status === "operational" ? (
                                    <span className={row.latency_ms < 1000 ? "text-emerald-400 font-bold" : row.latency_ms < 2000 ? "text-cyan-300" : "text-amber-400"}>
                                      {row.latency_ms} ms
                                    </span>
                                  ) : "—"}
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono">
                                  {row.status === "operational" ? (
                                    <span className={row.tps > 80 ? "text-emerald-400 font-bold" : "text-slate-300"}>
                                      {row.tps} t/s
                                    </span>
                                  ) : "—"}
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono">
                                  {row.status === "operational" ? (
                                    <span className={row.reasoning_score === 1.0 ? "text-emerald-400" : "text-amber-400"}>
                                      {row.reasoning_score === 1.0 ? "✓ 100%" : `${Math.round(row.reasoning_score * 100)}%`}
                                    </span>
                                  ) : "—"}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                                  {row.quota_remaining_requests}
                                </td>
                                <td className="py-2.5 px-3">
                                  {row.seat_role ? (
                                    <span className="px-2 py-0.5 rounded-lg text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-medium flex items-center gap-1 w-max">
                                      <span>{row.seat_icon || "🎖️"}</span>
                                      <span>{row.seat_role}</span>
                                    </span>
                                  ) : (
                                    <span className="text-slate-600">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Active Council Roster */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                        تشكيلة أعضاء المجلس (Council Roster)
                      </h3>
                      {dynamicRoster.length > 0 && (
                        <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          تشكيلة منتخبة ومحدثة ديناميكياً
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {(dynamicRoster.length > 0
                        ? dynamicRoster
                        : [
                            { id: "gemini", name: "Google Gemini", provider: "gemini", model: "gemini-2.0-flash", icon: "🌐", role: "المستشار التحليلي والمعلوماتي الشامل", specialty: "سياق المليون توكن وسرعة البحث واسترجاع الحقائق", active: false },
                            { id: "groq", name: "Llama 3.3 (Groq Cloud)", provider: "groq", model: "llama-3.3-70b-versatile", icon: "🦙", role: "مستشار المنطق الحر والاستدلال المفتوح", specialty: "سرعة استدلال 500 t/s وتفكير منطقي صارم", active: false },
                            { id: "deepseek", name: "DeepSeek V3 / R1", provider: "deepseek", model: "deepseek-chat", icon: "🐋", role: "كبير مهندسي البرمجيات والرياضيات", specialty: "استدلال عميق وخوارزميات برمجية خارقة", active: false },
                            { id: "openrouter", name: "OpenRouter Meta-Council", provider: "openrouter", model: "anthropic/claude-3.5-sonnet", icon: "⚡", role: "المستشار التنسيقي للنماذج العالمية", specialty: "بوابة عبور لمئات النماذج العالمية دفعة واحدة", active: false },
                            { id: "anthropic", name: "Claude 3.5 Sonnet", provider: "anthropic", model: "claude-3-5-sonnet", icon: "🧠", role: "المدقق المعماري الصارم وخبير الأمان", specialty: "الدقة الهندسية الشديدة وخلو الهلوسات البرمجية", active: false },
                            { id: "openai", name: "OpenAI GPT-4o", provider: "openai", model: "gpt-4o", icon: "✨", role: "المستشار التوجيهي والتكاملي", specialty: "الربط متعدد الوسائط والتنسيق اللغوي المتين", active: false },
                          ]
                      ).map((member) => {
                        const hasKey = dynamicRoster.length > 0 ? true : ((keyPools[member.id] || []).length > 0 || apiKeyStatus[member.id]);
                        return (
                          <div key={member.id} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 flex flex-col justify-between gap-3 hover:border-cyan-500/30 transition">
                            <div className="flex items-start gap-3">
                              <span className="text-2xl">{member.icon}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <div className="font-semibold text-slate-100 text-sm truncate">{member.name}</div>
                                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full shrink-0 ${hasKey ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-slate-700 text-slate-400"}`}>
                                    {hasKey ? "🟢 جاهز" : "⚪ يحتاج مفتاح"}
                                  </span>
                                </div>
                                <div className="text-[11px] text-cyan-400/80 font-medium mt-0.5">{member.role}</div>
                                <div className="text-xs text-slate-400 mt-1">{member.specialty}</div>
                              </div>
                            </div>
                            <button
                              onClick={() => openProviderConfig(member.provider || member.id)}
                              className={`w-full py-1.5 rounded-lg text-xs font-semibold transition ${
                                hasKey ? "bg-slate-700 hover:bg-slate-600 text-slate-200" : "bg-cyan-700 hover:bg-cyan-600 text-white"
                              }`}
                            >
                              {hasKey ? "تعديل المفاتيح والمزود" : "إضافة مفتاح وتفعيل"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Interactive Council Deliberation Arena */}
                  <div className="bg-slate-900/80 border border-cyan-500/30 rounded-2xl p-5 space-y-4 shadow-xl">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>⚡</span> تجربة مداولة وانعقاد المجلس المباشرة
                    </h3>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={councilTopic}
                        onChange={(e) => setCouncilTopic(e.target.value)}
                        placeholder="اطرح معضلة برمجية أو معمارية ليتداول فيها المجلس بالتوازي..."
                        className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-400 transition"
                      />
                      <button
                        onClick={async () => {
                          if (!councilTopic.trim() || councilRunning) return;
                          setCouncilRunning(true);
                          setCouncilResult(null);
                          try {
                            const resp = await authFetch("/api/council", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ topic: councilTopic }),
                            });
                            const data = await resp.json();
                            if (data.ok) {
                              setCouncilResult(data);
                            } else {
                              alert(`فشل انعقاد المجلس: ${data.error || "خطأ"}`);
                            }
                          } catch (e: any) {
                            alert(`خطأ في الاتصال: ${e.message}`);
                          } finally {
                            setCouncilRunning(false);
                          }
                        }}
                        disabled={!councilTopic.trim() || councilRunning}
                        className={`px-5 py-2.5 rounded-xl text-xs font-semibold font-mono flex items-center gap-2 transition ${
                          councilTopic.trim() && !councilRunning
                            ? "bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_15px_rgba(34,211,238,0.4)] cursor-pointer"
                            : "bg-slate-800 text-slate-500 cursor-not-allowed"
                        }`}
                      >
                        {councilRunning ? "⏳ جاري التداول..." : "🏛️ انعقاد المجلس"}
                      </button>
                    </div>

                    {/* Result Card */}
                    {councilResult && (
                      <div className="mt-4 space-y-4 pt-4 border-t border-slate-800 animate-fadeIn">
                        {/* Header */}
                        <div className="flex items-center justify-between text-xs font-mono">
                          <span className="text-slate-400">الموضوع: {councilResult.topic}</span>
                          <span className={`flex items-center gap-1.5 font-bold ${
                            councilResult.agreement_score >= 0.75 ? "text-emerald-400"
                            : councilResult.agreement_score >= 0.5 ? "text-amber-400"
                            : "text-red-400"
                          }`}>
                            <span>نسبة الإجماع:</span>
                            <span className="text-lg">{Math.round((councilResult.agreement_score ?? 0) * 100)}%</span>
                            {councilResult.agreement_score >= 0.75 ? "✅" : councilResult.agreement_score >= 0.5 ? "⚠️" : "❌"}
                          </span>
                        </div>

                        {/* Stage 1: Individual proposals */}
                        <div>
                          <div className="text-[11px] font-mono text-slate-500 mb-2 uppercase tracking-wider">المرحلة 1 — مقترحات الأعضاء</div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {councilResult.proposals.map((p, idx) => (
                              <div key={idx} className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 space-y-2">
                                <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
                                  <span>{p.icon}</span>
                                  <span>{p.member_name}</span>
                                  <span className="text-[10px] text-slate-500 font-mono">({p.model})</span>
                                </div>
                                <div className="text-xs text-slate-300 max-h-48 overflow-y-auto leading-relaxed whitespace-pre-wrap font-sans">
                                  {p.content}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Stage 2: Peer critiques */}
                        {councilResult.peer_critiques && councilResult.peer_critiques.length > 0 && (
                          <div>
                            <div className="text-[11px] font-mono text-slate-500 mb-2 uppercase tracking-wider">المرحلة 2 — مراجعة الأقران (Peer Review)</div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {councilResult.peer_critiques.map((c, idx) => (
                                <div key={idx} className="bg-purple-950/30 border border-purple-700/40 rounded-xl p-3.5 space-y-2">
                                  <div className="flex items-center gap-2 text-xs font-bold text-purple-300">
                                    <span>{c.icon}</span>
                                    <span>{c.member_name}</span>
                                    <span className="text-[10px] text-slate-500 font-mono">({c.model})</span>
                                  </div>
                                  <div className="text-xs text-slate-300 max-h-36 overflow-y-auto leading-relaxed whitespace-pre-wrap font-sans">
                                    {c.critique}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Stage 3: Final Consensus */}
                        <div className="bg-gradient-to-r from-cyan-950/40 via-slate-900/90 to-emerald-950/40 border border-cyan-400/50 rounded-xl p-4 space-y-2 shadow-lg">
                          <div className="text-xs font-bold text-emerald-400 flex items-center gap-2 font-mono">
                            <span>⚖️</span> قرار وإجماع المجلس النهائي (Consensus Resolution)
                          </div>
                          <div className="text-xs text-slate-100 leading-relaxed whitespace-pre-wrap font-sans">
                            {councilResult.consensus}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ─ Swarm sub-tab ─ */}
              {aiSubTab === "swarm" && (
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <span>🐝</span> سرب الوكلاء المستقلين (Autonomous Multi-Agent Swarm)
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      تشغيل عدة وكلاء متخصصين في الخلفية بالتوازي بحلقات تفكير وأدوات معزولة بالكامل.
                    </p>
                  </div>

                  {/* Archetypes grid */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-3.5 space-y-1">
                      <div className="text-xs font-bold text-cyan-400 flex items-center gap-1.5 font-mono">
                        <span>🔍</span> Researcher
                      </div>
                      <p className="text-[11px] text-slate-300">بحث الويب والتوثيق</p>
                      <div className="text-[10px] text-slate-500 font-mono">Gemini / Groq</div>
                    </div>
                    <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-3.5 space-y-1">
                      <div className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 font-mono">
                        <span>💻</span> Coder
                      </div>
                      <p className="text-[11px] text-slate-300">كتابة وفحص الكود</p>
                      <div className="text-[10px] text-slate-500 font-mono">Codestral / DeepSeek</div>
                    </div>
                    <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-3.5 space-y-1">
                      <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5 font-mono">
                        <span>⚙️</span> Executor
                      </div>
                      <p className="text-[11px] text-slate-300">تنفيذ أوامر النظام والملفات</p>
                      <div className="text-[10px] text-slate-500 font-mono">Qwen / Llama</div>
                    </div>
                    <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-3.5 space-y-1">
                      <div className="text-xs font-bold text-purple-400 flex items-center gap-1.5 font-mono">
                        <span>🛡️</span> Critic / Security
                      </div>
                      <p className="text-[11px] text-slate-300">التدقيق الصارم وكشف الأخطاء</p>
                      <div className="text-[10px] text-slate-500 font-mono">GPT-OSS / Safeguard</div>
                    </div>
                  </div>

                  {/* Swarm Tasks List & Run */}
                  <div className="bg-slate-900/40 border border-slate-700/40 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-semibold text-slate-300">مهام السرب المتوازية:</span>
                      <button
                        onClick={() => setSwarmTasks([...swarmTasks, { role: "researcher", goal: "" }])}
                        className="text-[11px] px-2 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-slate-700 transition cursor-pointer"
                      >
                        + إضافة وكيل
                      </button>
                    </div>

                    {swarmTasks.map((t, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <select
                          value={t.role}
                          onChange={(e) => {
                            const updated = [...swarmTasks];
                            updated[idx].role = e.target.value;
                            setSwarmTasks(updated);
                          }}
                          className="px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs font-mono text-cyan-300"
                        >
                          <option value="researcher">🔍 Researcher</option>
                          <option value="coder">💻 Coder</option>
                          <option value="executor">⚙️ Executor</option>
                          <option value="critic">🛡️ Critic</option>
                        </select>
                        <input
                          type="text"
                          value={t.goal}
                          onChange={(e) => {
                            const updated = [...swarmTasks];
                            updated[idx].goal = e.target.value;
                            setSwarmTasks(updated);
                          }}
                          placeholder="مهمة الوكيل المحددة..."
                          className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
                        />
                        {swarmTasks.length > 1 && (
                          <button
                            onClick={() => setSwarmTasks(swarmTasks.filter((_, i) => i !== idx))}
                            className="text-slate-500 hover:text-red-400 text-xs px-2 cursor-pointer"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}

                    <div className="pt-2 flex justify-end">
                      <button
                        disabled={swarmRunning || swarmTasks.some(t => !t.goal.trim())}
                        onClick={async () => {
                          setSwarmRunning(true);
                          setSwarmResults([]);
                          try {
                            const res = await authFetch("/api/swarm/run", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ tasks: swarmTasks }),
                            });
                            const data = await res.json();
                            if (data.ok) {
                              setSwarmResults(data.results);
                            } else {
                              alert(`فشل إطلاق السرب: ${data.error || "خطأ"}`);
                            }
                          } catch (e: any) {
                            alert(`خطأ في الاتصال: ${e.message}`);
                          } finally {
                            setSwarmRunning(false);
                          }
                        }}
                        className={`px-5 py-2.5 rounded-xl text-xs font-semibold font-mono flex items-center gap-2 transition ${
                          !swarmRunning && swarmTasks.every(t => t.goal.trim())
                            ? "bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white shadow-lg cursor-pointer"
                            : "bg-slate-800 text-slate-500 cursor-not-allowed"
                        }`}
                      >
                        {swarmRunning ? "⏳ السرب قيد التنفيذ المتوازي..." : "🚀 إطلاق السرب بالتوازي (Launch Swarm)"}
                      </button>
                    </div>
                  </div>

                  {/* Swarm Execution Results */}
                  {swarmResults.length > 0 && (
                    <div className="space-y-4 pt-4 border-t border-slate-800 animate-fadeIn">
                      <div className="text-xs font-mono text-emerald-400 font-semibold flex items-center gap-2">
                        <span>✓</span> تم إنجاز كافة مهام السرب ({swarmResults.length} وكلاء):
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {swarmResults.map((r, idx) => (
                          <div key={idx} className="bg-slate-900/80 border border-slate-700/80 rounded-xl p-4 space-y-2">
                            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                              <span className="text-xs font-bold text-cyan-300 font-mono">[{r.role.toUpperCase()}]</span>
                              <span className="text-[10px] text-slate-400 font-mono">{r.duration_seconds?.toFixed(1)}s • {r.steps_count} خطوات</span>
                            </div>
                            <div className="text-xs text-slate-400 font-mono">المهمة: {r.goal}</div>
                            <div className="text-xs text-slate-200 leading-relaxed max-h-56 overflow-y-auto whitespace-pre-wrap font-sans bg-slate-950/40 p-2.5 rounded-lg border border-slate-800">
                              {r.summary}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          );
        })()}

        {/* ══ MCP Ecosystem ════════════════════════════════════════════════ */}
        {activeTab === "mcp" && (
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
        )}

        {/* ══ Integrations ═════════════════════════════════════════════════ */}
        {activeTab === "integrations" && (
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-700/50 pb-5">
              <div>
                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                  <span>🌐</span> {t("integrations_title")}
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  {t("integrations_desc")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono px-3 py-1.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  {t("integrations_sync")}
                </span>
                <button
                  onClick={handleTestAllIntegrations}
                  disabled={integrationTesting.all?.loading}
                  className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 flex items-center gap-1.5 transition"
                  title="Test every integration in turn (FG-016)"
                >
                  {integrationTesting.all?.loading ? "⏳ Testing All" : "🔬 Test All"}
                </button>
              </div>
            </div>

            {/* Account Authorization Banner (Gmail & Google Account) */}
            <div className="bg-gradient-to-r from-cyan-950/40 via-slate-900/90 to-blue-950/40 border border-cyan-500/30 rounded-2xl p-5 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-2xl shrink-0 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
                  📬
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-base">{t("integrations_google_title")}</h3>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      LOCKED PROFILE
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    {t("integrations_google_desc")} (<code className="text-cyan-300 font-mono font-semibold">{integrations.email?.username || "your@gmail.com"}</code>).
                  </p>
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <span className="text-xs font-mono px-3 py-1.5 rounded-xl bg-slate-800 text-slate-200 border border-slate-700">
                  Profile: Default
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Email SMTP */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white flex items-center gap-2">
                      <span>📧</span> Email (SMTP / Gmail)
                    </h3>
                    <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      {integrations.email?.has_credentials ? "App Password Configured in .env" : integrations.email?.username ? `Linked: ${integrations.email.username}` : "Not configured"}
                    </span>
                  </div>
                  <Toggle
                    label=""
                    value={integrations.email?.enabled ?? true}
                    onChange={(v) => { setIntegrations((p) => ({ ...p, email: { ...p.email, enabled: v } })); setDirty(true); }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">SMTP Host</label>
                    <input type="text" value={integrations.email?.smtp_host || "smtp.gmail.com"}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, email: { ...p.email, smtp_host: e.target.value } })); setDirty(true); }}
                      placeholder="smtp.gmail.com" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Port</label>
                    <input type="number" value={integrations.email?.smtp_port || 587}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, email: { ...p.email, smtp_port: parseInt(e.target.value) || 587 } })); setDirty(true); }}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs text-slate-400">Username (Google Account)</label>
                    <input type="text" value={integrations.email?.username || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, email: { ...p.email, username: e.target.value } })); setDirty(true); }}
                      placeholder="your@gmail.com" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-slate-400">Google App Password (16-character key)</label>
                      {integrations.email?.has_credentials && (
                        <span className="text-[10px] text-emerald-400 font-mono">✓ Saved in .env</span>
                      )}
                    </div>
                    <input type="password" value={integrations.email?.password || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, email: { ...p.email, password: e.target.value } })); setDirty(true); }}
                      placeholder={integrations.email?.has_credentials ? "•••••••• (محفوظ في .env — ادخل كلمة مرور جديدة للاستبدال)" : "xxxx xxxx xxxx xxxx (App Password)"}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
                  <div className="text-xs">
                    {integrationTesting.email?.success ? (
                      <span className="text-emerald-400 font-mono text-[11px] flex items-center gap-1">
                        <span>✓</span> {integrationTesting.email.msg} (<bdi>{integrationTesting.email.latency}ms</bdi>)
                      </span>
                    ) : integrationTesting.email?.msg ? (
                      <span className="text-rose-400 font-mono text-[11px] flex items-center gap-1">
                        <span>✕</span> {integrationTesting.email.msg}
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[11px] font-mono">SMTP Handshake Ready</span>
                    )}
                    <span className="text-[10px] text-slate-400 font-mono ml-2">
                      Rate limit: 500/day
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        setSelectedPlatformModal({
                          id: "email",
                          name: "Email (SMTP / Gmail)",
                          icon: "📧",
                          integrationConfig: integrations.email,
                        })
                      }
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
                      title="Inspect Platform"
                    >
                      📊 {t("inspect_platform")}
                    </button>
                    <button
                      onClick={() => handleTestIntegration("email")}
                      disabled={integrationTesting.email?.loading}
                      className="px-3 py-1.5 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-800/40 text-cyan-300 rounded-lg text-xs font-mono transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                      {integrationTesting.email?.loading ? (
                        <span className="animate-pulse">{t("testing")}</span>
                      ) : (
                        <span>🔬 {t("test_connection")}</span>
                      )}
                    </button>
                  </div>
                </div>
                {renderTestHistory("email")}
              </div>

              {/* Telegram Bot */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white flex items-center gap-2">
                      <span>✈️</span> Telegram Bot
                    </h3>
                    <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      {integrations.telegram?.has_token ? "Bot Token & Chat ID Active in .env" : "Telegram Bot"}
                    </span>
                  </div>
                  <Toggle
                    label=""
                    value={integrations.telegram?.enabled ?? true}
                    onChange={(v) => { setIntegrations((p) => ({ ...p, telegram: { ...p.telegram, enabled: v } })); setDirty(true); }}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-slate-400">Bot Token</label>
                      {integrations.telegram?.has_token && (
                        <span className="text-[10px] text-emerald-400 font-mono">✓ Key Active in .env</span>
                      )}
                    </div>
                    <input type="password" value={integrations.telegram?.bot_token || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, telegram: { ...p.telegram, bot_token: e.target.value } })); setDirty(true); }}
                      placeholder={integrations.telegram?.has_token ? "•••••••• (Token محفوظ في .env — ادخل رمز جديد للتعديل)" : "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Default Chat ID</label>
                    <input type="text" value={integrations.telegram?.chat_id || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, telegram: { ...p.telegram, chat_id: e.target.value } })); setDirty(true); }}
                      placeholder="123456789" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
                  <div className="text-xs">
                    {integrationTesting.telegram?.success ? (
                      <span className="text-emerald-400 font-mono text-[11px] flex items-center gap-1">
                        <span>✓</span> {integrationTesting.telegram.msg} (<bdi>{integrationTesting.telegram.latency}ms</bdi>)
                      </span>
                    ) : integrationTesting.telegram?.msg ? (
                      <span className="text-rose-400 font-mono text-[11px] flex items-center gap-1">
                        <span>✕</span> {integrationTesting.telegram.msg}
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[11px] font-mono">Telegram API Ready</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        setSelectedPlatformModal({
                          id: "telegram",
                          name: "Telegram Bot",
                          icon: "✈️",
                          integrationConfig: integrations.telegram,
                        })
                      }
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
                      title="Inspect Platform"
                    >
                      📊 {t("inspect_platform")}
                    </button>
                    <button
                      onClick={() => handleTestIntegration("telegram")}
                      disabled={integrationTesting.telegram?.loading}
                      className="px-3 py-1.5 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-800/40 text-cyan-300 rounded-lg text-xs font-mono transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                      {integrationTesting.telegram?.loading ? (
                        <span className="animate-pulse">{t("testing")}</span>
                      ) : (
                        <span>🔬 {t("test_connection")}</span>
                      )}
                    </button>
                  </div>
                </div>
                {renderTestHistory("telegram")}
              </div>

              {/* Calendar */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white flex items-center gap-2"><span>📅</span> Calendar (iCal Google Sync)</h3>
                    <span className="text-[10px] font-mono text-cyan-400 flex items-center gap-1 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                      Google Calendar Linked
                    </span>
                  </div>
                  <Toggle
                    label=""
                    value={integrations.calendar?.enabled ?? false}
                    onChange={(v) => { setIntegrations((p) => ({ ...p, calendar: { ...p.calendar, enabled: v } })); setDirty(true); }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">ICS URL (Google Calendar / Outlook)</label>
                  <input type="text" value={integrations.calendar?.ical_url || ""}
                    onChange={(e) => { setIntegrations((p) => ({ ...p, calendar: { ...p.calendar, ical_url: e.target.value } })); setDirty(true); }}
                    placeholder="https://calendar.google.com/calendar/ical/your-email/public/basic.ics"
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                </div>

                <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
                  <div className="text-xs">
                    {integrationTesting.calendar?.success ? (
                      <span className="text-emerald-400 font-mono text-[11px] flex items-center gap-1">
                        <span>✓</span> {integrationTesting.calendar.msg} (<bdi>{integrationTesting.calendar.latency}ms</bdi>)
                      </span>
                    ) : integrationTesting.calendar?.msg ? (
                      <span className="text-rose-400 font-mono text-[11px] flex items-center gap-1">
                        <span>✕</span> {integrationTesting.calendar.msg}
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[11px] font-mono">iCal Stream Ready</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        setSelectedPlatformModal({
                          id: "calendar",
                          name: "Google Calendar (iCal)",
                          icon: "📅",
                          integrationConfig: integrations.calendar,
                        })
                      }
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
                      title="Inspect Platform"
                    >
                      📊 {t("inspect_platform")}
                    </button>
                    <button
                      onClick={() => handleTestIntegration("calendar")}
                      disabled={integrationTesting.calendar?.loading}
                      className="px-3 py-1.5 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-800/40 text-cyan-300 rounded-lg text-xs font-mono transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                      {integrationTesting.calendar?.loading ? (
                        <span className="animate-pulse">{t("testing")}</span>
                      ) : (
                        <span>🔬 {t("test_connection")}</span>
                      )}
                    </button>
                  </div>
                </div>
                {renderTestHistory("calendar")}
              </div>

              {/* Home Assistant */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white flex items-center gap-2"><span>🏠</span> Home Assistant</h3>
                    <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1 mt-0.5">
                      {integrations.home_assistant?.has_token ? "🟢 Connected (.env)" : "⚪ Ready for Local Token"}
                    </span>
                  </div>
                  <Toggle
                    label=""
                    value={integrations.home_assistant?.enabled ?? false}
                    onChange={(v) => { setIntegrations((p) => ({ ...p, home_assistant: { ...p.home_assistant, enabled: v } })); setDirty(true); }}
                  />
                </div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">URL</label>
                    <input type="text" value={integrations.home_assistant?.url || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, home_assistant: { ...p.home_assistant, url: e.target.value } })); setDirty(true); }}
                      placeholder="http://homeassistant.local:8123"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-slate-400">Long-Lived Access Token</label>
                      {integrations.home_assistant?.has_token && (
                        <span className="text-[10px] text-emerald-400 font-mono">✓ Token Saved in .env</span>
                      )}
                    </div>
                    <input type="password" value={integrations.home_assistant?.token || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, home_assistant: { ...p.home_assistant, token: e.target.value } })); setDirty(true); }}
                      placeholder={integrations.home_assistant?.has_token ? "•••••••• (Token محفوظ في .env)" : "Bearer token"}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
                  <div className="text-xs">
                    {integrationTesting.home_assistant?.success ? (
                      <span className="text-emerald-400 font-mono text-[11px] flex items-center gap-1">
                        <span>✓</span> {integrationTesting.home_assistant.msg} (<bdi>{integrationTesting.home_assistant.latency}ms</bdi>)
                      </span>
                    ) : integrationTesting.home_assistant?.msg ? (
                      <span className="text-rose-400 font-mono text-[11px] flex items-center gap-1">
                        <span>✕</span> {integrationTesting.home_assistant.msg}
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[11px] font-mono">REST API Ready</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        setSelectedPlatformModal({
                          id: "home_assistant",
                          name: "Home Assistant",
                          icon: "🏠",
                          integrationConfig: integrations.home_assistant,
                        })
                      }
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
                      title="Inspect Platform"
                    >
                      📊 {t("inspect_platform")}
                    </button>
                    <button
                      onClick={() => handleTestIntegration("home_assistant")}
                      disabled={integrationTesting.home_assistant?.loading}
                      className="px-3 py-1.5 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-800/40 text-cyan-300 rounded-lg text-xs font-mono transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                      {integrationTesting.home_assistant?.loading ? (
                        <span className="animate-pulse">{t("testing")}</span>
                      ) : (
                        <span>🔬 {t("test_connection")}</span>
                      )}
                    </button>
                  </div>
                </div>
                {renderTestHistory("home_assistant")}
              </div>

              {/* YouTube Channel */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white flex items-center gap-2"><span>▶️</span> YouTube Channel (OAuth & API)</h3>
                    <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1 mt-0.5">
                      {integrations.youtube?.has_token || integrations.youtube?.channel_id ? "🟢 Configured" : "⚪ YouTube Creator Tools"}
                    </span>
                  </div>
                  <Toggle
                    label=""
                    value={integrations.youtube?.enabled ?? false}
                    onChange={(v) => { setIntegrations((p) => ({ ...p, youtube: { ...(p.youtube || { client_id: "", client_secret: "", refresh_token: "", channel_id: "", enabled: false }), enabled: v } })); setDirty(true); }}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Channel ID</label>
                    <input type="text" value={integrations.youtube?.channel_id || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, youtube: { ...(p.youtube || { client_id: "", client_secret: "", refresh_token: "", channel_id: "", enabled: false }), channel_id: e.target.value } })); setDirty(true); }}
                      placeholder="UCxxxxxxxxxxxx" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Client ID</label>
                    <input type="text" value={integrations.youtube?.client_id || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, youtube: { ...(p.youtube || { client_id: "", client_secret: "", refresh_token: "", channel_id: "", enabled: false }), client_id: e.target.value } })); setDirty(true); }}
                      placeholder="apps.googleusercontent.com" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Client Secret</label>
                    <input type="password" value={integrations.youtube?.client_secret || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, youtube: { ...(p.youtube || { client_id: "", client_secret: "", refresh_token: "", channel_id: "", enabled: false }), client_secret: e.target.value } })); setDirty(true); }}
                      placeholder={integrations.youtube?.has_secret ? "•••••••• (محفوظ في .env)" : "GOCSPX-..."}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Refresh Token</label>
                    <input type="password" value={integrations.youtube?.refresh_token || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, youtube: { ...(p.youtube || { client_id: "", client_secret: "", refresh_token: "", channel_id: "", enabled: false }), refresh_token: e.target.value } })); setDirty(true); }}
                      placeholder={integrations.youtube?.has_token ? "•••••••• (محفوظ في .env)" : "1//04..."}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
                  <span className="text-slate-500 text-[11px] font-mono">YouTube Data API Ready</span>
                  <button
                    onClick={() =>
                      setSelectedPlatformModal({
                        id: "youtube",
                        name: "YouTube Channel",
                        icon: "▶️",
                        integrationConfig: integrations.youtube,
                      })
                    }
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
                    title="Inspect Platform"
                  >
                    📊 {t("inspect_platform")}
                  </button>
                </div>
              </div>

              {/* Facebook Page */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white flex items-center gap-2"><span>📘</span> Facebook Page</h3>
                    <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1 mt-0.5">
                      {integrations.facebook?.has_token ? "🟢 Token Configured in .env" : "⚪ Standby"}
                    </span>
                  </div>
                  <Toggle
                    label=""
                    value={integrations.facebook?.enabled ?? false}
                    onChange={(v) => { setIntegrations((p) => ({ ...p, facebook: { ...(p.facebook || { page_id: "", page_access_token: "", enabled: false }), enabled: v } })); setDirty(true); }}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Page ID</label>
                    <input type="text" value={integrations.facebook?.page_id || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, facebook: { ...(p.facebook || { page_id: "", page_access_token: "", enabled: false }), page_id: e.target.value } })); setDirty(true); }}
                      placeholder="1029384756..." className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Page Access Token</label>
                    <input type="password" value={integrations.facebook?.page_access_token || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, facebook: { ...(p.facebook || { page_id: "", page_access_token: "", enabled: false }), page_access_token: e.target.value } })); setDirty(true); }}
                      placeholder={integrations.facebook?.has_token ? "•••••••• (محفوظ في .env)" : "EAABsbCS1iHg..."}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
                  <span className="text-slate-500 text-[11px] font-mono">Meta Graph API Ready</span>
                  <button
                    onClick={() =>
                      setSelectedPlatformModal({
                        id: "facebook",
                        name: "Facebook Page",
                        icon: "📘",
                        integrationConfig: integrations.facebook,
                      })
                    }
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
                    title="Inspect Platform"
                  >
                    📊 {t("inspect_platform")}
                  </button>
                </div>
              </div>

              {/* Instagram Business / Creator */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white flex items-center gap-2"><span>📸</span> Instagram Business / Creator</h3>
                    <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1 mt-0.5">
                      {integrations.instagram?.has_token ? "🟢 Connected (.env)" : "⚪ Ready for Graph Token"}
                    </span>
                  </div>
                  <Toggle
                    label=""
                    value={integrations.instagram?.enabled ?? false}
                    onChange={(v) => { setIntegrations((p) => ({ ...p, instagram: { ...(p.instagram || { user_id: "", access_token: "", enabled: false }), enabled: v } })); setDirty(true); }}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Instagram User ID (Business Account ID)</label>
                    <input type="text" value={integrations.instagram?.user_id || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, instagram: { ...(p.instagram || { user_id: "", access_token: "", enabled: false }), user_id: e.target.value } })); setDirty(true); }}
                      placeholder="17841400000000000" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Instagram Graph Access Token</label>
                    <input type="password" value={integrations.instagram?.access_token || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, instagram: { ...(p.instagram || { user_id: "", access_token: "", enabled: false }), access_token: e.target.value } })); setDirty(true); }}
                      placeholder={integrations.instagram?.has_token ? "•••••••• (محفوظ في .env)" : "EAA..."}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
                  <span className="text-slate-500 text-[11px] font-mono">Instagram Graph API</span>
                  <button
                    onClick={() =>
                      setSelectedPlatformModal({
                        id: "instagram",
                        name: "Instagram Business",
                        icon: "📸",
                        integrationConfig: integrations.instagram,
                      })
                    }
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
                    title="Inspect Platform"
                  >
                    📊 {t("inspect_platform")}
                  </button>
                </div>
              </div>

              {/* TikTok Creator */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white flex items-center gap-2"><span>🎵</span> TikTok Creator</h3>
                    <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1 mt-0.5">
                      {integrations.tiktok?.has_token ? "🟢 Connected (.env)" : "⚪ Ready for Open ID"}
                    </span>
                  </div>
                  <Toggle
                    label=""
                    value={integrations.tiktok?.enabled ?? false}
                    onChange={(v) => { setIntegrations((p) => ({ ...p, tiktok: { ...(p.tiktok || { client_key: "", client_secret: "", access_token: "", open_id: "", enabled: false }), enabled: v } })); setDirty(true); }}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Client Key</label>
                    <input type="text" value={integrations.tiktok?.client_key || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, tiktok: { ...(p.tiktok || { client_key: "", client_secret: "", access_token: "", open_id: "", enabled: false }), client_key: e.target.value } })); setDirty(true); }}
                      placeholder="aw..." className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Open ID</label>
                    <input type="text" value={integrations.tiktok?.open_id || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, tiktok: { ...(p.tiktok || { client_key: "", client_secret: "", access_token: "", open_id: "", enabled: false }), open_id: e.target.value } })); setDirty(true); }}
                      placeholder="user open_id" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Client Secret</label>
                    <input type="password" value={integrations.tiktok?.client_secret || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, tiktok: { ...(p.tiktok || { client_key: "", client_secret: "", access_token: "", open_id: "", enabled: false }), client_secret: e.target.value } })); setDirty(true); }}
                      placeholder={integrations.tiktok?.has_secret ? "•••••••• (محفوظ في .env)" : "client secret"}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Access Token</label>
                    <input type="password" value={integrations.tiktok?.access_token || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, tiktok: { ...(p.tiktok || { client_key: "", client_secret: "", access_token: "", open_id: "", enabled: false }), access_token: e.target.value } })); setDirty(true); }}
                      placeholder={integrations.tiktok?.has_token ? "•••••••• (محفوظ في .env)" : "act.xxxx..."}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
                  <span className="text-slate-500 text-[11px] font-mono">TikTok Content API</span>
                  <button
                    onClick={() =>
                      setSelectedPlatformModal({
                        id: "tiktok",
                        name: "TikTok Creator",
                        icon: "🎵",
                        integrationConfig: integrations.tiktok,
                      })
                    }
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
                    title="Inspect Platform"
                  >
                    📊 {t("inspect_platform")}
                  </button>
                </div>
              </div>
            </div>

            <button onClick={saveConfig}
              className="w-full px-4 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl transition font-semibold font-mono text-sm shadow-[0_0_20px_rgba(34,211,238,0.25)] flex items-center justify-center gap-2">
              <span>💾</span> Save Integrations & Sync with .env
            </button>
          </div>
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
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
                  <Toggle label={t("sys_speak_aloud")} value={voiceEnabled} onChange={setVoiceEnabled} />
                  <Toggle label={t("sys_wake_word")} value={wakeEnabled} onChange={setWakeEnabled} />
                  <Toggle label={t("sys_barge_in")} value={bargeIn} onChange={setBargeIn} />
                  <div className="border-t border-slate-700 pt-4 space-y-3">
                    <h3 className="text-sm font-semibold text-cyan-400">{t("sys_voice_language")}</h3>
                    <p className="text-xs text-slate-400 mb-2">{t("sys_voice_lang_description")}</p>
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => { setChatLanguage("en"); setDirty(true); }}
                        className={`w-full px-4 py-3 rounded-lg transition flex items-center justify-between ${
                          chatLanguage === "en"
                            ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30"
                            : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span>{chatLanguage === "en" ? "●" : "○"}</span>
                          <span>{t("sys_voice_lang_en")}</span>
                        </span>
                        <span className="text-xs opacity-70">{chatLanguage === "en" ? t("active") : t("disabled")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setChatLanguage("ar"); setDirty(true); }}
                        className={`w-full px-4 py-3 rounded-lg transition flex items-center justify-between ${
                          chatLanguage === "ar"
                            ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30"
                            : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span>{chatLanguage === "ar" ? "●" : "○"}</span>
                          <span>{t("sys_voice_lang_ar")}</span>
                        </span>
                        <span className="text-xs opacity-70">{chatLanguage === "ar" ? t("active") : t("disabled")}</span>
                      </button>
                    </div>
                  </div>
                  <div className="border-t border-slate-700 pt-4 space-y-3">
                    <h3 className="text-sm font-semibold text-cyan-400">TTS Provider</h3>
                    <select value={voiceProvider} onChange={(e) => { setVoiceProvider(e.target.value); setDirty(true); }}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white">
                      <option value="auto">Auto (best available)</option>
                      <option value="edge_tts">Edge-TTS (Online, Microsoft Ryan)</option>
                      <option value="piper">Piper (Local, JARVIS model)</option>
                      <option value="pyttsx3">System TTS (pyttsx3 / espeak)</option>
                      <option value="nvidia_riva">NVIDIA Riva (Cloud)</option>
                    </select>
                    <div className="space-y-2">
                      <label className="text-sm text-slate-300">Edge-TTS Voice</label>
                      <select value={edgeVoice} onChange={(e) => {
                        if (chatLanguage === "ar") setEdgeVoiceAr(e.target.value);
                        else setEdgeVoiceEn(e.target.value);
                        setDirty(true);
                      }}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white">
                        {chatLanguage === "ar" ? (
                          <>
                            <option value="ar-SA-HamedNeural">Hamed Neural (Saudi, male)</option>
                            <option value="ar-SA-ZariyahNeural">Zariyah Neural (Saudi, female)</option>
                            <option value="ar-EG-ShakirNeural">Shakir Neural (Egyptian, male)</option>
                            <option value="ar-EG-SalmaNeural">Salma Neural (Egyptian, female)</option>
                            <option value="ar-YE-SalehNeural">Saleh Neural (Yemeni, male)</option>
                          </>
                        ) : (
                          <>
                            <option value="en-GB-RyanNeural">Ryan Neural (British, recommended)</option>
                            <option value="en-GB-ThomasNeural">Thomas Neural (British)</option>
                            <option value="en-GB-SoniaNeural">Sonia Neural (British, female)</option>
                          </>
                        )}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm text-slate-300">TTS Speed ({edgeRate})</label>
                        <select value={edgeRate} onChange={(e) => { setEdgeRate(e.target.value); setDirty(true); }}
                          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white">
                          <option value="-20%">Slow (-20%)</option>
                          <option value="-10%">Slightly slow (-10%)</option>
                          <option value="-6%">Gravitas (-6%)</option>
                          <option value="+0%">Normal (0%)</option>
                          <option value="+10%">Fast (+10%)</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm text-slate-300">pyttsx3 Volume</label>
                        <input type="range" min="0" max="1" step="0.1" value={ttsVolume}
                          onChange={(e) => { setTtsVolume(parseFloat(e.target.value)); setDirty(true); }}
                          className="w-full" />
                      </div>
                    </div>
                  </div>

                  {/* STT Speech-to-Text Engine & Dedicated Model */}
                  <div className="border-t border-slate-700/80 pt-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-cyan-400 flex items-center gap-2">
                          <span>🎙️</span>
                          <bdi dir="auto">{lang === "ar" ? "محرك ونموذج تحويل الصوت إلى نص (STT)" : "Speech-to-Text (STT) Engine & Model"}</bdi>
                        </h3>
                        <p className="text-xs text-slate-400 mt-1">
                          <bdi dir="auto">
                            {lang === "ar"
                              ? "اختر محرك الاستماع المباشر (تفريغ فوري حي حرفاً بحرف أو خادم Whisper مخصص)"
                              : "Select real-time live streaming transcription or connect to a dedicated STT model"}
                          </bdi>
                        </p>
                      </div>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded border border-cyan-500/30 text-cyan-300 bg-cyan-950/40">
                        <bdi dir="auto">{sttEngine === "web_speech" ? "LIVE STREAMING ⚡" : sttEngine === "custom_stt" ? "CUSTOM DEDICATED 🎯" : "WHISPER BATCH ☁️"}</bdi>
                      </span>
                    </div>

                    {/* Engine selection tabs */}
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setSttEngine("web_speech")}
                        className={`p-3 rounded-lg border text-left transition-all ${
                          sttEngine === "web_speech"
                            ? "border-cyan-400/80 bg-cyan-500/10 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                            : "border-slate-800 bg-slate-900/60 hover:border-slate-700 text-slate-400"
                        }`}
                      >
                        <div className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
                          <span>⚡</span>
                          <bdi dir="auto">{lang === "ar" ? "بث حي مباشر (حرفاً بحرف)" : "Browser Neural Streaming"}</bdi>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                          <bdi dir="auto">
                            {lang === "ar"
                              ? "ظهور الحروف والكلمات فورياً أثناء الكلام بزمن استجابة 0ms ودقة عربية عالية."
                              : "Instant word-by-word streaming typing with zero server latency."}
                          </bdi>
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSttEngine("backend_whisper")}
                        className={`p-3 rounded-lg border text-left transition-all ${
                          sttEngine === "backend_whisper"
                            ? "border-cyan-400/80 bg-cyan-500/10 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                            : "border-slate-800 bg-slate-900/60 hover:border-slate-700 text-slate-400"
                        }`}
                      >
                        <div className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
                          <span>☁️</span>
                          <bdi dir="auto">{lang === "ar" ? "سحابة Groq Whisper" : "Cloud Whisper (Groq)"}</bdi>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                          <bdi dir="auto">
                            {lang === "ar"
                              ? "معالجة المقاطع عبر نموذج Whisper-large-v3-turbo على سحابة Groq."
                              : "Batch audio upload to Groq Cloud Whisper Turbo."}
                          </bdi>
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSttEngine("custom_stt")}
                        className={`p-3 rounded-lg border text-left transition-all ${
                          sttEngine === "custom_stt"
                            ? "border-cyan-400/80 bg-cyan-500/10 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                            : "border-slate-800 bg-slate-900/60 hover:border-slate-700 text-slate-400"
                        }`}
                      >
                        <div className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
                          <span>🎯</span>
                          <bdi dir="auto">{lang === "ar" ? "نموذج مخصص / خادم محلي" : "Dedicated Custom Model"}</bdi>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                          <bdi dir="auto">
                            {lang === "ar"
                              ? "ربط خادم صوتي خارجي أو محلي مخصص للغة العربية (vLLM / Whisper / Riva)."
                              : "Connect your self-hosted or dedicated external STT endpoint."}
                          </bdi>
                        </p>
                      </button>
                    </div>

                    {/* Custom model inputs when custom is selected */}
                    {sttEngine === "custom_stt" && (
                      <div className="p-3.5 rounded-lg border border-cyan-500/30 bg-slate-900/80 space-y-3 mt-2 animate-fadeIn">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-300">
                              <bdi dir="auto">{lang === "ar" ? "رابط نقطة النهاية (Endpoint URL)" : "Custom Endpoint URL"}</bdi>
                            </label>
                            <input
                              type="text"
                              value={sttCustomEndpoint}
                              onChange={(e) => setSttCustomEndpoint(e.target.value)}
                              placeholder="http://localhost:8000/v1/audio/transcriptions"
                              className="w-full bg-slate-950/80 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-cyan-300 focus:outline-none focus:border-cyan-500 font-mono"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-300">
                              <bdi dir="auto">{lang === "ar" ? "اسم النموذج المخصص (Model Name)" : "Custom Model Identifier"}</bdi>
                            </label>
                            <input
                              type="text"
                              value={sttModel}
                              onChange={(e) => setSttModel(e.target.value)}
                              placeholder="whisper-large-v3-arabic"
                              className="w-full bg-slate-950/80 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-cyan-300 focus:outline-none focus:border-cyan-500 font-mono"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-300">
                            <bdi dir="auto">{lang === "ar" ? "مفتاح API اختياري (Bearer Token)" : "API Key / Bearer Token (Optional)"}</bdi>
                          </label>
                          <input
                            type="password"
                            value={sttCustomApiKey}
                            onChange={(e) => setSttCustomApiKey(e.target.value)}
                            placeholder="sk-..."
                            className="w-full bg-slate-950/80 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-cyan-300 focus:outline-none focus:border-cyan-500 font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="border-t border-slate-700 pt-4 space-y-4">
                    <h3 className="text-sm font-semibold text-cyan-400">{t("sys_vad_calibration")}</h3>
                    <p className="text-xs text-slate-400 mb-3">{t("sys_vad_description")}</p>

                    {/* Frontend VAD Parameters */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm text-slate-300 flex items-center gap-1">
                          {t("sys_vad_silence_threshold")}
                          <span className="text-xs text-slate-500">({vadSilenceThreshold.toFixed(2)})</span>
                        </label>
                        <input type="range" min="0.01" max="1.0" step="0.01" value={vadSilenceThreshold}
                          onChange={(e) => { setVadSilenceThreshold(parseFloat(e.target.value)); setDirty(true); }}
                          className="w-full" />
                        <p className="text-xs text-slate-500">{t("sys_vad_silence_threshold_desc")}</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm text-slate-300 flex items-center gap-1">
                          {t("sys_vad_silence_timeout")}
                          <span className="text-xs text-slate-500">({vadSilenceTimeoutMs}ms)</span>
                        </label>
                        <input type="range" min="100" max="5000" step="50" value={vadSilenceTimeoutMs}
                          onChange={(e) => { setVadSilenceTimeoutMs(parseInt(e.target.value)); setDirty(true); }}
                          className="w-full" />
                        <p className="text-xs text-slate-500">{t("sys_vad_silence_timeout_desc")}</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm text-slate-300 flex items-center gap-1">
                          {t("sys_vad_min_recording")}
                          <span className="text-xs text-slate-500">({vadMinRecordingMs}ms)</span>
                        </label>
                        <input type="range" min="100" max="5000" step="50" value={vadMinRecordingMs}
                          onChange={(e) => { setVadMinRecordingMs(parseInt(e.target.value)); setDirty(true); }}
                          className="w-full" />
                        <p className="text-xs text-slate-500">{t("sys_vad_min_recording_desc")}</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm text-slate-300 flex items-center gap-1">
                          {t("sys_vad_max_recording")}
                          <span className="text-xs text-slate-500">({vadMaxRecordingMs}ms)</span>
                        </label>
                        <input type="range" min="1000" max="30000" step="500" value={vadMaxRecordingMs}
                          onChange={(e) => { setVadMaxRecordingMs(parseInt(e.target.value)); setDirty(true); }}
                          className="w-full" />
                        <p className="text-xs text-slate-500">{t("sys_vad_max_recording_desc")}</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm text-slate-300 flex items-center gap-1">
                          {t("sys_vad_baseline_window")}
                          <span className="text-xs text-slate-500">({vadBaselineWindowMs}ms)</span>
                        </label>
                        <input type="range" min="200" max="5000" step="100" value={vadBaselineWindowMs}
                          onChange={(e) => { setVadBaselineWindowMs(parseInt(e.target.value)); setDirty(true); }}
                          className="w-full" />
                        <p className="text-xs text-slate-500">{t("sys_vad_baseline_window_desc")}</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm text-slate-300 flex items-center gap-1">
                          {t("sys_vad_baseline_mult")}
                          <span className="text-xs text-slate-500">({vadBaselineMultiplier.toFixed(1)}x)</span>
                        </label>
                        <input type="range" min="1.0" max="10.0" step="0.1" value={vadBaselineMultiplier}
                          onChange={(e) => { setVadBaselineMultiplier(parseFloat(e.target.value)); setDirty(true); }}
                          className="w-full" />
                        <p className="text-xs text-slate-500">{t("sys_vad_baseline_mult_desc")}</p>
                      </div>
                    </div>

                    {/* Barge-in Parameters */}
                    <div className="border-t border-slate-700 pt-4 space-y-4">
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Barge-in (Interrupt JARVIS)</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm text-slate-300 flex items-center gap-1">
                            {t("sys_vad_barge_mult")}
                            <span className="text-xs text-slate-500">({vadBargeInMultiplier.toFixed(1)}x)</span>
                          </label>
                          <input type="range" min="1.0" max="10.0" step="0.1" value={vadBargeInMultiplier}
                            onChange={(e) => { setVadBargeInMultiplier(parseFloat(e.target.value)); setDirty(true); }}
                            className="w-full" />
                          <p className="text-xs text-slate-500">{t("sys_vad_barge_mult_desc")}</p>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm text-slate-300 flex items-center gap-1">
                            {t("sys_vad_barge_floor")}
                            <span className="text-xs text-slate-500">({vadBargeInFloor.toFixed(2)})</span>
                          </label>
                          <input type="range" min="0.01" max="1.0" step="0.01" value={vadBargeInFloor}
                            onChange={(e) => { setVadBargeInFloor(parseFloat(e.target.value)); setDirty(true); }}
                            className="w-full" />
                          <p className="text-xs text-slate-500">{t("sys_vad_barge_floor_desc")}</p>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm text-slate-300 flex items-center gap-1">
                            {t("sys_vad_barge_sustain")}
                            <span className="text-xs text-slate-500">({vadBargeInSustainMs}ms)</span>
                          </label>
                          <input type="range" min="50" max="2000" step="10" value={vadBargeInSustainMs}
                            onChange={(e) => { setVadBargeInSustainMs(parseInt(e.target.value)); setDirty(true); }}
                            className="w-full" />
                          <p className="text-xs text-slate-500">{t("sys_vad_barge_sustain_desc")}</p>
                        </div>
                      </div>
                    </div>

                    {/* Backend Silero VAD Parameters */}
                    <div className="border-t border-slate-700 pt-4 space-y-4">
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Backend Silero VAD</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm text-slate-300 flex items-center gap-1">
                            {t("sys_vad_silero_threshold")}
                            <span className="text-xs text-slate-500">({vadSileroThreshold.toFixed(2)})</span>
                          </label>
                          <input type="range" min="0.1" max="1.0" step="0.05" value={vadSileroThreshold}
                            onChange={(e) => { setVadSileroThreshold(parseFloat(e.target.value)); setDirty(true); }}
                            className="w-full" />
                          <p className="text-xs text-slate-500">{t("sys_vad_silero_threshold_desc")}</p>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm text-slate-300 flex items-center gap-1">
                            {t("sys_vad_silero_min_silence")}
                            <span className="text-xs text-slate-500">({vadSileroMinSilenceMs}ms)</span>
                          </label>
                          <input type="range" min="50" max="3000" step="50" value={vadSileroMinSilenceMs}
                            onChange={(e) => { setVadSileroMinSilenceMs(parseInt(e.target.value)); setDirty(true); }}
                            className="w-full" />
                          <p className="text-xs text-slate-500">{t("sys_vad_silero_min_silence_desc")}</p>
                        </div>
                      </div>
                    </div>

                    {/* STT Coalesce & Filters */}
                    <div className="border-t border-slate-700 pt-4 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm text-slate-300 flex items-center gap-1">
                            {t("sys_vad_stt_coalesce")}
                            <span className="text-xs text-slate-500">({vadSttCoalesceMs}ms)</span>
                          </label>
                          <input type="range" min="50" max="5000" step="50" value={vadSttCoalesceMs}
                            onChange={(e) => { setVadSttCoalesceMs(parseInt(e.target.value)); setDirty(true); }}
                            className="w-full" />
                          <p className="text-xs text-slate-500">{t("sys_vad_stt_coalesce_desc")}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-4">
                        <Toggle
                          label={t("sys_vad_hallucination_filter")}
                          value={vadHallucinationFilter}
                          onChange={(v) => { setVadHallucinationFilter(v); setDirty(true); }}
                        />
                        <Toggle
                          label={t("sys_vad_filler_filter")}
                          value={vadFillerFilter}
                          onChange={(v) => { setVadFillerFilter(v); setDirty(true); }}
                        />
                      </div>
                    </div>

                    {/* Reset button */}
                    <div className="border-t border-slate-700 pt-4">
                      <button
                        type="button"
                        onClick={() => {
                          setVadSilenceThreshold(0.08);
                          setVadSilenceTimeoutMs(600);
                          setVadMinRecordingMs(500);
                          setVadMaxRecordingMs(8000);
                          setVadBaselineWindowMs(1200);
                          setVadBaselineMultiplier(2.2);
                          setVadSileroThreshold(0.5);
                          setVadSileroMinSilenceMs(500);
                          setVadBargeInMultiplier(3.5);
                          setVadBargeInFloor(0.15);
                          setVadBargeInSustainMs(250);
                          setVadSttCoalesceMs(500);
                          setVadHallucinationFilter(true);
                          setVadFillerFilter(true);
                          setDirty(true);
                        }}
                        className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 hover:text-white transition text-sm font-mono"
                      >
                        {t("sys_vad_reset_defaults")}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Display sub-tab */}
              {systemSubTab === "display" && (
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-6">
                  <div className="space-y-2">
                    <label className="text-sm text-slate-300">{t("sys_interface_language")}</label>
                    <select
                      value={lang}
                      onChange={(e) => setLanguage(e.target.value as Lang)}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white"
                    >
                      <option value="en">{t("sys_interface_lang_en")}</option>
                      <option value="ar">{t("sys_interface_lang_ar")}</option>
                    </select>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-cyan-400">Layout</h3>
                    <button
                      onClick={() => setConfirmDialog({ text: "Reset all panel positions?", onYes: () => { resetAllLayouts(); setConfirmDialog(null); } })}
                      className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition">
                      Reset panel layout
                    </button>
                  </div>
                  <div className="border-t border-slate-700 pt-4 space-y-4">
                    <h3 className="text-sm font-semibold text-cyan-400">Appearance</h3>
                    <div className="space-y-2">
                      <label className="text-sm text-slate-300">Theme</label>
                      <select value={theme} onChange={(e) => { setTheme(e.target.value); setDirty(true); }}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white">
                        <option value="jarvis">JARVIS (Default)</option>
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                      </select>
                    </div>
                    <Toggle label="Show emojis" value={showEmojis} onChange={(v) => { setShowEmojis(v); setDirty(true); }} />
                    <Toggle label="Show status bar" value={showStatusBar} onChange={(v) => { setShowStatusBar(v); setDirty(true); }} />
                  </div>
                  <div className="border-t border-slate-700 pt-4 space-y-4">
                    <h3 className="text-sm font-semibold text-cyan-400">Performance</h3>
                    <div className="space-y-2">
                      <label className="text-sm text-slate-300">Stats refresh interval (ms)</label>
                      <input type="number" value={refreshInterval}
                        onChange={(e) => { setRefreshInterval(parseInt(e.target.value) || 1500); setDirty(true); }}
                        min="500" max="5000" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white" />
                    </div>
                  </div>
                </div>
              )}

              {/* Diagnostics sub-tab */}
              {systemSubTab === "diagnostics" && (
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
              )}

              {/* Data sub-tab */}
              {systemSubTab === "data" && (
                <div className="space-y-5">
                  {prevSessionAvailable && (
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
                      <h3 className="text-lg font-semibold text-cyan-400 mb-3">Session</h3>
                      <p className="text-slate-400 text-sm mb-4">A previous session was kept aside on launch.</p>
                      <button onClick={() => restoreLastSession()}
                        className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition">Restore previous session</button>
                    </div>
                  )}
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
                    <h3 className="text-lg font-semibold text-cyan-400 mb-3">Clear Data</h3>
                    <button onClick={() => setConfirmDialog({ text: "Wipe chat history?", onYes: () => { clearChat(); setConfirmDialog(null); } })}
                      className="w-full text-left px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition flex items-center justify-between">
                      <span>Clear chat history</span><span className="text-xs text-slate-400">Conversation history</span>
                    </button>
                    <button onClick={() => setConfirmDialog({ text: "Wipe media bay?", onYes: () => { clearMedia(); setConfirmDialog(null); } })}
                      className="w-full text-left px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition flex items-center justify-between">
                      <span>Clear media bay</span><span className="text-xs text-slate-400">Images, videos, files</span>
                    </button>
                    <button onClick={() => setConfirmDialog({ text: "Wipe tool history?", onYes: () => { clearTools(); setConfirmDialog(null); } })}
                      className="w-full text-left px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition flex items-center justify-between">
                      <span>Clear tool history</span><span className="text-xs text-slate-400">Tool executions</span>
                    </button>
                  </div>
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
                    <h3 className="text-lg font-semibold text-cyan-400 mb-3">Export Data</h3>
                    <button onClick={exportChat}
                      className="w-full px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition text-left">Export chat history (JSON)</button>
                    <button onClick={() => pushToast("ZIP export coming soon")}
                      className="w-full px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition text-left">Export all data (ZIP)</button>
                  </div>
                  {/* FG-019 / FG-020 (ported from ui): Settings Backup — export /
                      import / reset. Import only fills the form — nothing is
                      saved until Save is pressed. API keys are never in the
                      file; they stay in the backend .env. */}
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
                    <h3 className="text-lg font-semibold text-cyan-400 mb-3">Settings Backup</h3>
                    <p className="text-xs text-slate-400">Export the current settings to a file, or import a previously exported file. Import only fills the form — nothing is saved until you press Save.</p>
                    <button onClick={exportSettings}
                      className="w-full px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition text-left">Export settings (JSON)</button>
                    <input
                      type="file"
                      ref={settingsImportRef}
                      accept=".json,application/json"
                      className="hidden"
                      onChange={handleImportSettings}
                    />
                    <button onClick={() => settingsImportRef.current?.click()}
                      className="w-full px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition text-left">Import settings (JSON)</button>
                    <button
                      onClick={() => setConfirmDialog({ text: "Reset all settings to their defaults? Your API keys stay in the backend .env, but the form values will be replaced. Press Save afterwards to apply.", onYes: () => { resetSettingsToDefaults(); setConfirmDialog(null); } })}
                      className="w-full px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition text-left">Reset settings to defaults</button>
                  </div>
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
                    <h3 className="text-lg font-semibold text-red-400 mb-3">Danger Zone</h3>
                    <button
                      onClick={() => setConfirmDialog({ text: "Run Clean Slate? This wipes chat, media, and tool history. Backend memory is preserved.", onYes: () => { cleanSlate(); setConfirmDialog(null); } })}
                      className="w-full text-left px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-500 transition flex items-center justify-between">
                      <span>Clean slate</span><span className="text-xs text-red-200">All session data</span>
                    </button>
                    <p className="text-xs text-slate-500">Backend memory (preferences, notes, fixes) is preserved.</p>
                  </div>
                </div>
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
