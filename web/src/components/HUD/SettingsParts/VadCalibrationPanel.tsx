/**
 * Settings → System → Voice: VAD calibration panel (silence/baseline/barge-in/Silero/filters).
 * Extracted from Settings.tsx: JSX unchanged. State stays owned by Settings (it is part of the
 * saved config); this component edits it through `vad` / `setVad`.
 */

import type { Dispatch, SetStateAction } from "react";
import { useStore } from "../../../lib/store";
import { useTranslations } from "../../../lib/i18n";
import { Toggle } from "./ui";
import { VAD_DEFAULTS, type VadConfig } from "./vadConfig";

export interface VadCalibrationPanelProps {
  vad: VadConfig;
  setVad: Dispatch<SetStateAction<VadConfig>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
}

export default function VadCalibrationPanel({ vad, setVad, setDirty }: VadCalibrationPanelProps) {
  const lang = useStore((s) => s.language);
  const t = useTranslations(lang);
  const patchVad = (patch: Partial<VadConfig>) => setVad((v) => ({ ...v, ...patch }));

  return (
    <div className="border-t border-slate-700 pt-4 space-y-4">
      <h3 className="text-sm font-semibold text-cyan-400">{t("sys_vad_calibration")}</h3>
      <p className="text-xs text-slate-400 mb-3">{t("sys_vad_description")}</p>

      {/* Frontend VAD Parameters */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-slate-300 flex items-center gap-1">
            {t("sys_vad_silence_threshold")}
            <span className="text-xs text-slate-500">({vad.silenceThreshold.toFixed(2)})</span>
          </label>
          <input type="range" min="0.01" max="1.0" step="0.01" value={vad.silenceThreshold}
            onChange={(e) => { patchVad({ silenceThreshold: parseFloat(e.target.value) }); setDirty(true); }}
            className="w-full" />
          <p className="text-xs text-slate-500">{t("sys_vad_silence_threshold_desc")}</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-slate-300 flex items-center gap-1">
            {t("sys_vad_silence_timeout")}
            <span className="text-xs text-slate-500">({vad.silenceTimeoutMs}ms)</span>
          </label>
          <input type="range" min="100" max="5000" step="50" value={vad.silenceTimeoutMs}
            onChange={(e) => { patchVad({ silenceTimeoutMs: parseInt(e.target.value) }); setDirty(true); }}
            className="w-full" />
          <p className="text-xs text-slate-500">{t("sys_vad_silence_timeout_desc")}</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-slate-300 flex items-center gap-1">
            {t("sys_vad_min_recording")}
            <span className="text-xs text-slate-500">({vad.minRecordingMs}ms)</span>
          </label>
          <input type="range" min="100" max="5000" step="50" value={vad.minRecordingMs}
            onChange={(e) => { patchVad({ minRecordingMs: parseInt(e.target.value) }); setDirty(true); }}
            className="w-full" />
          <p className="text-xs text-slate-500">{t("sys_vad_min_recording_desc")}</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-slate-300 flex items-center gap-1">
            {t("sys_vad_max_recording")}
            <span className="text-xs text-slate-500">({vad.maxRecordingMs}ms)</span>
          </label>
          <input type="range" min="1000" max="30000" step="500" value={vad.maxRecordingMs}
            onChange={(e) => { patchVad({ maxRecordingMs: parseInt(e.target.value) }); setDirty(true); }}
            className="w-full" />
          <p className="text-xs text-slate-500">{t("sys_vad_max_recording_desc")}</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-slate-300 flex items-center gap-1">
            {t("sys_vad_baseline_window")}
            <span className="text-xs text-slate-500">({vad.baselineWindowMs}ms)</span>
          </label>
          <input type="range" min="200" max="5000" step="100" value={vad.baselineWindowMs}
            onChange={(e) => { patchVad({ baselineWindowMs: parseInt(e.target.value) }); setDirty(true); }}
            className="w-full" />
          <p className="text-xs text-slate-500">{t("sys_vad_baseline_window_desc")}</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-slate-300 flex items-center gap-1">
            {t("sys_vad_baseline_mult")}
            <span className="text-xs text-slate-500">({vad.baselineMultiplier.toFixed(1)}x)</span>
          </label>
          <input type="range" min="1.0" max="10.0" step="0.1" value={vad.baselineMultiplier}
            onChange={(e) => { patchVad({ baselineMultiplier: parseFloat(e.target.value) }); setDirty(true); }}
            className="w-full" />
          <p className="text-xs text-slate-500">{t("sys_vad_baseline_mult_desc")}</p>
        </div>
      </div>

      {/* Barge-in Parameters */}
      <div className="border-t border-slate-700 pt-4 space-y-4">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Barge-in (Interrupt JARVIS)</h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm text-slate-300 flex items-center gap-1">
              {t("sys_vad_barge_mult")}
              <span className="text-xs text-slate-500">({vad.bargeInMultiplier.toFixed(1)}x)</span>
            </label>
            <input type="range" min="1.0" max="10.0" step="0.1" value={vad.bargeInMultiplier}
              onChange={(e) => { patchVad({ bargeInMultiplier: parseFloat(e.target.value) }); setDirty(true); }}
              className="w-full" />
            <p className="text-xs text-slate-500">{t("sys_vad_barge_mult_desc")}</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-slate-300 flex items-center gap-1">
              {t("sys_vad_barge_floor")}
              <span className="text-xs text-slate-500">({vad.bargeInFloor.toFixed(2)})</span>
            </label>
            <input type="range" min="0.01" max="1.0" step="0.01" value={vad.bargeInFloor}
              onChange={(e) => { patchVad({ bargeInFloor: parseFloat(e.target.value) }); setDirty(true); }}
              className="w-full" />
            <p className="text-xs text-slate-500">{t("sys_vad_barge_floor_desc")}</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-slate-300 flex items-center gap-1">
              {t("sys_vad_barge_sustain")}
              <span className="text-xs text-slate-500">({vad.bargeInSustainMs}ms)</span>
            </label>
            <input type="range" min="50" max="2000" step="10" value={vad.bargeInSustainMs}
              onChange={(e) => { patchVad({ bargeInSustainMs: parseInt(e.target.value) }); setDirty(true); }}
              className="w-full" />
            <p className="text-xs text-slate-500">{t("sys_vad_barge_sustain_desc")}</p>
          </div>
        </div>
      </div>

      {/* Backend Silero VAD Parameters */}
      <div className="border-t border-slate-700 pt-4 space-y-4">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Backend Silero VAD</h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm text-slate-300 flex items-center gap-1">
              {t("sys_vad_silero_threshold")}
              <span className="text-xs text-slate-500">({vad.sileroThreshold.toFixed(2)})</span>
            </label>
            <input type="range" min="0.1" max="1.0" step="0.05" value={vad.sileroThreshold}
              onChange={(e) => { patchVad({ sileroThreshold: parseFloat(e.target.value) }); setDirty(true); }}
              className="w-full" />
            <p className="text-xs text-slate-500">{t("sys_vad_silero_threshold_desc")}</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-slate-300 flex items-center gap-1">
              {t("sys_vad_silero_min_silence")}
              <span className="text-xs text-slate-500">({vad.sileroMinSilenceMs}ms)</span>
            </label>
            <input type="range" min="50" max="3000" step="50" value={vad.sileroMinSilenceMs}
              onChange={(e) => { patchVad({ sileroMinSilenceMs: parseInt(e.target.value) }); setDirty(true); }}
              className="w-full" />
            <p className="text-xs text-slate-500">{t("sys_vad_silero_min_silence_desc")}</p>
          </div>
        </div>
      </div>

      {/* STT Coalesce & Filters */}
      <div className="border-t border-slate-700 pt-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm text-slate-300 flex items-center gap-1">
              {t("sys_vad_stt_coalesce")}
              <span className="text-xs text-slate-500">({vad.sttCoalesceMs}ms)</span>
            </label>
            <input type="range" min="50" max="5000" step="50" value={vad.sttCoalesceMs}
              onChange={(e) => { patchVad({ sttCoalesceMs: parseInt(e.target.value) }); setDirty(true); }}
              className="w-full" />
            <p className="text-xs text-slate-500">{t("sys_vad_stt_coalesce_desc")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          <Toggle
            label={t("sys_vad_hallucination_filter")}
            value={vad.hallucinationFilter}
            onChange={(v) => { patchVad({ hallucinationFilter: v }); setDirty(true); }}
          />
          <Toggle
            label={t("sys_vad_filler_filter")}
            value={vad.fillerFilter}
            onChange={(v) => { patchVad({ fillerFilter: v }); setDirty(true); }}
          />
        </div>
      </div>

      {/* Reset button */}
      <div className="border-t border-slate-700 pt-4">
        <button
          type="button"
          onClick={() => {
            setVad(VAD_DEFAULTS);
            setDirty(true);
          }}
          className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 hover:text-white transition text-sm font-mono"
        >
          {t("sys_vad_reset_defaults")}
        </button>
      </div>
    </div>
  );
}
