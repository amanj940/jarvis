/**
 * SETTINGS PANEL — full-page UI with sidebar navigation.
 *
 * Every control is wired to the backend GET/POST /api/config endpoints.
 * API keys are POSTed to /api/models (body, not URL) and persisted to .env
 * by the backend.  No alert()/confirm() — all feedback is inline.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../../lib/store";
import {
  getTools,
  getPlugins,
  togglePlugin,
  getMcpServers,
  addMcpServer,
  toggleMcpServer,
  deleteMcpServer,
  getHealth,
} from "../../lib/api";
import { resetAllLayouts } from "./Floating";

const APP_VERSION = "0.2.0";

interface SettingsProps {
  onClose: () => void;
  initialTab?: string;
}

// ── Provider → endpoint map (mirrors backend _PROVIDER_ENDPOINTS) ───────────
const PROVIDER_ENDPOINTS: Record<string, string | null> = {
  groq: "https://api.groq.com/openai/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  nvidia: "https://integrate.api.nvidia.com/v1",
  mistral: "https://api.mistral.ai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  anthropic: "https://api.anthropic.com",
  openai_compatible: null,
};

const PREDEFINED_MODELS: Record<string, string[]> = {
  groq: [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "deepseek-r1-distill-llama-70b",
    "qwen-qwq-32b",
    "llama-3.2-3b-preview",
  ],
  openai: ["gpt-4o-mini", "gpt-4o", "o1-mini", "o3-mini", "gpt-4-turbo"],
  openrouter: ["meta-llama/llama-3.3-70b-instruct", "anthropic/claude-3.5-sonnet", "deepseek/deepseek-r1", "google/gemini-2.0-flash-exp:free"],
  gemini: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
  nvidia: ["meta/llama-3.3-70b-instruct", "meta/llama-3.1-70b-instruct", "mistralai/mistral-large-2-instruct"],
  mistral: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
  cerebras: ["llama-3.3-70b", "llama3.1-70b", "llama3.1-8b"],
  anthropic: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"],
  openai_compatible: ["qwen2.5:1.5b", "qwen2.5:3b", "llama3.1:8b"],
};

// ── Provider catalog metadata for Providers tab ──────────────────────────────
interface ProviderInfo {
  name: string;
  icon: string;
  desc: string;
  kind: "cloud" | "local";
  keyUrl?: string;
}
const PROVIDER_INFO: Record<string, ProviderInfo> = {
  // ── Core Providers ──────────────────────────────────────────────────────────
  groq:              { name: "Groq",             icon: "⚡",  desc: "Fastest cloud inference",         kind: "cloud",  keyUrl: "https://console.groq.com/keys" },
  gemini:            { name: "Google Gemini",    icon: "✨",  desc: "Google AI Studio",               kind: "cloud",  keyUrl: "https://aistudio.google.com/apikey" },
  openai:            { name: "OpenAI",           icon: "🤖",  desc: "GPT & o-series models",          kind: "cloud",  keyUrl: "https://platform.openai.com/api-keys" },
  anthropic:         { name: "Anthropic",        icon: "🧠",  desc: "Claude models",                  kind: "cloud",  keyUrl: "https://console.anthropic.com/settings/keys" },
  openrouter:        { name: "OpenRouter",       icon: "🔀",  desc: "Multi-provider gateway",         kind: "cloud",  keyUrl: "https://openrouter.ai/keys" },
  deepseek:          { name: "DeepSeek",         icon: "🔍",  desc: "DeepSeek V3 & R1",               kind: "cloud",  keyUrl: "https://platform.deepseek.com/api_keys" },
  mistral:           { name: "Mistral AI",       icon: "🌊",  desc: "Mistral & Codestral",            kind: "cloud",  keyUrl: "https://console.mistral.ai/" },
  cerebras:          { name: "Cerebras",         icon: "🏃",  desc: "Ultra-fast chip inference",      kind: "cloud",  keyUrl: "https://cloud.cerebras.ai/" },
  nvidia:            { name: "NVIDIA NIM",       icon: "🎮",  desc: "NVIDIA hosted models",           kind: "cloud",  keyUrl: "https://build.nvidia.com/" },
  sambanova:         { name: "SambaNova Cloud",  icon: "🔴",  desc: "High-throughput LLM inference",  kind: "cloud",  keyUrl: "https://cloud.sambanova.ai/apis" },
  cohere:            { name: "Cohere",           icon: "🌐",  desc: "Command-R & enterprise RAG",     kind: "cloud",  keyUrl: "https://dashboard.cohere.com/api-keys" },
  // ── Extended Providers (from free-claude-code) ──────────────────────────────
  together:          { name: "Together AI",      icon: "🤝",  desc: "Open-source model hosting",      kind: "cloud",  keyUrl: "https://api.together.ai/settings/api-keys" },
  deepinfra:         { name: "DeepInfra",        icon: "🏗️",  desc: "Serverless GPU inference",       kind: "cloud",  keyUrl: "https://deepinfra.com/dash/api_keys" },
  siliconflow:       { name: "SiliconFlow",      icon: "💎",  desc: "Chinese cloud inference",        kind: "cloud",  keyUrl: "https://cloud.siliconflow.com/account/ak" },
  nebius:            { name: "Nebius",           icon: "🌌",  desc: "Token Factory inference",        kind: "cloud",  keyUrl: "https://tokenfactory.nebius.com/project/api-keys" },
  fireworks:         { name: "Fireworks AI",     icon: "🎆",  desc: "Fast open-source serving",       kind: "cloud",  keyUrl: "https://fireworks.ai/account/api-keys" },
  novita:            { name: "Novita AI",        icon: "🌠",  desc: "Affordable GPU cloud",           kind: "cloud",  keyUrl: "https://novita.ai/settings/key-management" },
  xai:               { name: "xAI (Grok)",       icon: "𝕏",   desc: "Grok models by xAI",            kind: "cloud",  keyUrl: "https://console.x.ai/team/default/api-keys" },
  huggingface:       { name: "Hugging Face",     icon: "🤗",  desc: "HF Inference Router",            kind: "cloud",  keyUrl: "https://huggingface.co/settings/tokens" },
  alibaba_cloud:     { name: "Alibaba (Qwen)",   icon: "☁️",  desc: "Qwen & DashScope models",       kind: "cloud",  keyUrl: "https://www.alibabacloud.com/help/en/model-studio/get-api-key" },
  minimax:           { name: "MiniMax",          icon: "🎭",  desc: "MiniMax LLM & multimodal",       kind: "cloud",  keyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key" },
  kimi:              { name: "Kimi (Moonshot)",  icon: "🌙",  desc: "Long-context Moonshot models",   kind: "cloud",  keyUrl: "https://platform.moonshot.cn/console/api-keys" },
  scaleway:          { name: "Scaleway",         icon: "🏔️",  desc: "European GPU cloud",            kind: "cloud",  keyUrl: "https://console.scaleway.com/iam/api-keys" },
  bedrock:           { name: "Amazon Bedrock",   icon: "🪨",  desc: "AWS managed AI models",          kind: "cloud",  keyUrl: "https://console.aws.amazon.com/bedrock/" },
  chutes:            { name: "Chutes AI",        icon: "🔗",  desc: "Decentralized GPU network",      kind: "cloud",  keyUrl: "https://chutes.ai/docs/getting-started/authentication" },
  featherless:       { name: "Featherless AI",   icon: "🪶",  desc: "Serverless open-source models",  kind: "cloud",  keyUrl: "https://featherless.ai/account/api-keys" },
  wandb:             { name: "W&B Inference",    icon: "📊",  desc: "Weights & Biases serverless",    kind: "cloud",  keyUrl: "https://wandb.ai/settings" },
  vercel_ai:         { name: "Vercel AI Gateway",icon: "▲",   desc: "Vercel AI proxy gateway",        kind: "cloud",  keyUrl: "https://vercel.com/docs/ai-gateway" },
  ollama_cloud:      { name: "Ollama Cloud",     icon: "☁️",  desc: "Ollama hosted cloud models",    kind: "cloud",  keyUrl: "https://ollama.com/settings/keys" },
  // ── Local Providers ─────────────────────────────────────────────────────────
  openai_compatible: { name: "Ollama (Local)",   icon: "🦙",  desc: "Local models via Ollama",        kind: "local" },
};

// ── Toast notification ──────────────────────────────────────────────────────
interface Toast { id: number; text: string; kind: "ok" | "error"; }

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

  // Tab normalization into 5 Master Tabs
  const normalizeTab = (t?: string) => {
    if (!t) return "ai";
    if (["ai", "model", "providers"].includes(t)) return "ai";
    if (["tools", "plugins"].includes(t)) return "tools";
    if (["mcp"].includes(t)) return "mcp";
    if (["integrations", "smart_home"].includes(t)) return "integrations";
    if (["system", "general", "voice", "display", "data"].includes(t)) return "system";
    return "ai";
  };

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
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  // Plugins list & toggling
  const [pluginsMap, setPluginsMap] = useState<Record<string, boolean>>({});
  const [pluginToggleLoading, setPluginToggleLoading] = useState<string | null>(null);

  // ── MCP State ─────────────────────────────────────────────────────────────
  interface McpServerItem {
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    enabled: boolean;
    description: string;
    status: string;
    tool_count: number;
    tools?: string[];
  }
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
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
    };
    calendar: {
      ics_url: string;
      enabled: boolean;
    };
    email: {
      smtp_host: string;
      smtp_port: number;
      username: string;
      password?: string;
      enabled: boolean;
    };
    telegram: {
      bot_token: string;
      chat_id: string;
      enabled: boolean;
    };
  }
  const [integrations, setIntegrations] = useState<IntegrationsConfig>({
    home_assistant: { url: "", token: "", enabled: false },
    calendar: { ics_url: "", enabled: false },
    email: { smtp_host: "", smtp_port: 587, username: "", enabled: false },
    telegram: { bot_token: "", chat_id: "", enabled: false },
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

  // Provider config modal state (Providers tab)
  const [providerConfigModal, setProviderConfigModal] = useState<string | null>(null);
  const [modalNewKey, setModalNewKey] = useState("");
  const [modalAddingKey, setModalAddingKey] = useState(false);
  const [modalKeyError, setModalKeyError] = useState<string | null>(null);
  const [modalKeySuccess, setModalKeySuccess] = useState<string | null>(null);
  const [modalLoadingModels, setModalLoadingModels] = useState(false);
  const [modalModelCounts, setModalModelCounts] = useState<Record<string, number>>({});
  const [voiceProvider, setVoiceProvider] = useState("auto");
  const [edgeVoice, setEdgeVoice] = useState("ar-SA-HamedNeural");
  const [edgeRate, setEdgeRate] = useState("-6%");
  const [ttsVolume, setTtsVolume] = useState(0.9);

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
      const resp = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: prov, api_key: cleanKey, endpoint: ep }),
      });
      const data = await resp.json();
      if (data.models && data.models.length > 0) {
        setAvailableModels(data.models);
        const isLive = Boolean(data.fetched);
        setModelsFetched(isLive);
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

  // Load MCP servers
  const loadMcp = useCallback(() => {
    setMcpLoading(true);
    getMcpServers()
      .then((data) => {
        if (data?.servers) setMcpServers(data.servers);
      })
      .catch((e) => console.error("failed to fetch mcp servers", e))
      .finally(() => setMcpLoading(false));
  }, []);

  // ── Load config on mount ─────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/config")
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
          setEdgeVoice(j.voice.edge_voice ?? "ar-SA-HamedNeural");
          setEdgeRate(j.voice.edge_rate ?? "-6%");
          setTtsVolume(j.voice.pyttsx3_volume ?? 0.9);
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
          }));
        }
        if (j.plugins) {
          setPluginsMap(j.plugins);
        }

        // Fetch key pools
        fetch("/api/keys")
          .then((r) => r.json())
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

    fetch("/api/agents")
      .then((r) => r.json())
      .then((j) => setAgents(j?.agents ?? []))
      .catch(() => undefined);

    getPlugins()
      .then((data) => {
        if (data?.plugins) setPluginsMap(data.plugins);
      })
      .catch(() => undefined);

    loadMcp();
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
      const resp = await fetch("/api/config", {
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
          api_keys: nonEmptyKeys,
          voice: {
            provider: voiceProvider,
            edge_voice: edgeVoice,
            edge_rate: edgeRate,
            pyttsx3_volume: ttsVolume,
          },
          ui: {
            theme,
            emoji: showEmojis,
            show_status_bar: showStatusBar,
            refresh_interval_ms: refreshInterval,
          },
          permissions: { mode: permMode },
          integrations,
          plugins: pluginsMap,
        }),
      });
      const data = await resp.json();
      if (data.ok) {
        pushToast(data.message || "Settings saved successfully.");
        setDirty(false);
      } else {
        pushToast("Save failed: " + (data.message || "unknown error"), "error");
      }
    } catch {
      pushToast("Failed to reach backend", "error");
    }
  };

  // Plugin toggle
  const handleTogglePlugin = async (pName: string, currentVal: boolean) => {
    const nextVal = !currentVal;
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
      await fetch("/api/config", {
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
    const args = newMcpArgs.trim() ? newMcpArgs.split(/\s+/).filter(Boolean) : [];
    let envObj: Record<string, string> = {};
    if (newMcpEnv.trim()) {
      try {
        envObj = JSON.parse(newMcpEnv);
      } catch {
        pushToast("Env must be valid JSON", "error");
        return;
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

  const applyMcpPreset = (preset: { name: string; command: string; args: string; desc: string; env?: string }) => {
    setNewMcpName(preset.name);
    setNewMcpCommand(preset.command);
    setNewMcpArgs(preset.args);
    setNewMcpDesc(preset.desc);
    setNewMcpEnv(preset.env || "");
    setShowAddMcpModal(true);
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
    if (prov === "openai_compatible") {
      if (finalEp) fetchModels(prov, "", finalEp);
    } else if (key || apiKeyStatus[prov]) {
      fetchModels(prov, key, finalEp);
    }
  }, [apiKeys, apiKeyStatus, endpoint, fetchModels]);

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

  // ── Multi-Key Management Helpers ──────────────────────────────────────────
  const refreshKeyPools = useCallback(async () => {
    try {
      const r = await fetch("/api/keys");
      const d = await r.json();
      if (d.keys) setKeyPools(d.keys);
      if (d.api_keys) setApiKeyStatus(d.api_keys);
    } catch {
      // ignore
    }
  }, []);

  const fetchCouncilRoster = useCallback(async () => {
    try {
      const r = await fetch("/api/council/roster");
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
      const resp = await fetch("/api/council/benchmark", { method: "POST" });
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
      const resp = await fetch("/api/keys/bulk-import", {
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
      const res = await fetch("/api/keys/add", {
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
      const res = await fetch("/api/keys/remove", {
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
      const res = await fetch("/api/keys/probe", {
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
    // Fetch model count for this provider
    if (prov !== "openai_compatible") {
      setModalLoadingModels(true);
      try {
        const envKey = apiKeyStatus[prov] ? "" : "";
        const ep = PROVIDER_ENDPOINTS[prov] || "";
        const res = await fetch("/api/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: prov, api_key: "", endpoint: ep }),
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
      const res = await fetch("/api/keys/add", {
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
        // Refresh model count
        setModalLoadingModels(true);
        try {
          const ep = PROVIDER_ENDPOINTS[prov] || "";
          const r2 = await fetch("/api/models", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: prov, api_key: cleanKey, endpoint: ep }),
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
      const res = await fetch("/api/keys/remove", {
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
      const res = await fetch("/api/keys/probe", {
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
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: prov, api_key: "", endpoint: ep }),
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
      await fetch("/api/cleanslate", { method: "POST" });
      pushToast("Clean slate done. Conversation history wiped; memory preserved.");
    } catch {
      pushToast("Backend unreachable for clean slate", "error");
    }
  };

  // ── Diagnostics ───────────────────────────────────────────────────────────
  const runHealthCheck = async () => {
    try {
      const r = await fetch("/api/health");
      const d = await r.json();
      pushToast(`Health: ${d.status} — ${d.model?.provider}/${d.model?.model} (${d.tools} tools)`);
    } catch {
      pushToast("Health check failed — backend unreachable", "error");
    }
  };

  const downloadLogs = () => {
    window.open("/api/logs/download", "_blank");
  };

  const testGpu = async () => {
    try {
      const r = await fetch("/api/stats");
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
    { id: "ai", label: "AI & Brain", icon: "🧠" },
    { id: "tools", label: `Tools & Skills (${toolsList.length || 77})`, icon: "🛠" },
    { id: "mcp", label: `MCP Ecosystem (${mcpServers.filter(s => s.enabled).length})`, icon: "🔌" },
    { id: "integrations", label: "Integrations", icon: "🌐" },
    { id: "system", label: "System & Config", icon: "⚙" },
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 bg-slate-900/50 border-r border-slate-700/50 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-slate-700/50">
          <h1 className="text-xl font-bold text-cyan-400 tracking-wider">SETTINGS</h1>
        </div>
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full text-left px-4 py-3 rounded-lg transition-all text-sm ${
                activeTab === tab.id
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-700/50 space-y-2">
          <button
            onClick={saveConfig}
            className={`w-full px-4 py-2 rounded-lg transition font-semibold text-sm ${
              dirty
                ? "bg-cyan-600 text-white hover:bg-cyan-500 animate-pulse"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {dirty ? "● Save Changes" : "Save Settings"}
          </button>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition text-sm"
          >
            Close
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
            const matchSearch =
              !q ||
              t.name.toLowerCase().includes(q) ||
              (t.description || "").toLowerCase().includes(q) ||
              (t.plugin || "").toLowerCase().includes(q);
            return matchPlugin && matchSearch;
          });

          return (
            <div className="max-w-6xl mx-auto space-y-6">
              {/* Header */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-700/50 pb-5">
                <div>
                  <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                    <span>🛠</span>
                    <span>Tools & Plugins Ecosystem</span>
                    <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                      {toolsList.length || 77} Armed Tools
                    </span>
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Autonomous tool bus connected to the LLM orchestrator. JARVIS selects, verifies permissions, and executes these tools during reasoning.
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
                    <span>↻</span> Refresh
                  </button>
                </div>
              </div>

              {/* 1. AUTONOMY PERMISSION MODE BANNER */}
              <div className="bg-gradient-to-r from-slate-900 via-slate-800/80 to-slate-900 border border-cyan-500/30 rounded-2xl p-5 shadow-xl">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs uppercase font-mono tracking-wider text-cyan-400 font-semibold">
                        AUTONOMY EXECUTION POLICY
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300">
                        {permMode.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1">
                      Defines whether JARVIS executes tool sequences autonomously or halts for human confirmation.
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
                    Capability Plugins ({Object.keys(pluginsMap).length || 12})
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">Instant hot-reload on toggle</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {Object.entries(pluginsMap).map(([pName, isEnabled]) => {
                    const isBusy = pluginToggleLoading === pName;
                    const toolCount = toolsList.filter((t) => t.plugin === pName).length;
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
                            <span className="text-[10px] text-slate-400 font-mono">
                              {toolCount ? `${toolCount} tools` : "plugin"}
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleTogglePlugin(pName, isEnabled)}
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
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Stats Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-3">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-mono">Total Tools</div>
                  <div className="text-2xl font-bold text-cyan-400 mt-0.5">{toolsList.length || 77}</div>
                </div>
                <div className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-3">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-mono">Active Plugins</div>
                  <div className="text-2xl font-bold text-purple-400 mt-0.5">{health?.plugins?.length || 12}</div>
                </div>
                <div className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-3">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-mono">Safe (Auto-run)</div>
                  <div className="text-2xl font-bold text-emerald-400 mt-0.5">
                    {toolsList.filter((t) => t.permission === "safe").length || 45}
                  </div>
                </div>
                <div className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-3">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-mono">Caution / Gated</div>
                  <div className="text-2xl font-bold text-amber-400 mt-0.5">
                    {toolsList.filter((t) => t.permission !== "safe").length || 32}
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
                    placeholder="Search 77 tools by name, description, plugin (e.g. python, 3D, image, shell, browser, memory)..."
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
                              <span>{isExpanded ? "▾ Hide schema" : "▸ View parameters"}</span>
                            </button>
                            {isExpanded && (
                              <pre className="mt-2 p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg text-[10.5px] font-mono text-slate-300 overflow-x-auto max-h-48">
                                {JSON.stringify(t.parameters, null, 2)}
                              </pre>
                            )}
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
                        {count ? `${count} models available` : "Configured"}
                      </span>
                    : <span className="text-amber-400/80 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                        Not configured
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
                  {hasKey ? "Edit" : "Configure"}
                </button>
              </div>
            );
          };
          return (
            <div className="max-w-6xl mx-auto space-y-8">
              <div className="flex items-center justify-between border-b border-slate-700/50 pb-5">
                <div>
                  <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                    <span>🧠</span> AI &amp; Brain
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">Provider keys, active model, inference parameters, and fallback chains.</p>
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
                      {s === "inference" ? "🔧 Inference" : s === "providers" ? "🔑 Providers" : s === "council" ? "🏛️ AI Council" : "🐝 Swarm Agents"}
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
                      <option value="openai_compatible">OpenAI Compatible (Ollama / LM Studio)</option>
                      <option value="groq">Groq (Fastest cloud)</option>
                      <option value="openai">OpenAI</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="gemini">Google Gemini</option>
                      <option value="nvidia">NVIDIA</option>
                      <option value="mistral">Mistral</option>
                      <option value="cerebras">Cerebras</option>
                      <option value="anthropic">Anthropic (Claude)</option>
                    </select>
                  </div>

                  {/* Key status banner */}
                  {provider !== "openai_compatible" && (
                    <div className="flex items-center justify-between bg-slate-900/60 border border-slate-700/50 rounded-xl px-4 py-3">
                      <div className="flex items-center gap-2 text-sm">
                        {(keyPools[provider] || []).length > 0 || apiKeyStatus[provider] ? (
                          <>
                            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                            <span className="text-emerald-300 font-medium">
                              {(keyPools[provider] || []).length > 1
                                ? `${(keyPools[provider] || []).length} keys — ⚡ Auto-Rotation active`
                                : "API key configured"}
                            </span>
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
                        🔑 Manage Keys
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
                            {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
                          </optgroup>
                        ) : (
                          <optgroup label="Suggested Models">
                            {(availableModels.length > 0 ? availableModels : PREDEFINED_MODELS[provider] || []).map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
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
                            <option value="gemini">Google Gemini</option>
                            <option value="groq">Groq</option>
                            <option value="openai_compatible">OpenAI Compatible (Local Ollama)</option>
                            <option value="openai">OpenAI</option>
                            <option value="mistral">Mistral</option>
                            <option value="cerebras">Cerebras</option>
                            <option value="anthropic">Anthropic</option>
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

                  <button onClick={saveConfig}
                    className="w-full px-4 py-3 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition font-semibold">
                    Save Settings
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

                  <section>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Cloud Providers</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {cloudProviders.map(([pid, info]) => <ProviderCard key={pid} pid={pid} info={info} />)}
                    </div>
                  </section>
                  <section>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Local Providers</h3>
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
                            { id: "gemini", name: "Google Gemini", provider: "gemini", model: "gemini-2.5-flash", icon: "🌐", role: "المستشار التحليلي والمعلوماتي الشامل", specialty: "سياق المليون توكن وسرعة البحث واسترجاع الحقائق", active: false },
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
                            const resp = await fetch("/api/council", {
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
                            const res = await fetch("/api/swarm/run", {
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
                  <span>🔌</span> MCP Ecosystem
                  <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    {mcpServers.filter((s) => s.enabled).length} active
                  </span>
                </h2>
                <p className="text-sm text-slate-400 mt-1">Model Context Protocol servers — autonomous tool bridges to external systems.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={loadMcp}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg border border-slate-700 flex items-center gap-1.5 transition">
                  ↻ Refresh
                </button>
                <button onClick={() => setShowAddMcpModal(true)}
                  className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-xs rounded-lg flex items-center gap-1.5 transition font-semibold">
                  + Add Server
                </button>
              </div>
            </div>

            {/* 1-Click Presets */}
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-5">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">⚡ 1-Click Presets</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {([
                  { id: "filesystem", name: "filesystem", label: "📁 Filesystem", desc: "Local file access", command: "npx", args: '["-y", "@modelcontextprotocol/server-filesystem", "/home"]' },
                  { id: "github", name: "github", label: "🐙 GitHub", desc: "Repo management", command: "npx", args: '["-y", "@modelcontextprotocol/server-github"]', env: '{"GITHUB_TOKEN": ""}' },
                  { id: "sqlite", name: "sqlite", label: "🗃 SQLite", desc: "Local DB queries", command: "npx", args: '["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "data.db"]' },
                  { id: "brave-search", name: "brave-search", label: "🔍 Brave Search", desc: "Web search", command: "npx", args: '["-y", "@modelcontextprotocol/server-brave-search"]', env: '{"BRAVE_API_KEY": ""}' },
                  { id: "puppeteer", name: "puppeteer", label: "🤖 Puppeteer", desc: "Browser automation", command: "npx", args: '["-y", "@modelcontextprotocol/server-puppeteer"]' },
                ] as const).map((preset) => {
                  const already = mcpServers.some((s) => s.name === preset.id);
                  return (
                    <button
                      key={preset.id}
                      disabled={already}
                      onClick={() => applyMcpPreset(preset)}
                      className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-center transition ${
                        already
                          ? "border-emerald-600/40 bg-emerald-900/20 text-emerald-400 cursor-default"
                          : "border-slate-700 bg-slate-800/60 hover:border-purple-500/50 hover:bg-purple-900/20 text-slate-300"
                      }`}
                    >
                      <span className="text-lg">{preset.label}</span>
                      <span className="text-[10px] text-slate-400">{preset.desc}</span>
                      {already && <span className="text-[10px] text-emerald-400 font-semibold">✓ added</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Configured Servers */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Configured Servers</h3>
              {mcpLoading && <div className="text-slate-400 text-sm">Loading…</div>}
              {!mcpLoading && mcpServers.length === 0 && (
                <div className="bg-slate-800/40 border border-dashed border-slate-700 rounded-xl p-8 text-center">
                  <p className="text-slate-400 text-sm">No MCP servers configured yet.</p>
                  <p className="text-slate-500 text-xs mt-1">Use a preset above or add one manually.</p>
                </div>
              )}
              {mcpServers.map((srv) => (
                <div key={srv.name}
                  className={`bg-slate-800/50 border rounded-xl p-4 flex items-center gap-4 transition ${
                    srv.enabled ? "border-purple-500/30" : "border-slate-700/50 opacity-70"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-sm text-white">{srv.name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-mono ${
                        srv.enabled
                          ? "bg-emerald-900/40 border-emerald-600/40 text-emerald-300"
                          : "bg-slate-900/40 border-slate-600/40 text-slate-400"
                      }`}>
                        {srv.enabled ? "● RUNNING" : "○ STOPPED"}
                      </span>
                      {(srv as any).tool_count > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-purple-900/30 border border-purple-600/30 text-purple-300 rounded font-mono">
                          {(srv as any).tool_count} tools
                        </span>
                      )}
                    </div>
                    {srv.description && <p className="text-xs text-slate-400 mt-0.5">{srv.description}</p>}
                    <code className="text-[11px] text-slate-500 font-mono mt-1 block truncate">
                      {srv.command} {(srv.args || []).join(" ")}
                    </code>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleToggleMcp(srv.name, srv.enabled)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${
                        srv.enabled ? "bg-purple-500" : "bg-slate-700"
                      }`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                        srv.enabled ? "left-5" : "left-1"
                      }`} />
                    </button>
                    <button
                      onClick={() => handleDeleteMcp(srv.name)}
                      className="px-2 py-1 text-xs bg-red-950/60 hover:bg-red-900/80 text-red-300 rounded border border-red-800/50 transition"
                    >✕</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add MCP Modal */}
            {showAddMcpModal && (
              <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70"
                onClick={(e) => { if (e.target === e.currentTarget) setShowAddMcpModal(false); }}>
                <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[85vh]">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
                    <h3 className="font-bold text-white">Add MCP Server</h3>
                    <button onClick={() => setShowAddMcpModal(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
                  </div>
                  <div className="overflow-y-auto flex-1 p-6 space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs text-slate-300 font-semibold uppercase tracking-wider">Name</label>
                      <input type="text" value={newMcpName} onChange={(e) => setNewMcpName(e.target.value)}
                        placeholder="e.g. filesystem" className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-slate-300 font-semibold uppercase tracking-wider">Command</label>
                      <input type="text" value={newMcpCommand} onChange={(e) => setNewMcpCommand(e.target.value)}
                        placeholder="e.g. npx @modelcontextprotocol/server-filesystem" className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm font-mono" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-slate-300 font-semibold uppercase tracking-wider">Args (JSON array, optional)</label>
                      <input type="text" value={newMcpArgs} onChange={(e) => setNewMcpArgs(e.target.value)}
                        placeholder='["/home/user/docs"]' className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm font-mono" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-slate-300 font-semibold uppercase tracking-wider">Description</label>
                      <input type="text" value={newMcpDesc} onChange={(e) => setNewMcpDesc(e.target.value)}
                        placeholder="Short description" className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-slate-300 font-semibold uppercase tracking-wider">Environment Variables (JSON object, optional)</label>
                      <textarea value={newMcpEnv} onChange={(e) => setNewMcpEnv(e.target.value)}
                        placeholder='{"GITHUB_TOKEN": "ghp_..."}'
                        rows={3} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm font-mono resize-none" />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700">
                    <button onClick={() => setShowAddMcpModal(false)}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-sm transition">Cancel</button>
                    <button onClick={handleAddMcp} disabled={!newMcpName.trim() || !newMcpCommand.trim()}
                      className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-semibold transition disabled:opacity-40">
                      Add Server
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
            <div className="border-b border-slate-700/50 pb-5">
              <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                <span>🌐</span> Integrations
              </h2>
              <p className="text-sm text-slate-400 mt-1">Connect JARVIS to external systems. Changes take effect after save.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Home Assistant */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white flex items-center gap-2"><span>🏠</span> Home Assistant</h3>
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
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Long-Lived Access Token</label>
                    <input type="password" value={integrations.home_assistant?.token || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, home_assistant: { ...p.home_assistant, token: e.target.value } })); setDirty(true); }}
                      placeholder="Bearer token"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm" />
                  </div>
                </div>
              </div>

              {/* Calendar */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white flex items-center gap-2"><span>📅</span> Calendar (iCal)</h3>
                  <Toggle
                    label=""
                    value={integrations.calendar?.enabled ?? false}
                    onChange={(v) => { setIntegrations((p) => ({ ...p, calendar: { ...p.calendar, enabled: v } })); setDirty(true); }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">ICS URL</label>
                  <input type="text" value={integrations.calendar?.ics_url || ""}
                    onChange={(e) => { setIntegrations((p) => ({ ...p, calendar: { ...p.calendar, ics_url: e.target.value } })); setDirty(true); }}
                    placeholder="https://calendar.google.com/...ics"
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm" />
                </div>
              </div>

              {/* Email SMTP */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white flex items-center gap-2"><span>📧</span> Email (SMTP)</h3>
                  <Toggle
                    label=""
                    value={integrations.email?.enabled ?? false}
                    onChange={(v) => { setIntegrations((p) => ({ ...p, email: { ...p.email, enabled: v } })); setDirty(true); }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">SMTP Host</label>
                    <input type="text" value={integrations.email?.smtp_host || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, email: { ...p.email, smtp_host: e.target.value } })); setDirty(true); }}
                      placeholder="smtp.gmail.com" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Port</label>
                    <input type="number" value={integrations.email?.smtp_port || 587}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, email: { ...p.email, smtp_port: parseInt(e.target.value) || 587 } })); setDirty(true); }}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Username</label>
                    <input type="text" value={integrations.email?.username || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, email: { ...p.email, username: e.target.value } })); setDirty(true); }}
                      placeholder="you@gmail.com" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Password / App key</label>
                    <input type="password" value={integrations.email?.password || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, email: { ...p.email, password: e.target.value } })); setDirty(true); }}
                      placeholder="App password" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm" />
                  </div>
                </div>
              </div>

              {/* Telegram */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white flex items-center gap-2"><span>✈️</span> Telegram Bot</h3>
                  <Toggle
                    label=""
                    value={integrations.telegram?.enabled ?? false}
                    onChange={(v) => { setIntegrations((p) => ({ ...p, telegram: { ...p.telegram, enabled: v } })); setDirty(true); }}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Bot Token</label>
                    <input type="password" value={integrations.telegram?.bot_token || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, telegram: { ...p.telegram, bot_token: e.target.value } })); setDirty(true); }}
                      placeholder="1234567890:ABC..." className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Chat ID</label>
                    <input type="text" value={integrations.telegram?.chat_id || ""}
                      onChange={(e) => { setIntegrations((p) => ({ ...p, telegram: { ...p.telegram, chat_id: e.target.value } })); setDirty(true); }}
                      placeholder="-1001234567890" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
                  </div>
                </div>
              </div>
            </div>

            <button onClick={saveConfig}
              className="w-full px-4 py-3 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition font-semibold">
              Save Integrations
            </button>
          </div>
        )}

        {/* ══ System & Config ═══════════════════════════════════════════════ */}
        {activeTab === "system" && (() => {
          const sysSubTabs = [
            { id: "voice", label: "🎙 Voice" },
            { id: "display", label: "🖥 Display" },
            { id: "diagnostics", label: "🩺 Diagnostics" },
            { id: "data", label: "🗑 Data" },
          ] as const;
          return (
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="flex items-center justify-between border-b border-slate-700/50 pb-5">
                <div>
                  <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                    <span>⚙</span> System &amp; Config
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">Voice, display, diagnostics, and data management.</p>
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
                  <Toggle label="JARVIS speaks aloud (TTS)" value={voiceEnabled} onChange={setVoiceEnabled} />
                  <Toggle label="Listen for wake word (mic always on)" value={wakeEnabled} onChange={setWakeEnabled} />
                  <Toggle label="Say 'cancel' to stop JARVIS speaking" value={bargeIn} onChange={setBargeIn} />
                  <div className="border-t border-slate-700 pt-4 space-y-3">
                    <h3 className="text-sm font-semibold text-cyan-400">TTS Provider</h3>
                    <select value={voiceProvider} onChange={(e) => { setVoiceProvider(e.target.value); setDirty(true); }}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white">
                      <option value="auto">Auto (best available)</option>
                      <option value="edge_tts">Edge-TTS (Online, Microsoft)</option>
                      <option value="piper">Piper (Local, JARVIS model)</option>
                      <option value="pyttsx3">System TTS (pyttsx3 / espeak)</option>
                      <option value="nvidia_riva">NVIDIA Riva (Cloud)</option>
                    </select>
                    <div className="space-y-2">
                      <label className="text-sm text-slate-300">Edge-TTS Voice</label>
                      <select value={edgeVoice} onChange={(e) => { setEdgeVoice(e.target.value); setDirty(true); }}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white">
                        <option value="en-GB-RyanNeural">Ryan Neural (British)</option>
                        <option value="en-GB-ThomasNeural">Thomas Neural (British)</option>
                        <option value="en-GB-SoniaNeural">Sonia Neural (British, female)</option>
                        <option value="ar-SA-HamedNeural">Hamed Neural (Arabic, recommended)</option>
                        <option value="ar-SA-SalehNeural">Saleh Neural (Arabic)</option>
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
                </div>
              )}

              {/* Display sub-tab */}
              {systemSubTab === "display" && (
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-6">
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
                    <div className="space-y-2 pt-2">
                      <label className="text-sm text-slate-300">Default language</label>
                      <select value="en" onChange={() => pushToast("Language selection coming soon")}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white">
                        <option value="en">English</option>
                        <option value="ar">Arabic</option>
                        <option value="auto">Auto-detect</option>
                      </select>
                    </div>
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

// ── Helper components ────────────────────────────────────────────────────────

function Toggle({
  label, value, onChange,
}: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer py-2">
      <span className="text-slate-300">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative w-12 h-6 rounded-full transition-colors ${
          value ? "bg-cyan-500" : "bg-slate-600"
        }`}
      >
        <span
          className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
            value ? "left-7" : "left-1"
          }`}
        />
      </button>
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}
