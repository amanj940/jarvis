/**
 * Compact platform inspector modal used by the Settings integrations tab.
 * Extracted verbatim from Settings.tsx (no logic changes).
 */

import { useState } from "react";
import { type Lang, useTranslations } from "../../../lib/i18n";
import { testMcpServer, testIntegration } from "../../../lib/api";

// ── PlatformDetailModal — COMPACT inline replacement for audit/fixes
// web/src/components/HUD/PlatformDetailModal.tsx, which re-exports
// ../Platforms/PlatformDetailModal + ./views/* (YouTube/Telegram/Email/
// Social/GitHub/Database/Filesystem/Calendar views). That whole tree cannot
// be pushed here (only Settings.tsx + api.ts), so this inspector keeps the
// same props and the same user-visible job — inspect a platform's server /
// integration config and run its Test action — without the per-platform
// studio views. Deliberate scope cut; see the file header.
interface PlatformDetailModalProps {
  platformId: string;
  platformName: string;
  platformIcon: string;
  serverConfig?: any;
  integrationConfig?: any;
  lang: Lang;
  onClose: () => void;
  onToast: (msg: string, kind?: "ok" | "error") => void;
}

function PlatformDetailModal({ platformId, platformName, platformIcon, serverConfig, integrationConfig, lang, onClose, onToast }: PlatformDetailModalProps) {
  const t = useTranslations(lang);
  const [testing, setTesting] = useState(false);
  const testable = ["email", "telegram", "home_assistant", "calendar"].includes(platformId);
  const handleTest = async () => {
    setTesting(true);
    try {
      if (serverConfig) {
        const d = await testMcpServer(platformId);
        onToast(d?.ok ? `✓ ${platformName}: ${d.message || "reachable"}` : `Test failed: ${d?.error || "endpoint unavailable"}`, d?.ok ? "ok" : "error");
      } else if (testable) {
        const d = await testIntegration(platformId as "email" | "telegram" | "home_assistant" | "calendar", integrationConfig || {});
        onToast(d?.ok ? `✓ ${platformName}: ${d.message || "OK"}` : `Test failed: ${d?.error || "endpoint unavailable"}`, d?.ok ? "ok" : "error");
      }
    } catch (e: any) {
      onToast(`Test failed: ${e?.message || "unreachable"}`, "error");
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h3 className="font-bold text-white flex items-center gap-2"><span>{platformIcon}</span>{platformName}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          {serverConfig && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">MCP Server</h4>
              <pre className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">{JSON.stringify(serverConfig, null, 2)}</pre>
            </div>
          )}
          {integrationConfig && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Integration Config</h4>
              <pre className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">{JSON.stringify(integrationConfig, null, 2)}</pre>
            </div>
          )}
          {!serverConfig && !integrationConfig && (
            <p className="text-sm text-slate-400">No server or integration config stored for this platform yet.</p>
          )}
          <p className="text-[11px] text-slate-500">Full per-platform studio views (YouTube/Telegram/Email/…) live in the audit/fixes Platforms tree and are not part of this merge.</p>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700">
          {(serverConfig || testable) && (
            <button onClick={handleTest} disabled={testing} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold transition disabled:opacity-40">
              {testing ? t("testing") : `🔬 ${t("test_connection")}`}
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-sm transition">✕ {t("close")}</button>
        </div>
      </div>
    </div>
  );
}

export default PlatformDetailModal;
