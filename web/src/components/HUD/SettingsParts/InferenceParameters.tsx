/**
 * Settings → AI → Inference: generation parameters (max tokens, temperature).
 * Extracted from Settings.tsx: JSX unchanged.
 */

import { type Dispatch, type SetStateAction } from "react";

export interface InferenceParametersProps {
  maxTokens: number;
  setDirty: Dispatch<SetStateAction<boolean>>;
  setMaxTokens: Dispatch<SetStateAction<number>>;
  setTemperature: Dispatch<SetStateAction<number>>;
  temperature: number;
}

export default function InferenceParameters({
  maxTokens,
  setDirty,
  setMaxTokens,
  setTemperature,
  temperature,
}: InferenceParametersProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-slate-300">Max Tokens</label>
          <input type="number" value={maxTokens}
            onChange={(e) => { setMaxTokens(parseInt(e.target.value) || 0); setDirty(true); }}
            min="1" max="8192" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white" />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-slate-300">Temperature (0–2)</label>
          <input type="number" value={temperature}
            onChange={(e) => { setTemperature(parseFloat(e.target.value) || 0); setDirty(true); }}
            min="0" max="2" step="0.1" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white" />
        </div>
      </div>
    </>
  );
}
