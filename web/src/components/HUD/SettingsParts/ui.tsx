/**
 * Small presentational helpers shared by the Settings tabs.
 * Extracted verbatim from Settings.tsx (no logic changes).
 */

// ── Helper components ────────────────────────────────────────────────────────

export function Toggle({
  label, value, onChange,
}: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer py-2">
      <span className="text-slate-300">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative w-12 h-6 rounded-full transition-colors ${
          value ? "bg-cyan-500" : "bg-slate-600"
        }`}
      >
        <span
          className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
            value ? "left-7" : "left-1"
          }`}
        />
      </button>
    </label>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}

// FG-007 (ported from ui): typed parameter rows for a tool. The backend
// returns a JSON schema ({ type: "object", properties: {...}, required: [...] }),
// so the rows are built from `properties` with required/type/description/
// default/enum hints — not from raw JSON. Unknown shapes fall back to plain
// entries. (The audit/fixes inline renderer iterated Object.entries of the
// whole schema, which would have rendered "properties:" / "required:" rows.)
export function ToolParams({ parameters }: { parameters: any }) {
  const props =
    parameters?.properties && typeof parameters.properties === "object"
      ? parameters.properties
      : null;
  const required: string[] = Array.isArray(parameters?.required) ? parameters.required : [];
  if (!props) {
    const entries =
      parameters && typeof parameters === "object" ? Object.entries(parameters) : [];
    if (entries.length === 0) {
      return <div className="text-[11px] text-slate-500">No parameters.</div>;
    }
    return (
      <div className="p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg text-[10.5px] space-y-1.5 max-h-48 overflow-y-auto">
        {entries.map(([key, param]: [string, any]) => (
          <div key={key} className="flex items-start gap-2">
            <span className="text-cyan-400 font-mono shrink-0">{key}:</span>
            <span className="text-slate-300 break-words">
              {typeof param === "object" ? JSON.stringify(param) : String(param)}
            </span>
          </div>
        ))}
      </div>
    );
  }
  const keys = Object.keys(props);
  if (keys.length === 0) {
    return <div className="text-[11px] text-slate-500">No parameters.</div>;
  }
  return (
    <div className="p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg text-[10.5px] space-y-1.5 max-h-48 overflow-y-auto">
      {keys.map((key) => {
        const p = props[key] || {};
        const isReq = required.includes(key);
        return (
          <div key={key} className="flex items-start gap-2">
            <span className="text-cyan-400 font-mono shrink-0">
              {key}
              {isReq ? " *" : ""}:
            </span>
            <span className="text-slate-300 break-words">
              {p.type || "any"}
              {isReq ? " — required" : " — optional"}
              {p.description ? ` — ${p.description}` : ""}
              {p.default !== undefined ? ` (default: ${JSON.stringify(p.default)})` : ""}
              {Array.isArray(p.enum) ? ` [${p.enum.join(", ")}]` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
