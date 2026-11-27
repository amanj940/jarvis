/**
 * Settings → AI → Inference: Ollama service control card (status, start/stop, model pull).
 * Extracted from Settings.tsx: JSX unchanged.
 */

import { useState, type Dispatch, type SetStateAction } from "react";
import { authFetch } from "../../../lib/api";
import { type OllamaStatus } from "./constants";

export interface InferenceOllamaCardProps {
  fetchOllamaStatus: () => Promise<void>;
  model: string;
  ollamaStatus: OllamaStatus | null;
  provider: string;
  setDirty: Dispatch<SetStateAction<boolean>>;
  setIsCustomModel: Dispatch<SetStateAction<boolean>>;
  setModel: Dispatch<SetStateAction<string>>;
  setOllamaStatus: Dispatch<SetStateAction<OllamaStatus | null>>;
}

export default function InferenceOllamaCard({
  fetchOllamaStatus,
  model,
  ollamaStatus,
  provider,
  setDirty,
  setIsCustomModel,
  setModel,
  setOllamaStatus,
}: InferenceOllamaCardProps) {
  const [ollamaLoading, setOllamaLoading] = useState(false);

  const [ollamaPullModel, setOllamaPullModel] = useState("");

  const [ollamaPullMsg, setOllamaPullMsg] = useState("");

  return (
    <>
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
    </>
  );
}
