/**
 * Settings → AI → Swarm sub-tab (parallel task runner).
 * Extracted from Settings.tsx: JSX unchanged; the swarm-only state (tasks, running flag,
 * results) lives here now. No props: it depends on nothing else in Settings.
 */

import { useState } from "react";
import { useStore } from "../../../lib/store";
import { useTranslations } from "../../../lib/i18n";
import { authFetch } from "../../../lib/api";

export default function SwarmSection() {
  const lang = useStore((s) => s.language);
  const t = useTranslations(lang);

  const [swarmTasks, setSwarmTasks] = useState([
    { role: "researcher", goal: "ابحث عن أفضل استراتيجيات التخزين المؤقت وحجم استهلاك الذاكرة." },
    { role: "coder", goal: "اكتب وحدة بايثون Asyncio لتطبيق LRU Cache مع اختبارات وحدة دقيقة." },
  ]);

  const [swarmRunning, setSwarmRunning] = useState(false);

  const [swarmResults, setSwarmResults] = useState<any[]>([]);

  return (
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
  );
}
