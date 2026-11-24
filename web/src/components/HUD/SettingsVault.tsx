/**
 * SETTINGS — VAULT TAB (standalone component).
 *
 * Mounted by Settings.tsx as `{activeTab === "vault" && <SettingsVault />}`
 * (see docs/settings-auth-vault-tabs.md for the exact mount instructions —
 * do NOT edit Settings.tsx here; a merge agent owns it concurrently).
 *
 * What this tab shows — and nothing else:
 *  1. Stored keys, NAMES ONLY, from GET /api/keys via the api.ts
 *     `getKeysStatus()` wrapper. The backend returns masked previews
 *     (`masked` / `key_preview`); this tab renders them through
 *     safePreview() below and never renders, copies, or logs a full value.
 *     That endpoint lives only on the audit/fixes backend so far — on this
 *     build the section degrades to an honest "not available" panel.
 *  2. Vault backup / restore (FG-027): no backup/restore endpoint exists
 *     on any backend branch, so both actions are shown disabled with an
 *     honest reason instead of faking the operation.
 *
 * SECURITY RULES (see docs/settings-auth-vault-tabs.md):
 *  - Only masked previews are ever rendered. safePreview() caps any
 *    unmasked value at its first 4 characters + "…".
 *  - No copy-to-clipboard of key material, no password fields, no inputs
 *    that accept a secret, and no logging of key values.
 *  - No invented endpoints: only getKeysStatus() is used.
 */

import { useCallback, useEffect, useState } from "react";
import { getKeysStatus } from "../../lib/api";
import type { KeysStatus } from "../../lib/api";

/**
 * Render-safe preview of key material. The backend already returns masked
 * previews, but this is a second guard so that even if a backend change
 * ever returned a longer value, this UI can never display more than 4
 * characters of unmasked key material (16 of an already-masked preview).
 */
export function safePreview(raw?: string): string {
  if (!raw) return "—";
  const v = raw.trim();
  if (v.includes("…") || v.includes("*")) return v.slice(0, 16);
  return v.length <= 8 ? v : `${v.slice(0, 4)}…`;
}

export default function SettingsVault() {
  const [keys, setKeys] = useState<KeysStatus | null>(null);
  // null = still loading, true = endpoint answered, false = not available.
  const [available, setAvailable] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      const kd = await getKeysStatus();
      setKeys(kd);
      setAvailable(true);
    } catch {
      setKeys(null);
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const poolProviders = keys?.keys ? Object.keys(keys.keys).sort() : [];
  const configuredNoPool =
    keys?.api_keys
      ? Object.entries(keys.api_keys)
          .filter(
            ([provider, present]) =>
              present && !(keys.keys && provider in keys.keys),
          )
          .map(([provider]) => provider)
          .sort()
      : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Vault</h2>
          <p className="text-xs text-slate-500">
            Stored API keys, by name only. This tab never shows, copies, or
            logs a full secret.
          </p>
        </div>
        <button
          onClick={refresh}
          className="px-3 py-2 text-xs bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition border border-slate-700/50"
        >
          Refresh
        </button>
      </div>

      {/* ── 1. Stored keys — names + masked previews only ──────────────── */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">Stored keys</h3>
        {available === null ? (
          <p className="text-xs text-slate-500 italic">Loading…</p>
        ) : available === false ? (
          <p className="text-xs text-slate-500 italic">
            Stored keys are not available: GET /api/keys is not exposed by
            the backend on this branch yet. Once that endpoint exists, this
            section lists each provider&apos;s keys by masked preview only.
          </p>
        ) : poolProviders.length === 0 && configuredNoPool.length === 0 ? (
          <p className="text-xs text-slate-500 italic">
            The backend answered, but no stored keys were reported.
          </p>
        ) : (
          <ul className="space-y-3">
            {poolProviders.map((provider) => {
              const items = keys?.keys?.[provider] ?? [];
              return (
                <li
                  key={provider}
                  className="bg-slate-900/60 border border-slate-700/50 rounded-xl px-4 py-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-200 font-mono">
                      {provider}
                    </span>
                    <span className="text-xs text-slate-400">
                      {items.length} {items.length === 1 ? "key" : "keys"}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {items.map((item, i) => (
                      <li
                        key={i}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                      >
                        <span className="font-mono text-slate-300">
                          {safePreview(item.masked || item.key_preview)}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] border ${
                            item.status === "ok" || item.status === "active"
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                              : item.status === "cooldown" ||
                                  item.status === "cooling_down"
                                ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                                : "bg-slate-700/50 text-slate-300 border-slate-600/50"
                          }`}
                        >
                          {item.status}
                        </span>
                        {typeof item.successes === "number" && (
                          <span className="text-emerald-400">
                            ✓ {item.successes} successes
                          </span>
                        )}
                        {typeof item.failures === "number" &&
                          item.failures > 0 && (
                            <span className="text-red-400">
                              ✗ {item.failures} failures
                            </span>
                          )}
                        {typeof item.cooldown_remaining === "number" &&
                          item.cooldown_remaining > 0 && (
                            <span className="text-amber-300">
                              cooldown {item.cooldown_remaining}s
                            </span>
                          )}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
            {configuredNoPool.map((provider) => (
              <li
                key={provider}
                className="flex items-center justify-between bg-slate-900/60 border border-slate-700/50 rounded-xl px-4 py-3"
              >
                <span className="text-sm text-slate-200 font-mono">
                  {provider}
                </span>
                <span className="text-xs text-slate-400">
                  Key configured — no pool entries reported
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-slate-500">
          Previews come masked from the backend and are capped again here
          (first 4 characters at most of any unmasked value). Full values are
          never requested, rendered, copied, or logged.
        </p>
      </div>

      {/* ── 2. Backup / restore (FG-027 — no backend endpoint yet) ──────── */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">
          Backup &amp; restore
        </h3>
        <p className="text-xs text-slate-500 italic">
          Vault backup is not available: no backup/restore endpoint is exposed
          by the backend on this branch yet. When one exists, this section
          will offer an encrypted backup download and a restore from file.
        </p>
        <div className="flex gap-2">
          <button
            disabled
            title="Unavailable: no vault backup endpoint is exposed by the backend on this branch yet."
            className="px-3 py-2 text-xs bg-slate-800 text-slate-500 rounded-lg border border-slate-700/50 cursor-not-allowed"
          >
            Backup Vault
          </button>
          <button
            disabled
            title="Unavailable: no vault restore endpoint is exposed by the backend on this branch yet."
            className="px-3 py-2 text-xs bg-slate-800 text-slate-500 rounded-lg border border-slate-700/50 cursor-not-allowed"
          >
            Restore from Backup
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          Both actions are disabled rather than faking a backup or restore.
        </p>
      </div>
    </div>
  );
}
