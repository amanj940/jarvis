/**
 * Settings → AI → Inference: provider picker (cloud/local provider select + key/endpoint reset on change).
 * Extracted from Settings.tsx: JSX unchanged.
 */

import { useCallback, type Dispatch, type SetStateAction } from "react";
import { PREDEFINED_MODELS, PROVIDER_ENDPOINTS, type KeyPoolItem } from "./constants";

export interface InferenceProviderSectionProps {
  apiKeyStatus: Record<string, boolean>;
  apiKeys: Record<string, string>;
  endpoint: string;
  fetchModels: (prov: string, key: string, ep: string) => Promise<void>;
  keyPools: Record<string, KeyPoolItem[]>;
  provider: string;
  setApiKeyInput: Dispatch<SetStateAction<string>>;
  setAvailableModels: Dispatch<SetStateAction<string[]>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  setEndpoint: Dispatch<SetStateAction<string>>;
  setIsCustomModel: Dispatch<SetStateAction<boolean>>;
  setKeyValid: Dispatch<SetStateAction<boolean | null>>;
  setModel: Dispatch<SetStateAction<string>>;
  setModelError: Dispatch<SetStateAction<string | null>>;
  setModelsFetched: Dispatch<SetStateAction<boolean>>;
  setProvider: Dispatch<SetStateAction<string>>;
}

export default function InferenceProviderSection({
  apiKeyStatus,
  apiKeys,
  endpoint,
  fetchModels,
  keyPools,
  provider,
  setApiKeyInput,
  setAvailableModels,
  setDirty,
  setEndpoint,
  setIsCustomModel,
  setKeyValid,
  setModel,
  setModelError,
  setModelsFetched,
  setProvider,
}: InferenceProviderSectionProps) {
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

  return (
    <>
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
    </>
  );
}
