/**
 * Settings → System → Display sub-tab (theme, language, status bar, refresh rate, layouts).
 * Extracted from Settings.tsx: JSX unchanged; the setLanguage store selector lives here now.
 */

import type { Dispatch, SetStateAction } from "react";
import { useStore } from "../../../lib/store";
import { type Lang, useTranslations } from "../../../lib/i18n";
import { resetAllLayouts } from "../Floating";
import { Toggle } from "./ui";
import type { ConfirmDialogState } from "./constants";

export interface SystemDisplaySectionProps {
  theme: string;
  setTheme: Dispatch<SetStateAction<string>>;
  showEmojis: boolean;
  setShowEmojis: Dispatch<SetStateAction<boolean>>;
  showStatusBar: boolean;
  setShowStatusBar: Dispatch<SetStateAction<boolean>>;
  refreshInterval: number;
  setRefreshInterval: Dispatch<SetStateAction<number>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  setConfirmDialog: Dispatch<SetStateAction<ConfirmDialogState | null>>;
}

export default function SystemDisplaySection({
  theme,
  setTheme,
  showEmojis,
  setShowEmojis,
  showStatusBar,
  setShowStatusBar,
  refreshInterval,
  setRefreshInterval,
  setDirty,
  setConfirmDialog,
}: SystemDisplaySectionProps) {
  const lang = useStore((s) => s.language);
  const t = useTranslations(lang);

  const setLanguage = useStore((s) => s.setLanguage);

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-6">
      <div className="space-y-2">
        <label className="text-sm text-slate-300">{t("sys_interface_language")}</label>
        <select
          value={lang}
          onChange={(e) => setLanguage(e.target.value as Lang)}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white"
        >
          <option value="en">{t("sys_interface_lang_en")}</option>
          <option value="ar">{t("sys_interface_lang_ar")}</option>
        </select>
      </div>
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-cyan-400">Layout</h3>
        <button
          onClick={() => setConfirmDialog({ text: "Reset all panel positions?", onYes: () => { resetAllLayouts(); setConfirmDialog(null); } })}
          className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition">
          Reset panel layout
        </button>
      </div>
      <div className="border-t border-slate-700 pt-4 space-y-4">
        <h3 className="text-sm font-semibold text-cyan-400">Appearance</h3>
        <div className="space-y-2">
          <label className="text-sm text-slate-300">Theme</label>
          <select value={theme} onChange={(e) => { setTheme(e.target.value); setDirty(true); }}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white">
            <option value="jarvis">JARVIS (Default)</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
        <Toggle label="Show emojis" value={showEmojis} onChange={(v) => { setShowEmojis(v); setDirty(true); }} />
        <Toggle label="Show status bar" value={showStatusBar} onChange={(v) => { setShowStatusBar(v); setDirty(true); }} />
      </div>
      <div className="border-t border-slate-700 pt-4 space-y-4">
        <h3 className="text-sm font-semibold text-cyan-400">Performance</h3>
        <div className="space-y-2">
          <label className="text-sm text-slate-300">Stats refresh interval (ms)</label>
          <input type="number" value={refreshInterval}
            onChange={(e) => { setRefreshInterval(parseInt(e.target.value) || 1500); setDirty(true); }}
            min="500" max="5000" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white" />
        </div>
      </div>
    </div>
  );
}
