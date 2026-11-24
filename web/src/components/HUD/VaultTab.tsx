import { useEffect, useState } from "react";
import {
  getVaultStatus,
  getVaultCredentials,
  setVaultCredential,
  deleteVaultCredential,
  migrateVault,
  type VaultStatus,
  type VaultCredentialItem,
} from "../../lib/api";

type Translator = (key: string) => string;

interface VaultTabProps {
  t: Translator;
  lang?: string;
}

export default function VaultTab({ t, lang = "en" }: VaultTabProps) {
  const isAr = lang === "ar";
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [credentials, setCredentials] = useState<VaultCredentialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  // Filters & search
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");

  // Add secret dialog state
  const [isAdding, setIsAdding] = useState(false);
  const [newService, setNewService] = useState("api_keys");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const showMsg = (text: string, kind: "ok" | "err" = "ok") => {
    setMessage({ text, kind });
    setTimeout(() => setMessage(null), 4500);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [st, creds] = await Promise.all([
        getVaultStatus(),
        getVaultCredentials(),
      ]);
      setStatus(st);
      setCredentials(creds.credentials || []);
    } catch (e: any) {
      showMsg(e.message || "Failed to load vault data", "err");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim() || !newValue.trim()) {
      showMsg(isAr ? "يرجى إدخال اسم المفتاح والقيمة" : "Please enter both key and value", "err");
      return;
    }
    setActionLoading(true);
    try {
      await setVaultCredential(newService.trim(), newKey.trim(), newValue.trim());
      showMsg(isAr ? "تم حفظ المفتاح بنجاح في الخزينة" : "Secret saved successfully in vault", "ok");
      setIsAdding(false);
      setNewKey("");
      setNewValue("");
      await loadData();
    } catch (err: any) {
      showMsg(err.message || "Failed to save secret", "err");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (svc: string, k: string) => {
    const confirmMsg = isAr
      ? `هل أنت متأكد من حذف المفتاح '${k}' من خدمة '${svc}'؟`
      : `Are you sure you want to delete '${k}' from '${svc}'?`;
    if (!window.confirm(confirmMsg)) return;

    setActionLoading(true);
    try {
      await deleteVaultCredential(svc, k);
      showMsg(isAr ? "تم حذف المفتاح من الخزينة" : "Secret removed from vault", "ok");
      await loadData();
    } catch (err: any) {
      showMsg(err.message || "Failed to delete secret", "err");
    } finally {
      setActionLoading(false);
    }
  };

  const handleMigrate = async () => {
    setActionLoading(true);
    try {
      const res = await migrateVault();
      showMsg(
        isAr
          ? `تم نقل ${res.migrated_count} مفاتيح إلى الخزينة المشفرة بنجاح`
          : `Successfully migrated ${res.migrated_count} secret(s) to vault`,
        "ok"
      );
      await loadData();
    } catch (err: any) {
      showMsg(err.message || "Migration failed", "err");
    } finally {
      setActionLoading(false);
    }
  };

  // Distinct service categories
  const services = ["all", ...Array.from(new Set(credentials.map((c) => c.service)))];

  const filtered = credentials.filter((c) => {
    const matchSvc = serviceFilter === "all" || c.service === serviceFilter;
    const matchQuery =
      !search ||
      c.key.toLowerCase().includes(search.toLowerCase()) ||
      c.service.toLowerCase().includes(search.toLowerCase());
    return matchSvc && matchQuery;
  });

  return (
    <div className="space-y-6 text-sm text-jarvis-ice" dir={isAr ? "rtl" : "ltr"}>
      {/* ── Status Banner ── */}
      <div className="p-4 rounded-xl border border-jarvis-cyan/20 bg-jarvis-deep/40 backdrop-blur-md flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${
              status?.keyring_available
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
            }`}
          >
            {status?.keyring_available ? "🛡️" : "🔐"}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white tracking-wide">
                <bdi dir="auto">{isAr ? "خزينة بيانات الاعتماد والمفاتيح" : "Secure Keyring Vault"}</bdi>
              </h3>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  status?.keyring_available
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                }`}
              >
                <bdi dir="auto">
                  {status?.keyring_available
                    ? isAr
                      ? "نظام المفاتيح الآمن (OS Keyring)"
                      : "OS Keyring Active"
                    : isAr
                    ? "تشفير محلي (AES-256 Fallback)"
                    : "Encrypted File Fallback"}
                </bdi>
              </span>
            </div>
            <p className="text-xs text-white/50 mt-0.5">
              <bdi dir="auto">
                {status?.keyring_status || "Checking cryptographic storage status..."}
              </bdi>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/70">
            <bdi dir="auto">
              {isAr ? "إجمالي المفاتيح:" : "Stored secrets:"}{" "}
              <strong className="text-jarvis-cyan font-mono">
                {credentials.length}
              </strong>
            </bdi>
          </span>
          <button
            onClick={handleMigrate}
            disabled={actionLoading}
            className="px-3 py-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 hover:bg-purple-500/20 text-purple-200 text-xs font-medium transition disabled:opacity-50"
            title="Import all unencrypted keys from config.yaml into secure vault"
          >
            <bdi dir="auto">
              {actionLoading
                ? isAr
                  ? "جاري النقل…"
                  : "Migrating…"
                : isAr
                ? "⚡ ترحيل المفاتيح من Config"
                : "⚡ Migrate Config Keys"}
            </bdi>
          </button>
        </div>
      </div>

      {/* Message notice */}
      {message && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
            message.kind === "ok"
              ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-200"
              : "border-jarvis-danger/40 bg-red-950/40 text-red-200"
          }`}
        >
          <bdi dir="auto">{message.text}</bdi>
          <button onClick={() => setMessage(null)} className="opacity-60 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {/* ── Action Bar: Filters & New Secret ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? "بحث في المفاتيح أو الخدمات..." : "Search secrets or services..."}
            className="flex-1 max-w-sm h-8 px-3 rounded-lg bg-black/30 border border-white/10 text-xs text-white placeholder-white/30 focus:border-jarvis-cyan/50 focus:outline-none"
          />
          <div className="flex items-center gap-1 overflow-x-auto py-0.5">
            {services.map((svc) => (
              <button
                key={svc}
                onClick={() => setServiceFilter(svc)}
                className={`px-2.5 py-1 rounded-md text-xs font-mono transition ${
                  serviceFilter === svc
                    ? "bg-jarvis-cyan/20 border border-jarvis-cyan/50 text-jarvis-cyan"
                    : "bg-white/5 border border-white/10 text-white/50 hover:text-white"
                }`}
              >
                {svc}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => setIsAdding(!isAdding)}
          className="px-3 py-1.5 rounded-lg border border-jarvis-cyan/40 bg-jarvis-cyan/15 hover:bg-jarvis-cyan/25 text-jarvis-cyan text-xs font-medium transition flex items-center gap-1.5"
        >
          <span>{isAdding ? "✕" : "+"}</span>
          <bdi dir="auto">{isAdding ? (isAr ? "إلغاء" : "Cancel") : isAr ? "إضافة سر جديد" : "Add Secret"}</bdi>
        </button>
      </div>

      {/* ── Add Secret Form (Inline) ── */}
      {isAdding && (
        <form
          onSubmit={handleSaveSecret}
          className="p-4 rounded-xl border border-jarvis-cyan/30 bg-jarvis-deep/60 backdrop-blur-lg space-y-3"
        >
          <h4 className="text-xs font-semibold uppercase tracking-wider text-jarvis-cyan">
            <bdi dir="auto">{isAr ? "حفظ مفتاح أو اعتماد جديد" : "Store New Secret"}</bdi>
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-white/60 mb-1">
                <bdi dir="auto">{isAr ? "الخدمة / النطاق" : "Service / Scope"}</bdi>
              </label>
              <select
                value={newService}
                onChange={(e) => setNewService(e.target.value)}
                className="w-full h-8 px-2.5 rounded bg-black/40 border border-white/10 text-xs text-white focus:border-jarvis-cyan/50 focus:outline-none"
              >
                <option value="api_keys">api_keys</option>
                <option value="integrations">integrations</option>
                <option value="db_connections">db_connections</option>
                <option value="general">general</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-white/60 mb-1">
                <bdi dir="auto">{isAr ? "اسم المفتاح (معرف)" : "Key Identifier"}</bdi>
              </label>
              <input
                type="text"
                required
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="e.g. openai_custom_1"
                className="w-full h-8 px-2.5 rounded bg-black/40 border border-white/10 text-xs text-white focus:border-jarvis-cyan/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-white/60 mb-1">
                <bdi dir="auto">{isAr ? "القيمة السرية" : "Secret Value"}</bdi>
              </label>
              <input
                type="password"
                required
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="sk-..."
                className="w-full h-8 px-2.5 rounded bg-black/40 border border-white/10 text-xs text-white focus:border-jarvis-cyan/50 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-3 py-1 rounded border border-white/10 text-xs text-white/60 hover:text-white"
            >
              <bdi dir="auto">{isAr ? "إلغاء" : "Cancel"}</bdi>
            </button>
            <button
              type="submit"
              disabled={actionLoading}
              className="px-4 py-1 rounded border border-jarvis-cyan/40 bg-jarvis-cyan/20 hover:bg-jarvis-cyan/30 text-jarvis-cyan text-xs font-medium disabled:opacity-50"
            >
              <bdi dir="auto">{actionLoading ? (isAr ? "جاري الحفظ…" : "Saving…") : isAr ? "حفظ في الخزينة" : "Save to Vault"}</bdi>
            </button>
          </div>
        </form>
      )}

      {/* ── Credentials Table / Grid ── */}
      <div className="border border-white/10 rounded-xl overflow-hidden bg-black/20">
        <table className="w-full text-left border-collapse text-xs" dir="ltr">
          <thead>
            <tr className="border-b border-white/10 bg-white/5 text-white/60 uppercase font-mono tracking-wider text-[11px]">
              <th className="py-2.5 px-4 font-medium">Service</th>
              <th className="py-2.5 px-4 font-medium">Identifier</th>
              <th className="py-2.5 px-4 font-medium">Masked Secret</th>
              <th className="py-2.5 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-white/40">
                  <bdi dir="auto">{isAr ? "جاري تحميل المفاتيح من الخزينة..." : "Loading vault credentials..."}</bdi>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-white/40">
                  <bdi dir="auto">{isAr ? "لم يتم العثور على أي مفاتيح تطابق البحث" : "No secrets found matching filters."}</bdi>
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr key={`${item.service}:${item.key}`} className="hover:bg-white/[0.02] transition">
                  <td className="py-2.5 px-4">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono border border-jarvis-cyan/20 bg-jarvis-cyan/5 text-jarvis-cyan">
                      {item.service}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 font-mono font-medium text-white/90">
                    {item.key}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-white/40 text-[11px] tracking-wider">
                    {item.masked || "••••••••"}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <button
                      onClick={() => handleDelete(item.service, item.key)}
                      disabled={actionLoading}
                      className="px-2 py-1 rounded border border-jarvis-danger/30 text-jarvis-danger hover:bg-jarvis-danger/10 text-[11px] transition"
                      title="Delete credential from vault"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
