/**
 * Settings → AI → Inference: fallback chain (enable + fallback provider/model).
 * Extracted from Settings.tsx: JSX unchanged.
 */

import { type Dispatch, type SetStateAction } from "react";
import { useStore } from "../../../lib/store";
import { useTranslations } from "../../../lib/i18n";
import { PREDEFINED_MODELS } from "./constants";

export interface InferenceFallbackChainProps {
  enableFallback: boolean;
  fallbackModel: string;
  fallbackProvider: string;
  provider: string;
  setDirty: Dispatch<SetStateAction<boolean>>;
  setEnableFallback: Dispatch<SetStateAction<boolean>>;
  setFallbackModel: Dispatch<SetStateAction<string>>;
  setFallbackProvider: Dispatch<SetStateAction<string>>;
}

export default function InferenceFallbackChain({
  enableFallback,
  fallbackModel,
  fallbackProvider,
  provider,
  setDirty,
  setEnableFallback,
  setFallbackModel,
  setFallbackProvider,
}: InferenceFallbackChainProps) {
  const lang = useStore((s) => s.language);
  const t = useTranslations(lang);

  return (
    <>
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
    </>
  );
}
