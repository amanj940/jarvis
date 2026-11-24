# Settings Auth & Vault tabs (FG-026 / FG-027)

Standalone tab components for the Settings panel. They were built **without
touching `Settings.tsx` or `api.ts`** (a merge agent owns those files
concurrently) — mount them with the instructions below after the merge
finishes, re-checking line numbers first.

## Files

| File | What it is |
|---|---|
| `web/src/components/HUD/SettingsAuth.tsx` | Auth tab — authorization posture, configured providers, session info |
| `web/src/components/HUD/SettingsVault.tsx` | Vault tab — stored keys by masked preview only, backup/restore |
| `web/tests/settingsAuthVault.test.mjs` | Static regression tests (run with `node --test tests/`) |

## What each tab shows

### Auth tab (`SettingsAuth`)

1. **Authorization posture** — live from `GET /api/health` (via the
   existing `getHealth()` wrapper in `api.ts`): the `permission_mode`
   (`safe` / `confirm` / `auto` / `bypass`) with a plain-language
   explanation, the active model provider, whether its key is configured,
   and the wake word. A red warning banner appears when the mode is
   `bypass` (every tool call auto-allowed; only the `config.yaml`
   denylist still guards destructive commands).
2. **Configured providers** — from `GET /api/keys` via the existing
   `getKeysStatus()` wrapper: provider name + "Key configured" / "No key
   configured". That endpoint lives only on the `audit/fixes` backend so
   far, so on the `ui-hud-upgrade` backend this section shows an honest
   "not available" panel instead of fake data.
3. **Session info (FG-026)** — no session endpoint exists on any backend
   branch, so this section is an honest "not available" panel (what would
   be shown: last login time, IP address, device) and the "Log out from
   all devices" action is rendered **disabled** with the reason, rather
   than faking a logout.

### Vault tab (`SettingsVault`)

1. **Stored keys** — from `GET /api/keys` via `getKeysStatus()`: one card
   per provider with each key's masked preview, status badge, success /
   failure counts, and cooldown. Providers that report a key but no pool
   entries are listed as "Key configured — no pool entries reported".
   Same graceful "not available" panel as the Auth tab while the endpoint
   does not exist on this backend.
2. **Backup & restore (FG-027)** — no backup/restore endpoint exists on
   any backend branch, so "Backup Vault" and "Restore from Backup" are
   rendered **disabled** with an honest reason instead of faking the
   operation. When an endpoint exists, backup should be an encrypted
   download and restore a file upload.

## Data sources — no invented endpoints

| Source | Used by | Status on `ui-hud-upgrade` |
|---|---|---|
| `GET /api/health` (`getHealth()`) | Auth tab §1 | Exists, live |
| `GET /api/keys` (`getKeysStatus()`) | Auth tab §2, Vault tab §1 | Missing on this backend (exists on `audit/fixes`); both tabs degrade gracefully |
| Session endpoint | Auth tab §3 (FG-026) | Does not exist on any branch |
| Vault backup/restore endpoint | Vault tab §2 (FG-027) | Does not exist on any branch |

No other endpoint is called. In particular there is no `/api/auth`,
`/api/vault`, `/api/sessions`, or `/api/logout` anywhere in the code.

## Security rules

- **Masked names only.** The backend returns masked previews
  (`masked` / `key_preview`); the Vault tab renders them through
  `safePreview()`, a second guard that caps any unmasked value at its
  first 4 characters + "…" (16 characters max for an already-masked
  preview). A full secret can never reach the screen through this UI,
  even if a backend change returned a longer value.
- **Never copy, log, or accept a secret.** No copy-to-clipboard of key
  material, no `console.log` of key values, no password fields, and no
  input that accepts a secret anywhere in either tab.
- **Disabled, not faked.** Actions with no backend support are rendered
  disabled with the reason in plain text, never as working buttons.
- **No secrets in tests or docs.** The test file asserts these rules
  statically (no `clipboard`, no `console.log`, no `<input>`, no
  `type="password"` in either component).

## Mount instructions for Settings.tsx

Apply **after** the concurrent merge of `Settings.tsx` finishes, and
re-read the file first — line numbers below are from the pre-merge
`ui-hud-upgrade` head and will have shifted.

1. **Imports** — next to the other HUD imports:

```tsx
import SettingsAuth from "./SettingsAuth";
import SettingsVault from "./SettingsVault";
```

2. **Tabs array** — in the `tabs` array (5 master tabs; `ai`, `tools`,
   `mcp`, `integrations`, `system`), append:

```tsx
{ id: "auth", label: "Auth", icon: "🔐" },
{ id: "vault", label: "Vault", icon: "🛡️" },
```

3. **Tab normalization** — in `normalizeTab`, pass both ids through
   (the `audit/fixes` Settings does `if (t === "auth") return "auth"` /
   `if (t === "vault") return "vault"`), so deep links
   (`initialTab="auth"` / `"vault"`) and `setActiveTab` work.

4. **Render blocks** — alongside the other `{activeTab === ...}`
   blocks (same pattern as the `audit/fixes` Settings):

```tsx
{activeTab === "auth" && <SettingsAuth />}
{activeTab === "vault" && <SettingsVault />}
```

5. **Verify after mounting**: `npx tsc -b` clean,
   `npx vite build` succeeds,
   `node --test tests/wakeWord.test.mjs tests/settingsGap.test.mjs tests/settingsAuthVault.test.mjs`
   passes, and both tabs render with the graceful "not available" panels
   until the `/api/keys` backend port lands.

## Deliberately not done

- No backend endpoints were added or invented (out of scope; the task
  forbade touching anything outside the four new files).
- No `Settings.tsx` / `api.ts` edits — mount instructions above are for
  the merge agent / a follow-up, after the concurrent merge lands.
- FG-026 session info and FG-027 backup/restore remain blocked on
  backend endpoints that do not exist yet; both tabs say so honestly
  instead of showing fake data.
- `safePreview()` is covered by static source assertions in
  `settingsAuthVault.test.mjs`, not by a runtime unit test (the
  components are TSX and the repo's web tests run as plain node tests).
