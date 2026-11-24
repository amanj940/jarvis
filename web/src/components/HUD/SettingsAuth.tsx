/**
 * SETTINGS — AUTH TAB (standalone component).
 *
 * Mounted by Settings.tsx as `{activeTab === "auth" && <SettingsAuth />}`
 * (see docs/settings-auth-vault-tabs.md for the exact mount instructions —
 * do NOT edit Settings.tsx here; a merge agent owns it concurrently).
 *
 * What this tab shows — and nothing else:
 *  1. Authorization posture, live from GET /api/health
 *     (`permission_mode` + the active model provider and whether it has a
 *     key configured). This endpoint exists on the ui-hud-upgrade backend.
 *  2. Configured providers, from GET /api/keys via the api.ts
 *     `getKeysStatus()` wrapper (`api_keys`: provider -> key present).
 *     That endpoint lives only on the audit/fixes backend so far — on this
 *     build the section degrades to an honest "not available" panel.
 *  3. Session info (FG-026): no session endpoint exists on any backend
 *     branch, so this section is an honest "not available" panel plus a
 *     disabled "Log out from all devices" action. No fake data.
 *
 * SECURITY RULES (see docs/settings-auth-vault-tabs.md):
 *  - No secrets are ever displayed, copied, or logged by this tab.
 *  - No password fields, no token display, no session-token handling.
 *  - No invented endpoints: only getHealth() and getKeysStatus() are used.
 */

import { useCallback, useEffect, useState } from "react";
import { getHealth, getKeysStatus } from "../../lib/api";
import type { KeysStatus } from "../../lib/api";
import type { Health } from "../../lib/store";

// Permission modes, meanings copied from config.yaml (permissions.mode).
const MODE_INFO: Record<string, { label: string; desc: string; tone: string }> = {
  safe: {
    label: "safe",
    desc: "SAFE tools run automatically, CAUTION tools ask, DANGEROUS tools are refused unless explicitly requested.",
    tone: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  },
  confirm: {
    label: "confirm",
    desc: "SAFE tools run automatically, CAUTION tools ask, DANGEROUS tools ask with a hard warning.",
    tone: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  },
  auto: {
    label: "auto",
    desc: "SAFE and CAUTION tools run automatically, DANGEROUS tools ask.",
    tone: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  },
  bypass: {
    label: "bypass",
    desc: "ALL tools are auto-allowed. The denylist is the only remaining guardrail.",
    tone: "bg-red-500/20 text-red-300 border-red-500/30",
  },
};

