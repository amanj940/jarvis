/**
 * Static data + shared types for the Settings panel.
 * Extracted verbatim from Settings.tsx (no logic changes).
 */

import type { useStore } from "../../../lib/store";

// ── Provider → endpoint map (mirrors backend _PROVIDER_ENDPOINTS) ───────────
export const PROVIDER_ENDPOINTS: Record<string, string | null> = {
  // ── Core Cloud Providers ──────────────────────────────────────────────────
  groq:              "https://api.groq.com/openai/v1",
  openai:            "https://api.openai.com/v1",
  openrouter:        "https://openrouter.ai/api/v1",
  gemini:            "https://generativelanguage.googleapis.com/v1beta/openai",
  nvidia:            "https://integrate.api.nvidia.com/v1",
  mistral:           "https://api.mistral.ai/v1",
  cerebras:          "https://api.cerebras.ai/v1",
  anthropic:         "https://api.anthropic.com",
  deepseek:          "https://api.deepseek.com",
  sambanova:         "https://api.sambanova.ai/v1",
  cohere:            "https://api.cohere.ai/compatibility/v1",
  together:          "https://api.together.ai/v1",
  deepinfra:         "https://api.deepinfra.com/v1/openai",
  siliconflow:       "https://api.siliconflow.com/v1",
  nebius:            "https://api.tokenfactory.nebius.com/v1",
  fireworks:         "https://api.fireworks.ai/inference/v1",
  novita:            "https://api.novita.ai/openai/v1",
  xai:               "https://api.x.ai/v1",
  huggingface:       "https://router.huggingface.co/v1",
  alibaba_cloud:     "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  minimax:           "https://api.minimax.io/v1",
  kimi:              "https://api.moonshot.ai/v1",
  scaleway:          "https://api.scaleway.ai/v1",
  bedrock:           "https://bedrock-mantle.us-east-1.api.aws/v1",
  chutes:            "https://llm.chutes.ai/v1",
  featherless:       "https://api.featherless.ai/v1",
  wandb:             "https://api.inference.wandb.ai/v1",
  vercel_ai:         "https://ai-gateway.vercel.sh/v1",
  ollama_cloud:      "https://ollama.com/v1",
  // ── Free / No-Key Providers ────────────────────────────────────────────────
  kilo:              "https://api.kilo.ai/api/gateway",
  pollinations:      "https://text.pollinations.ai/openai",
  ovhcloud:          "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
  ollama:            "http://localhost:11434/v1",
  lmstudio:          "http://localhost:1234/v1",
  omniroute:         "http://localhost:20128/v1",
  // ── Custom ───────────────────────────────────────────────────────────────
  openai_compatible: null,
};

export const PREDEFINED_MODELS: Record<string, string[]> = {
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
  // ── Free / No-Key Providers ────────────────────────────────────────────────
  kilo:         ["kilo-auto/free", "reflection/beam-free", "openrouter/free"],
  pollinations:  ["openai-fast", "mistral", "claude-hybridspace"],
  ovhcloud:      ["Meta-Llama-3_3-70B-Instruct", "gpt-oss-120b", "Qwen3.8-27B", "Mistral-Small-3.2-24B-Instruct-2506"],
  ollama:        ["llama3.2:1b", "llama3.2:latest", "smollm2:360m", "qwen2.5:latest", "mistral:latest", "deepseek-r1:latest"],
  lmstudio:      ["local-model"],
  omniroute:     ["groq/openai/gpt-oss-120b", "gem", "gemini/gemini-3.8-flash"],
};

// ── Provider catalog metadata for Providers tab ──────────────────────────────
export interface ProviderInfo {
  name: string;
  icon: string;
  desc: string;
  kind: "cloud" | "local";
  keyUrl?: string;
}
export const PROVIDER_INFO: Record<string, ProviderInfo> = {
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
  // ── Free / No-Key Providers ─────────────────────────────────────────────────
  kilo:              { name: "Kilo Gateway",      icon: "🆓",  desc: "200 req/hr, no key needed",        kind: "local" },
  pollinations:      { name: "Pollinations AI",   icon: "🌸",  desc: "Unlimited free, English/code",     kind: "local" },
  ovhcloud:          { name: "OVHcloud AI",       icon: "☁️",  desc: "Free Qwen/Llama, no key",          kind: "local" },
  omniroute:         { name: "9Router Proxy",     icon: "🔀",  desc: "Local free-tier aggregator",       kind: "local" },
  // ── Local Providers ─────────────────────────────────────────────────────────
  ollama:            { name: "Ollama (Local)",    icon: "🦙",  desc: "Local models via Ollama",          kind: "local" },
  lmstudio:          { name: "LM Studio (Local)", icon: "🏠",  desc: "Local models via LM Studio",       kind: "local" },
  openai_compatible: { name: "OpenAI-Compatible", icon: "🔧",  desc: "Custom OpenAI-compatible endpoint", kind: "local" },
};

// ── Toast notification ──────────────────────────────────────────────────────
export interface Toast { id: number; text: string; kind: "ok" | "error"; }

// Tool registry entry returned by GET /api/tools (shared by Settings + ToolsTab).
export interface ToolItem {
  name: string;
  description: string;
  permission: string;
  plugin: string;
  parameters?: any;
}

export interface IntegrationsConfig {
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

// Target passed to PlatformDetailModal when a platform card is opened.
export interface PlatformModalTarget {
  id: string;
  name: string;
  icon: string;
  serverConfig?: any;
  integrationConfig?: any;
}

export interface McpToolItem {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

export interface McpServerItem {
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

export interface McpPresetItem {
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

// In-panel confirmation dialog (shared by several Settings sections).
export interface ConfirmDialogState {
  text: string;
  onYes: () => void;
}

// App version shown in Settings → System → Diagnostics.
export const APP_VERSION = "0.2.0";

// Shape of the backend health snapshot kept in the global store.
export type Health = ReturnType<typeof useStore.getState>["health"];

// One API key in a provider's multi-key pool (GET /api/keys).
export interface KeyPoolItem {
  masked: string;
  key_preview?: string;
  status: string;
  cooldown_remaining?: number;
  failures?: number;
  successes?: number;
  last_error?: string | null;
}
