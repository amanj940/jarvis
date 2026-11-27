/**
 * Settings → AI → Inference: API-key status banner (configured / missing key + shortcuts to Providers).
 * Extracted from Settings.tsx: JSX unchanged.
 */

import { type Dispatch, type SetStateAction } from "react";
import { type AiSubTab, type KeyPoolItem } from "./constants";

export interface InferenceKeyBannerProps {
  apiKeyStatus: Record<string, boolean>;
  keyPools: Record<string, KeyPoolItem[]>;
  model: string;
  provider: string;
  setActiveTab: Dispatch<SetStateAction<string>>;
  setAiSubTab: Dispatch<SetStateAction<AiSubTab>>;
}

export default function InferenceKeyBanner({
  apiKeyStatus,
  keyPools,
  model,
  provider,
  setActiveTab,
  setAiSubTab,
}: InferenceKeyBannerProps) {
  return (
    <>
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
    </>
  );
}
