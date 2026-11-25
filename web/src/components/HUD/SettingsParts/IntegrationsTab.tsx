/**
 * Settings → Integrations tab (email, Telegram, Home Assistant, calendar, social platforms).
 * Extracted from Settings.tsx: JSX unchanged; the integration-test state/handlers
 * (integrationTesting, integrationHistory, handleTest*, renderTestHistory) live here now.
 */

import { useState, type Dispatch, type SetStateAction } from "react";
import { useStore } from "../../../lib/store";
import { useTranslations } from "../../../lib/i18n";
import { testIntegration } from "../../../lib/api";
import { Toggle } from "./ui";
import type { IntegrationsConfig, PlatformModalTarget } from "./constants";

export interface IntegrationsTabProps {
  integrations: IntegrationsConfig;
  setIntegrations: Dispatch<SetStateAction<IntegrationsConfig>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  saveConfig: () => Promise<void>;
  pushToast: (text: string, kind?: "ok" | "error") => void;
  setSelectedPlatformModal: Dispatch<SetStateAction<PlatformModalTarget | null>>;
}

export default function IntegrationsTab({
  integrations,
  setIntegrations,
  setDirty,
  saveConfig,
  pushToast,
  setSelectedPlatformModal,
}: IntegrationsTabProps) {
  const lang = useStore((s) => s.language);
  const t = useTranslations(lang);

  const [integrationTesting, setIntegrationTesting] = useState<Record<string, { loading: boolean; success?: boolean; msg?: string; latency?: number }>>({});

  // FG-014 / FG-016 (ported from ui): per-integration test history, last 10
  // runs kept in localStorage, last 5 shown. Purely local; no backend call.
  const [integrationHistory, setIntegrationHistory] = useState<
    Record<string, Array<{ ok: boolean; msg: string; latency?: number; at: string }>>
  >(() => {
    try {
      return JSON.parse(localStorage.getItem("jarvis_integration_test_history") || "{}");
    } catch {
      return {};
    }
  });

  // FG-014 / FG-016 (ported from ui): test one integration and record the
  // run in history. Latency prefers the backend-reported latency_ms and
  // falls back to client-measured time.
  const handleTestIntegration = async (type: "email" | "telegram" | "home_assistant" | "calendar") => {
    setIntegrationTesting((prev) => ({ ...prev, [type]: { loading: true } }));
    const started = Date.now();
    const record = (ok: boolean, msg: string, latency: number) => {
      const entry = { ok, msg, latency, at: new Date().toISOString() };
      setIntegrationTesting((prev) => ({ ...prev, [type]: { loading: false, success: ok, msg, latency } }));
      setIntegrationHistory((prev) => {
        const next = { ...prev, [type]: [entry, ...(prev[type] || [])].slice(0, 10) };
        try {
          localStorage.setItem("jarvis_integration_test_history", JSON.stringify(next));
        } catch {
          // storage unavailable — history stays in memory only
        }
        return next;
      });
    };
    try {
      const payload = (integrations as any)[type] || {};
      const res = await testIntegration(type, payload);
      const latency = res.latency_ms ?? (Date.now() - started);
      if (res.ok) {
        record(true, res.message, latency);
        pushToast(`✓ ${type.replace("_", " ").toUpperCase()}: ${res.message} (${latency}ms)`);
      } else {
        record(false, res.error, latency);
        pushToast(`${type.toUpperCase()} error: ${res.error}`, "error");
      }
    } catch (err: any) {
      const latency = Date.now() - started;
      record(false, err?.message || "Failed", latency);
      pushToast(`Failed to test ${type}: ${err?.message || "Error"}`, "error");
    }
  };

  // FG-016 (ported from ui): test every integration in turn, sequentially,
  // so each result lands in the same localStorage history as a single test.
  const handleTestAllIntegrations = async () => {
    setIntegrationTesting((prev) => ({ ...prev, all: { loading: true } }));
    try {
      for (const t of ["email", "telegram", "home_assistant", "calendar"] as const) {
        await handleTestIntegration(t);
      }
      setIntegrationTesting((prev) => ({ ...prev, all: { loading: false, success: true } }));
    } catch {
      setIntegrationTesting((prev) => ({ ...prev, all: { loading: false, success: false } }));
    }
  };

  // FG-014: per-integration test history (last 5 shown).
  const renderTestHistory = (type: "email" | "telegram" | "home_assistant" | "calendar") => {
    const hist = integrationHistory[type] || [];
    if (hist.length === 0) return null;
    return (
      <div className="pt-2 border-t border-slate-700/50 space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">
          Test history (last {Math.min(hist.length, 5)})
        </div>
        {hist.slice(0, 5).map((h, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
            <span className={h.ok ? "text-emerald-400" : "text-rose-400"}>{h.ok ? "✓" : "✗"}</span>
            <span className="text-slate-500">{new Date(h.at).toLocaleString()}</span>
            <span className="truncate">{h.msg || (h.ok ? "OK" : "failed")}</span>
            {h.latency !== undefined && <span className="text-slate-500">{h.latency}ms</span>}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-700/50 pb-5">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <span>🌐</span> {t("integrations_title")}
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            {t("integrations_desc")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono px-3 py-1.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {t("integrations_sync")}
          </span>
          <button
            onClick={handleTestAllIntegrations}
            disabled={integrationTesting.all?.loading}
            className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 flex items-center gap-1.5 transition"
            title="Test every integration in turn (FG-016)"
          >
            {integrationTesting.all?.loading ? "⏳ Testing All" : "🔬 Test All"}
          </button>
        </div>
      </div>

      {/* Account Authorization Banner (Gmail & Google Account) */}
      <div className="bg-gradient-to-r from-cyan-950/40 via-slate-900/90 to-blue-950/40 border border-cyan-500/30 rounded-2xl p-5 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-2xl shrink-0 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
            📬
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-white text-base">{t("integrations_google_title")}</h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                LOCKED PROFILE
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              {t("integrations_google_desc")} (<code className="text-cyan-300 font-mono font-semibold">{integrations.email?.username || "your@gmail.com"}</code>).
            </p>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span className="text-xs font-mono px-3 py-1.5 rounded-xl bg-slate-800 text-slate-200 border border-slate-700">
            Profile: Default
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Email SMTP */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white flex items-center gap-2">
                <span>📧</span> Email (SMTP / Gmail)
              </h3>
              <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {integrations.email?.has_credentials ? "App Password Configured in .env" : integrations.email?.username ? `Linked: ${integrations.email.username}` : "Not configured"}
              </span>
            </div>
            <Toggle
              label=""
              value={integrations.email?.enabled ?? true}
              onChange={(v) => { setIntegrations((p) => ({ ...p, email: { ...p.email, enabled: v } })); setDirty(true); }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">SMTP Host</label>
              <input type="text" value={integrations.email?.smtp_host || "smtp.gmail.com"}
                onChange={(e) => { setIntegrations((p) => ({ ...p, email: { ...p.email, smtp_host: e.target.value } })); setDirty(true); }}
                placeholder="smtp.gmail.com" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Port</label>
              <input type="number" value={integrations.email?.smtp_port || 587}
                onChange={(e) => { setIntegrations((p) => ({ ...p, email: { ...p.email, smtp_port: parseInt(e.target.value) || 587 } })); setDirty(true); }}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
            <div className="space-y-1 col-span-2">
              <label className="text-xs text-slate-400">Username (Google Account)</label>
              <input type="text" value={integrations.email?.username || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, email: { ...p.email, username: e.target.value } })); setDirty(true); }}
                placeholder="your@gmail.com" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
            <div className="space-y-1 col-span-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400">Google App Password (16-character key)</label>
                {integrations.email?.has_credentials && (
                  <span className="text-[10px] text-emerald-400 font-mono">✓ Saved in .env</span>
                )}
              </div>
              <input type="password" value={integrations.email?.password || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, email: { ...p.email, password: e.target.value } })); setDirty(true); }}
                placeholder={integrations.email?.has_credentials ? "•••••••• (محفوظ في .env — ادخل كلمة مرور جديدة للاستبدال)" : "xxxx xxxx xxxx xxxx (App Password)"}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
            <div className="text-xs">
              {integrationTesting.email?.success ? (
                <span className="text-emerald-400 font-mono text-[11px] flex items-center gap-1">
                  <span>✓</span> {integrationTesting.email.msg} (<bdi>{integrationTesting.email.latency}ms</bdi>)
                </span>
              ) : integrationTesting.email?.msg ? (
                <span className="text-rose-400 font-mono text-[11px] flex items-center gap-1">
                  <span>✕</span> {integrationTesting.email.msg}
                </span>
              ) : (
                <span className="text-slate-500 text-[11px] font-mono">SMTP Handshake Ready</span>
              )}
              <span className="text-[10px] text-slate-400 font-mono ml-2">
                Rate limit: 500/day
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  setSelectedPlatformModal({
                    id: "email",
                    name: "Email (SMTP / Gmail)",
                    icon: "📧",
                    integrationConfig: integrations.email,
                  })
                }
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
                title="Inspect Platform"
              >
                📊 {t("inspect_platform")}
              </button>
              <button
                onClick={() => handleTestIntegration("email")}
                disabled={integrationTesting.email?.loading}
                className="px-3 py-1.5 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-800/40 text-cyan-300 rounded-lg text-xs font-mono transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {integrationTesting.email?.loading ? (
                  <span className="animate-pulse">{t("testing")}</span>
                ) : (
                  <span>🔬 {t("test_connection")}</span>
                )}
              </button>
            </div>
          </div>
          {renderTestHistory("email")}
        </div>

        {/* Telegram Bot */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white flex items-center gap-2">
                <span>✈️</span> Telegram Bot
              </h3>
              <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {integrations.telegram?.has_token ? "Bot Token & Chat ID Active in .env" : "Telegram Bot"}
              </span>
            </div>
            <Toggle
              label=""
              value={integrations.telegram?.enabled ?? true}
              onChange={(v) => { setIntegrations((p) => ({ ...p, telegram: { ...p.telegram, enabled: v } })); setDirty(true); }}
            />
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400">Bot Token</label>
                {integrations.telegram?.has_token && (
                  <span className="text-[10px] text-emerald-400 font-mono">✓ Key Active in .env</span>
                )}
              </div>
              <input type="password" value={integrations.telegram?.bot_token || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, telegram: { ...p.telegram, bot_token: e.target.value } })); setDirty(true); }}
                placeholder={integrations.telegram?.has_token ? "•••••••• (Token محفوظ في .env — ادخل رمز جديد للتعديل)" : "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Default Chat ID</label>
              <input type="text" value={integrations.telegram?.chat_id || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, telegram: { ...p.telegram, chat_id: e.target.value } })); setDirty(true); }}
                placeholder="123456789" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
            <div className="text-xs">
              {integrationTesting.telegram?.success ? (
                <span className="text-emerald-400 font-mono text-[11px] flex items-center gap-1">
                  <span>✓</span> {integrationTesting.telegram.msg} (<bdi>{integrationTesting.telegram.latency}ms</bdi>)
                </span>
              ) : integrationTesting.telegram?.msg ? (
                <span className="text-rose-400 font-mono text-[11px] flex items-center gap-1">
                  <span>✕</span> {integrationTesting.telegram.msg}
                </span>
              ) : (
                <span className="text-slate-500 text-[11px] font-mono">Telegram API Ready</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  setSelectedPlatformModal({
                    id: "telegram",
                    name: "Telegram Bot",
                    icon: "✈️",
                    integrationConfig: integrations.telegram,
                  })
                }
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
                title="Inspect Platform"
              >
                📊 {t("inspect_platform")}
              </button>
              <button
                onClick={() => handleTestIntegration("telegram")}
                disabled={integrationTesting.telegram?.loading}
                className="px-3 py-1.5 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-800/40 text-cyan-300 rounded-lg text-xs font-mono transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {integrationTesting.telegram?.loading ? (
                  <span className="animate-pulse">{t("testing")}</span>
                ) : (
                  <span>🔬 {t("test_connection")}</span>
                )}
              </button>
            </div>
          </div>
          {renderTestHistory("telegram")}
        </div>

        {/* Calendar */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white flex items-center gap-2"><span>📅</span> Calendar (iCal Google Sync)</h3>
              <span className="text-[10px] font-mono text-cyan-400 flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                Google Calendar Linked
              </span>
            </div>
            <Toggle
              label=""
              value={integrations.calendar?.enabled ?? false}
              onChange={(v) => { setIntegrations((p) => ({ ...p, calendar: { ...p.calendar, enabled: v } })); setDirty(true); }}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">ICS URL (Google Calendar / Outlook)</label>
            <input type="text" value={integrations.calendar?.ical_url || ""}
              onChange={(e) => { setIntegrations((p) => ({ ...p, calendar: { ...p.calendar, ical_url: e.target.value } })); setDirty(true); }}
              placeholder="https://calendar.google.com/calendar/ical/your-email/public/basic.ics"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
          </div>

          <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
            <div className="text-xs">
              {integrationTesting.calendar?.success ? (
                <span className="text-emerald-400 font-mono text-[11px] flex items-center gap-1">
                  <span>✓</span> {integrationTesting.calendar.msg} (<bdi>{integrationTesting.calendar.latency}ms</bdi>)
                </span>
              ) : integrationTesting.calendar?.msg ? (
                <span className="text-rose-400 font-mono text-[11px] flex items-center gap-1">
                  <span>✕</span> {integrationTesting.calendar.msg}
                </span>
              ) : (
                <span className="text-slate-500 text-[11px] font-mono">iCal Stream Ready</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  setSelectedPlatformModal({
                    id: "calendar",
                    name: "Google Calendar (iCal)",
                    icon: "📅",
                    integrationConfig: integrations.calendar,
                  })
                }
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
                title="Inspect Platform"
              >
                📊 {t("inspect_platform")}
              </button>
              <button
                onClick={() => handleTestIntegration("calendar")}
                disabled={integrationTesting.calendar?.loading}
                className="px-3 py-1.5 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-800/40 text-cyan-300 rounded-lg text-xs font-mono transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {integrationTesting.calendar?.loading ? (
                  <span className="animate-pulse">{t("testing")}</span>
                ) : (
                  <span>🔬 {t("test_connection")}</span>
                )}
              </button>
            </div>
          </div>
          {renderTestHistory("calendar")}
        </div>

        {/* Home Assistant */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white flex items-center gap-2"><span>🏠</span> Home Assistant</h3>
              <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1 mt-0.5">
                {integrations.home_assistant?.has_token ? "🟢 Connected (.env)" : "⚪ Ready for Local Token"}
              </span>
            </div>
            <Toggle
              label=""
              value={integrations.home_assistant?.enabled ?? false}
              onChange={(v) => { setIntegrations((p) => ({ ...p, home_assistant: { ...p.home_assistant, enabled: v } })); setDirty(true); }}
            />
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">URL</label>
              <input type="text" value={integrations.home_assistant?.url || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, home_assistant: { ...p.home_assistant, url: e.target.value } })); setDirty(true); }}
                placeholder="http://homeassistant.local:8123"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400">Long-Lived Access Token</label>
                {integrations.home_assistant?.has_token && (
                  <span className="text-[10px] text-emerald-400 font-mono">✓ Token Saved in .env</span>
                )}
              </div>
              <input type="password" value={integrations.home_assistant?.token || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, home_assistant: { ...p.home_assistant, token: e.target.value } })); setDirty(true); }}
                placeholder={integrations.home_assistant?.has_token ? "•••••••• (Token محفوظ في .env)" : "Bearer token"}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
            <div className="text-xs">
              {integrationTesting.home_assistant?.success ? (
                <span className="text-emerald-400 font-mono text-[11px] flex items-center gap-1">
                  <span>✓</span> {integrationTesting.home_assistant.msg} (<bdi>{integrationTesting.home_assistant.latency}ms</bdi>)
                </span>
              ) : integrationTesting.home_assistant?.msg ? (
                <span className="text-rose-400 font-mono text-[11px] flex items-center gap-1">
                  <span>✕</span> {integrationTesting.home_assistant.msg}
                </span>
              ) : (
                <span className="text-slate-500 text-[11px] font-mono">REST API Ready</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  setSelectedPlatformModal({
                    id: "home_assistant",
                    name: "Home Assistant",
                    icon: "🏠",
                    integrationConfig: integrations.home_assistant,
                  })
                }
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
                title="Inspect Platform"
              >
                📊 {t("inspect_platform")}
              </button>
              <button
                onClick={() => handleTestIntegration("home_assistant")}
                disabled={integrationTesting.home_assistant?.loading}
                className="px-3 py-1.5 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-800/40 text-cyan-300 rounded-lg text-xs font-mono transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {integrationTesting.home_assistant?.loading ? (
                  <span className="animate-pulse">{t("testing")}</span>
                ) : (
                  <span>🔬 {t("test_connection")}</span>
                )}
              </button>
            </div>
          </div>
          {renderTestHistory("home_assistant")}
        </div>

        {/* YouTube Channel */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white flex items-center gap-2"><span>▶️</span> YouTube Channel (OAuth & API)</h3>
              <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1 mt-0.5">
                {integrations.youtube?.has_token || integrations.youtube?.channel_id ? "🟢 Configured" : "⚪ YouTube Creator Tools"}
              </span>
            </div>
            <Toggle
              label=""
              value={integrations.youtube?.enabled ?? false}
              onChange={(v) => { setIntegrations((p) => ({ ...p, youtube: { ...(p.youtube || { client_id: "", client_secret: "", refresh_token: "", channel_id: "", enabled: false }), enabled: v } })); setDirty(true); }}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Channel ID</label>
              <input type="text" value={integrations.youtube?.channel_id || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, youtube: { ...(p.youtube || { client_id: "", client_secret: "", refresh_token: "", channel_id: "", enabled: false }), channel_id: e.target.value } })); setDirty(true); }}
                placeholder="UCxxxxxxxxxxxx" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Client ID</label>
              <input type="text" value={integrations.youtube?.client_id || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, youtube: { ...(p.youtube || { client_id: "", client_secret: "", refresh_token: "", channel_id: "", enabled: false }), client_id: e.target.value } })); setDirty(true); }}
                placeholder="apps.googleusercontent.com" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Client Secret</label>
              <input type="password" value={integrations.youtube?.client_secret || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, youtube: { ...(p.youtube || { client_id: "", client_secret: "", refresh_token: "", channel_id: "", enabled: false }), client_secret: e.target.value } })); setDirty(true); }}
                placeholder={integrations.youtube?.has_secret ? "•••••••• (محفوظ في .env)" : "GOCSPX-..."}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Refresh Token</label>
              <input type="password" value={integrations.youtube?.refresh_token || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, youtube: { ...(p.youtube || { client_id: "", client_secret: "", refresh_token: "", channel_id: "", enabled: false }), refresh_token: e.target.value } })); setDirty(true); }}
                placeholder={integrations.youtube?.has_token ? "•••••••• (محفوظ في .env)" : "1//04..."}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
            <span className="text-slate-500 text-[11px] font-mono">YouTube Data API Ready</span>
            <button
              onClick={() =>
                setSelectedPlatformModal({
                  id: "youtube",
                  name: "YouTube Channel",
                  icon: "▶️",
                  integrationConfig: integrations.youtube,
                })
              }
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
              title="Inspect Platform"
            >
              📊 {t("inspect_platform")}
            </button>
          </div>
        </div>

        {/* Facebook Page */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white flex items-center gap-2"><span>📘</span> Facebook Page</h3>
              <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1 mt-0.5">
                {integrations.facebook?.has_token ? "🟢 Token Configured in .env" : "⚪ Standby"}
              </span>
            </div>
            <Toggle
              label=""
              value={integrations.facebook?.enabled ?? false}
              onChange={(v) => { setIntegrations((p) => ({ ...p, facebook: { ...(p.facebook || { page_id: "", page_access_token: "", enabled: false }), enabled: v } })); setDirty(true); }}
            />
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Page ID</label>
              <input type="text" value={integrations.facebook?.page_id || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, facebook: { ...(p.facebook || { page_id: "", page_access_token: "", enabled: false }), page_id: e.target.value } })); setDirty(true); }}
                placeholder="1029384756..." className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Page Access Token</label>
              <input type="password" value={integrations.facebook?.page_access_token || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, facebook: { ...(p.facebook || { page_id: "", page_access_token: "", enabled: false }), page_access_token: e.target.value } })); setDirty(true); }}
                placeholder={integrations.facebook?.has_token ? "•••••••• (محفوظ في .env)" : "EAABsbCS1iHg..."}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
            <span className="text-slate-500 text-[11px] font-mono">Meta Graph API Ready</span>
            <button
              onClick={() =>
                setSelectedPlatformModal({
                  id: "facebook",
                  name: "Facebook Page",
                  icon: "📘",
                  integrationConfig: integrations.facebook,
                })
              }
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
              title="Inspect Platform"
            >
              📊 {t("inspect_platform")}
            </button>
          </div>
        </div>

        {/* Instagram Business / Creator */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white flex items-center gap-2"><span>📸</span> Instagram Business / Creator</h3>
              <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1 mt-0.5">
                {integrations.instagram?.has_token ? "🟢 Connected (.env)" : "⚪ Ready for Graph Token"}
              </span>
            </div>
            <Toggle
              label=""
              value={integrations.instagram?.enabled ?? false}
              onChange={(v) => { setIntegrations((p) => ({ ...p, instagram: { ...(p.instagram || { user_id: "", access_token: "", enabled: false }), enabled: v } })); setDirty(true); }}
            />
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Instagram User ID (Business Account ID)</label>
              <input type="text" value={integrations.instagram?.user_id || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, instagram: { ...(p.instagram || { user_id: "", access_token: "", enabled: false }), user_id: e.target.value } })); setDirty(true); }}
                placeholder="17841400000000000" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Instagram Graph Access Token</label>
              <input type="password" value={integrations.instagram?.access_token || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, instagram: { ...(p.instagram || { user_id: "", access_token: "", enabled: false }), access_token: e.target.value } })); setDirty(true); }}
                placeholder={integrations.instagram?.has_token ? "•••••••• (محفوظ في .env)" : "EAA..."}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
            <span className="text-slate-500 text-[11px] font-mono">Instagram Graph API</span>
            <button
              onClick={() =>
                setSelectedPlatformModal({
                  id: "instagram",
                  name: "Instagram Business",
                  icon: "📸",
                  integrationConfig: integrations.instagram,
                })
              }
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
              title="Inspect Platform"
            >
              📊 {t("inspect_platform")}
            </button>
          </div>
        </div>

        {/* TikTok Creator */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4 hover:border-cyan-500/40 transition">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white flex items-center gap-2"><span>🎵</span> TikTok Creator</h3>
              <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1 mt-0.5">
                {integrations.tiktok?.has_token ? "🟢 Connected (.env)" : "⚪ Ready for Open ID"}
              </span>
            </div>
            <Toggle
              label=""
              value={integrations.tiktok?.enabled ?? false}
              onChange={(v) => { setIntegrations((p) => ({ ...p, tiktok: { ...(p.tiktok || { client_key: "", client_secret: "", access_token: "", open_id: "", enabled: false }), enabled: v } })); setDirty(true); }}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Client Key</label>
              <input type="text" value={integrations.tiktok?.client_key || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, tiktok: { ...(p.tiktok || { client_key: "", client_secret: "", access_token: "", open_id: "", enabled: false }), client_key: e.target.value } })); setDirty(true); }}
                placeholder="aw..." className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Open ID</label>
              <input type="text" value={integrations.tiktok?.open_id || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, tiktok: { ...(p.tiktok || { client_key: "", client_secret: "", access_token: "", open_id: "", enabled: false }), open_id: e.target.value } })); setDirty(true); }}
                placeholder="user open_id" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Client Secret</label>
              <input type="password" value={integrations.tiktok?.client_secret || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, tiktok: { ...(p.tiktok || { client_key: "", client_secret: "", access_token: "", open_id: "", enabled: false }), client_secret: e.target.value } })); setDirty(true); }}
                placeholder={integrations.tiktok?.has_secret ? "•••••••• (محفوظ في .env)" : "client secret"}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Access Token</label>
              <input type="password" value={integrations.tiktok?.access_token || ""}
                onChange={(e) => { setIntegrations((p) => ({ ...p, tiktok: { ...(p.tiktok || { client_key: "", client_secret: "", access_token: "", open_id: "", enabled: false }), access_token: e.target.value } })); setDirty(true); }}
                placeholder={integrations.tiktok?.has_token ? "•••••••• (محفوظ في .env)" : "act.xxxx..."}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono" />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
            <span className="text-slate-500 text-[11px] font-mono">TikTok Content API</span>
            <button
              onClick={() =>
                setSelectedPlatformModal({
                  id: "tiktok",
                  name: "TikTok Creator",
                  icon: "🎵",
                  integrationConfig: integrations.tiktok,
                })
              }
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-mono transition flex items-center gap-1 cursor-pointer"
              title="Inspect Platform"
            >
              📊 {t("inspect_platform")}
            </button>
          </div>
        </div>
      </div>

      <button onClick={saveConfig}
        className="w-full px-4 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl transition font-semibold font-mono text-sm shadow-[0_0_20px_rgba(34,211,238,0.25)] flex items-center justify-center gap-2">
        <span>💾</span> Save Integrations & Sync with .env
      </button>
    </div>
  );
}
