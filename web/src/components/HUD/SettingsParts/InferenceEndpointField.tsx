/**
 * Settings → AI → Inference: endpoint URL field.
 * Extracted from Settings.tsx: JSX unchanged.
 */

import { type Dispatch, type SetStateAction } from "react";

export interface InferenceEndpointFieldProps {
  endpoint: string;
  provider: string;
  setDirty: Dispatch<SetStateAction<boolean>>;
  setEndpoint: Dispatch<SetStateAction<string>>;
}

export default function InferenceEndpointField({
  endpoint,
  provider,
  setDirty,
  setEndpoint,
}: InferenceEndpointFieldProps) {
  return (
    <>
      <div className="space-y-2">
        <label className="text-sm text-slate-300">Endpoint {provider === "openai_compatible" ? "" : "(auto-filled)"}</label>
        <input
          type="text"
          value={endpoint}
          onChange={(e) => { setEndpoint(e.target.value); setDirty(true); }}
          placeholder="https://api.example.com/v1"
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white"
        />
      </div>
    </>
  );
}
