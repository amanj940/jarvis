/**
 * Settings → AI → Providers sub-tab (provider catalogue, bulk API-key import entry points).
 * Extracted from Settings.tsx: JSX unchanged; the file-upload handler moves with it.
 */

import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from "react";
import { useStore } from "../../../lib/store";
import { useTranslations } from "../../../lib/i18n";
import { PROVIDER_INFO, type KeyPoolItem } from "./constants";

export interface ProvidersSectionProps {
  apiKeyStatus: Record<string, boolean>;
  keyPools: Record<string, KeyPoolItem[]>;
  modalModelCounts: Record<string, number>;
  openProviderConfig: (prov: string) => Promise<void>;
  bulkFileInputRef: RefObject<HTMLInputElement>;
  bulkImporting: boolean;
  bulkProvider: string;
  handleBulkImport: (textToImport: string, prov?: string) => Promise<void>;
  setBulkText: Dispatch<SetStateAction<string>>;
  setShowBulkModal: Dispatch<SetStateAction<boolean>>;
}

export default function ProvidersSection({
  apiKeyStatus,
  keyPools,
  modalModelCounts,
  openProviderConfig,
  bulkFileInputRef,
  bulkImporting,
  bulkProvider,
  handleBulkImport,
  setBulkText,
  setShowBulkModal,
}: ProvidersSectionProps) {
  const lang = useStore((s) => s.language);
  const t = useTranslations(lang);

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
                {count ? <><bdi>{count}</bdi> {t("models_avail")}</> : t("configured")}
              </span>
            : <span className="text-amber-400/80 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                {t("not_configured")}
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
          {hasKey ? t("edit") : t("configure")}
        </button>
      </div>
    );
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
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

  return (
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

      {/* Free Tier Banner */}
      <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900/80 to-teal-950/40 border border-emerald-500/30 rounded-2xl p-5 shadow-xl">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-2xl shrink-0">🆓</div>
          <div>
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              مزودون مجانيون بدون مفتاح API
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">NO API KEY REQUIRED</span>
            </h3>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              هذه المزودات تعمل فوراً بدون تسجيل أو مفاتيح. يمكنك اختيارها كمزود رئيسي أو احتياطي لضمان استمرارية الخدمة.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 font-mono">Kilo: 200 req/hr</span>
              <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 font-mono">Pollinations: Unlimited</span>
              <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 font-mono">OVHcloud: 2 req/min</span>
            </div>
          </div>
        </div>
      </div>

      {/* Free Tier Providers */}
      <section>
        <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-widest mb-4">🆓 Free / No-Key Providers</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(PROVIDER_INFO)
            .filter(([pid]) => ["kilo", "pollinations", "ovhcloud"].includes(pid))
            .map(([pid, info]) => <ProviderCard key={pid} pid={pid} info={info} />)}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">☁️ Cloud Providers</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {cloudProviders.map(([pid, info]) => <ProviderCard key={pid} pid={pid} info={info} />)}
        </div>
      </section>
      <section>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">🏠 Local Providers</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {localProviders.map(([pid, info]) => <ProviderCard key={pid} pid={pid} info={info} />)}
        </div>
      </section>
    </div>
  );
}