export default function SettingsAuth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [keys, setKeys] = useState<KeysStatus | null>(null);
  // null = still loading, true = endpoint answered, false = not available.
  const [keysAvailable, setKeysAvailable] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setHealthError(false);
    try {
      setHealth(await getHealth());
    } catch {
      setHealth(null);
      setHealthError(true);
    }
    try {
      const kd = await getKeysStatus();
      setKeys(kd);
      setKeysAvailable(true);
    } catch {
      setKeys(null);
      setKeysAvailable(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const mode = health?.permission_mode ?? "";
  const modeInfo = MODE_INFO[mode];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Auth</h2>
          <p className="text-xs text-slate-500">
            Who Jarvis trusts, and how it asks before acting. No secrets are
            shown on this tab.
          </p>
        </div>
        <button
          onClick={refresh}
          className="px-3 py-2 text-xs bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition border border-slate-700/50"
        >
          Refresh
        </button>
      </div>

      {/* ── 1. Authorization posture (live: GET /api/health) ───────────── */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">
          Authorization posture
        </h3>
        {healthError || !health ? (
          <p className="text-xs text-slate-500 italic">
            {healthError
              ? "Authorization posture is not available: GET /api/health did not answer on this backend build."
              : "Loading…"}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span
                className={`px-2 py-1 text-xs font-mono rounded border ${
                  modeInfo?.tone ??
                  "bg-slate-700/50 text-slate-300 border-slate-600/50"
                }`}
              >
                {mode || "unknown"}
              </span>
              <span className="text-sm text-slate-300">
                {modeInfo?.desc ?? "Unknown permission mode."}
              </span>
            </div>
            {mode === "bypass" && (
              <p className="text-xs text-red-300 bg-red-950/50 border border-red-800/50 rounded-lg px-3 py-2">
                Warning: bypass mode auto-allows every tool call. Only the
                denylist in config.yaml still guards destructive commands. To
                tighten this, set permissions.mode to confirm in config.yaml
                and restart the backend.
              </p>
            )}
            <div className="text-xs text-slate-400 space-y-1">
              <p>
                Active model provider:{" "}
                <span className="text-slate-200 font-mono">
                  {health.model?.provider ?? "—"}
                </span>{" "}
                <span className="font-mono">{health.model?.model ?? ""}</span>
              </p>
              <p>
                Provider key configured:{" "}
                <span
                  className={
                    health.model?.configured
                      ? "text-emerald-300"
                      : "text-amber-300"
                  }
                >
                  {health.model?.configured ? "Yes" : "No"}
                </span>
              </p>
              <p>
                Wake word:{" "}
                <span className="text-slate-200 font-mono">
                  {health.voice?.wake_word ?? "—"}
                </span>
              </p>
            </div>
          </>
        )}
      </div>

      {/* ── 2. Configured providers (GET /api/keys) ─────────────────────── */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">
          Configured providers
        </h3>
        {keysAvailable === null ? (
          <p className="text-xs text-slate-500 italic">Loading…</p>
        ) : keysAvailable === false ? (
          <p className="text-xs text-slate-500 italic">
            Key provider list is not available: GET /api/keys is not exposed
            by the backend on this branch yet. Masked key details live in the
            Vault tab once that endpoint exists.
          </p>
        ) : keys && keys.api_keys && Object.keys(keys.api_keys).length > 0 ? (
          <ul className="space-y-2">
            {Object.entries(keys.api_keys)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([provider, present]) => (
                <li
                  key={provider}
                  className="flex items-center justify-between bg-slate-900/60 border border-slate-700/50 rounded-xl px-4 py-3"
                >
                  <span className="text-sm text-slate-200 font-mono">
                    {provider}
                  </span>
                  <span className="flex items-center gap-2 text-sm">
                    <span
                      className={`w-2 h-2 rounded-full inline-block ${
                        present ? "bg-emerald-400" : "bg-slate-600"
                      }`}
                    />
                    <span
                      className={
                        present ? "text-emerald-300" : "text-slate-400"
                      }
                    >
                      {present ? "Key configured" : "No key configured"}
                    </span>
                  </span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500 italic">
            The backend answered, but no provider reports a key.
          </p>
        )}
        <p className="text-[11px] text-slate-500">
          Only provider names and a yes/no configured state are shown here.
          Masked key previews live in the Vault tab.
        </p>
      </div>

      {/* ── 3. Session info (FG-026 — no backend endpoint yet) ──────────── */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">
          Session info
        </h3>
        <p className="text-xs text-slate-500 italic">
          Session info is not available: the backend does not expose a session
          endpoint on this build yet. When one exists, this section will show
          last login time, IP address, and device for each active session.
        </p>
        <div>
          <button
            disabled
            title="Unavailable: no session/logout endpoint is exposed by the backend on this branch yet."
            className="px-3 py-2 text-xs bg-slate-800 text-slate-500 rounded-lg border border-slate-700/50 cursor-not-allowed"
          >
            Log out from all devices
          </button>
          <p className="text-[11px] text-slate-500 mt-2">
            Unavailable — logging out everywhere needs a backend session
            endpoint that does not exist yet. This button is disabled rather
            than faking a logout.
          </p>
        </div>
      </div>
    </div>
  );
}
