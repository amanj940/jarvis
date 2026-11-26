/**
 * Settings → AI → Council sub-tab (multi-model council, benchmark leaderboard, dynamic roster).
 * Extracted from Settings.tsx: JSX unchanged; the council/benchmark run state and the
 * auto-benchmark handler live here now.
 */

import { useState, type Dispatch, type SetStateAction } from "react";
import { useStore } from "../../../lib/store";
import { useTranslations } from "../../../lib/i18n";
import { authFetch } from "../../../lib/api";
import type { BenchmarkEntry, KeyPoolItem, RosterMember } from "./constants";

export interface CouncilSectionProps {
  apiKeyStatus: Record<string, boolean>;
  benchmarkLeaderboard: BenchmarkEntry[];
  dynamicRoster: RosterMember[];
  keyPools: Record<string, KeyPoolItem[]>;
  model: string;
  openProviderConfig: (prov: string) => Promise<void>;
  provider: string;
  pushToast: (text: string, kind?: "ok" | "error") => void;
  setBenchmarkLeaderboard: Dispatch<SetStateAction<BenchmarkEntry[]>>;
  setDynamicRoster: Dispatch<SetStateAction<RosterMember[]>>;
}

export default function CouncilSection({
  apiKeyStatus,
  benchmarkLeaderboard,
  dynamicRoster,
  keyPools,
  model,
  openProviderConfig,
  provider,
  pushToast,
  setBenchmarkLeaderboard,
  setDynamicRoster,
}: CouncilSectionProps) {
  const lang = useStore((s) => s.language);
  const t = useTranslations(lang);

  const [councilTopic, setCouncilTopic] = useState("");

  const [councilRunning, setCouncilRunning] = useState(false);

  const [benchmarkRunning, setBenchmarkRunning] = useState(false);

  const [councilResult, setCouncilResult] = useState<{
    topic: string;
    members: Array<{ id: string; name: string; icon: string; role: string }>;
    proposals: Array<{ member_id: string; member_name: string; icon: string; model: string; content: string }>;
    peer_critiques: Array<{ member_id: string; member_name: string; icon: string; model: string; critique: string }>;
    consensus: string;
    agreement_score: number;
  } | null>(null);

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

  return (
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
  );
}
