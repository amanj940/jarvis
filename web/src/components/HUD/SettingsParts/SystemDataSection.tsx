/**
 * Settings → System → Data sub-tab (chat/media/tools cleanup, session restore, settings import/export).
 * Extracted from Settings.tsx: JSX unchanged; the cleanup handlers and session-restore store
 * selectors live here. Settings export/import/reset stay in Settings (they touch all config state).
 */

import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from "react";
import { useStore } from "../../../lib/store";
import { authFetch } from "../../../lib/api";
import type { ConfirmDialogState } from "./constants";

export interface SystemDataSectionProps {
  exportSettings: () => void;
  handleImportSettings: (e: ChangeEvent<HTMLInputElement>) => void;
  resetSettingsToDefaults: () => void;
  settingsImportRef: RefObject<HTMLInputElement>;
  pushToast: (text: string, kind?: "ok" | "error") => void;
  setConfirmDialog: Dispatch<SetStateAction<ConfirmDialogState | null>>;
}

export default function SystemDataSection({
  exportSettings,
  handleImportSettings,
  resetSettingsToDefaults,
  settingsImportRef,
  pushToast,
  setConfirmDialog,
}: SystemDataSectionProps) {
  const clearChat = useStore((s) => s.clearChat);

  const clearMedia = useStore((s) => s.clearMedia);

  const clearTools = useStore((s) => s.clearTools);

  const setReader = useStore((s) => s.setReader);

  const prevSessionAvailable = useStore((s) => s.prevSessionAvailable);

  const restoreLastSession = useStore((s) => s.restoreLastSession);

  // ── Clean Slate ──────────────────────────────────────────────────────────
  const cleanSlate = async () => {
    clearChat();
    clearMedia();
    clearTools();
    setReader(null);
    try {
      await authFetch("/api/cleanslate", { method: "POST" });
      pushToast("Clean slate done. Conversation history wiped; memory preserved.");
    } catch {
      pushToast("Backend unreachable for clean slate", "error");
    }
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const exportChat = () => {
    const chat = useStore.getState().chat;
    const blob = new Blob([JSON.stringify(chat, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jarvis-chat-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast("Chat history exported");
  };

  return (
    <div className="space-y-5">
      {prevSessionAvailable && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-cyan-400 mb-3">Session</h3>
          <p className="text-slate-400 text-sm mb-4">A previous session was kept aside on launch.</p>
          <button onClick={() => restoreLastSession()}
            className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition">Restore previous session</button>
        </div>
      )}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-cyan-400 mb-3">Clear Data</h3>
        <button onClick={() => setConfirmDialog({ text: "Wipe chat history?", onYes: () => { clearChat(); setConfirmDialog(null); } })}
          className="w-full text-left px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition flex items-center justify-between">
          <span>Clear chat history</span><span className="text-xs text-slate-400">Conversation history</span>
        </button>
        <button onClick={() => setConfirmDialog({ text: "Wipe media bay?", onYes: () => { clearMedia(); setConfirmDialog(null); } })}
          className="w-full text-left px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition flex items-center justify-between">
          <span>Clear media bay</span><span className="text-xs text-slate-400">Images, videos, files</span>
        </button>
        <button onClick={() => setConfirmDialog({ text: "Wipe tool history?", onYes: () => { clearTools(); setConfirmDialog(null); } })}
          className="w-full text-left px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition flex items-center justify-between">
          <span>Clear tool history</span><span className="text-xs text-slate-400">Tool executions</span>
        </button>
      </div>
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-cyan-400 mb-3">Export Data</h3>
        <button onClick={exportChat}
          className="w-full px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition text-left">Export chat history (JSON)</button>
        <button onClick={() => pushToast("ZIP export coming soon")}
          className="w-full px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition text-left">Export all data (ZIP)</button>
      </div>
      {/* FG-019 / FG-020 (ported from ui): Settings Backup — export /
          import / reset. Import only fills the form — nothing is
          saved until Save is pressed. API keys are never in the
          file; they stay in the backend .env. */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-cyan-400 mb-3">Settings Backup</h3>
        <p className="text-xs text-slate-400">Export the current settings to a file, or import a previously exported file. Import only fills the form — nothing is saved until you press Save.</p>
        <button onClick={exportSettings}
          className="w-full px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition text-left">Export settings (JSON)</button>
        <input
          type="file"
          ref={settingsImportRef}
          accept=".json,application/json"
          className="hidden"
          onChange={handleImportSettings}
        />
        <button onClick={() => settingsImportRef.current?.click()}
          className="w-full px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition text-left">Import settings (JSON)</button>
        <button
          onClick={() => setConfirmDialog({ text: "Reset all settings to their defaults? Your API keys stay in the backend .env, but the form values will be replaced. Press Save afterwards to apply.", onYes: () => { resetSettingsToDefaults(); setConfirmDialog(null); } })}
          className="w-full px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition text-left">Reset settings to defaults</button>
      </div>
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-red-400 mb-3">Danger Zone</h3>
        <button
          onClick={() => setConfirmDialog({ text: "Run Clean Slate? This wipes chat, media, and tool history. Backend memory is preserved.", onYes: () => { cleanSlate(); setConfirmDialog(null); } })}
          className="w-full text-left px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-500 transition flex items-center justify-between">
          <span>Clean slate</span><span className="text-xs text-red-200">All session data</span>
        </button>
        <p className="text-xs text-slate-500">Backend memory (preferences, notes, fixes) is preserved.</p>
      </div>
    </div>
  );
}
