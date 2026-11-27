/**
 * Settings → AI → Inference: model name field (select / custom input, live model list, verification badges).
 * Extracted from Settings.tsx: JSX unchanged.
 */

import { type Dispatch, type SetStateAction } from "react";
import { PREDEFINED_MODELS, type VerifiedModelInfo } from "./constants";

export interface InferenceModelFieldProps {
  apiKeyInput: string;
  apiKeys: Record<string, string>;
  availableModels: string[];
  endpoint: string;
  fetchModels: (prov: string, key: string, ep: string) => Promise<void>;
  isCustomModel: boolean;
  loadingModels: boolean;
  model: string;
  modelsFetched: boolean;
  provider: string;
  setDirty: Dispatch<SetStateAction<boolean>>;
  setIsCustomModel: Dispatch<SetStateAction<boolean>>;
  setModel: Dispatch<SetStateAction<string>>;
  verifiedModels: Record<string, VerifiedModelInfo>;
}

export default function InferenceModelField({
  apiKeyInput,
  apiKeys,
  availableModels,
  endpoint,
  fetchModels,
  isCustomModel,
  loadingModels,
  model,
  modelsFetched,
  provider,
  setDirty,
  setIsCustomModel,
  setModel,
  verifiedModels,
}: InferenceModelFieldProps) {
  return (
    <>
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
    </>
  );
}
