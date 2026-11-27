/**
 * Settings → AI → Inference: "Brain Config — Memory & Cognition" panel.
 * Extracted from Settings.tsx: JSX unchanged. State stays owned by Settings (it is part of the
 * saved config); the panel edits it through `brain` / `setBrain`.
 */

import type { Dispatch, SetStateAction } from "react";
import type { BrainConfig } from "./brainConfig";

export interface BrainConfigPanelProps {
  brain: BrainConfig;
  setBrain: Dispatch<SetStateAction<BrainConfig>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  saveConfig: () => Promise<void>;
}

export default function BrainConfigPanel({
  brain,
  setBrain,
  setDirty,
  saveConfig,
}: BrainConfigPanelProps) {
  const patchBrain = (patch: Partial<BrainConfig>) => setBrain((b) => ({ ...b, ...patch }));

  return (
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
          <input type="checkbox" checked={brain.semanticMemory}
            onChange={(e) => { patchBrain({ semanticMemory: e.target.checked }); setDirty(true); }} className="sr-only peer" />
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
          <input type="checkbox" checked={brain.autoRemember}
            onChange={(e) => { patchBrain({ autoRemember: e.target.checked }); setDirty(true); }} className="sr-only peer" />
          <div className="w-11 h-6 bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
        </label>
      </div>

      {/* Embedding Model */}
      <div className="space-y-2">
        <label className="text-sm text-slate-300 flex items-center gap-2">
          <span>🔮</span> نموذج التضمين (Embedding Model)
        </label>
        <select
          value={brain.embedModel}
          onChange={(e) => { patchBrain({ embedModel: e.target.value }); setDirty(true); }}
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
            value={brain.recallK}
            onChange={(e) => { patchBrain({ recallK: parseInt(e.target.value) || 5 }); setDirty(true); }}
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
            value={brain.compactionTrigger}
            onChange={(e) => { patchBrain({ compactionTrigger: parseInt(e.target.value) || 28 }); setDirty(true); }}
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
            value={brain.compactionKeep}
            onChange={(e) => { patchBrain({ compactionKeep: parseInt(e.target.value) || 12 }); setDirty(true); }}
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
  );
}
