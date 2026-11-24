# Settings UI gap fix

Fixes the gaps found in `docs/audits/SETTINGS_UI_GAP_REPORT.md` (copied from
branch `audit/fixes`) by merging the `audit/fixes` Settings improvements into
`ui-hud-upgrade` — surgically, not as a wholesale file copy, because the
`audit/fixes` `Settings.tsx` (6,267 lines) depends on `lib/i18n`,
`PlatformDetailModal`, `AuthTab` and `VaultTab`, which do not exist on this
branch.

## Fixed

| Gap | What was done |
| --- | --- |
| FG-001 (critical) | omniroute / 9Router added to `PROVIDER_ENDPOINTS` (`http://localhost:20128/v1`), `PREDEFINED_MODELS` (`groq/openai/gpt-oss-120b`, `gem`, `gemini/gemini-3.8-flash`), `PROVIDER_INFO` (9Router Proxy, local), the Inference provider dropdown and the fallback-provider dropdown. Treated as keyless like `openai_compatible` (no API-key banner, models auto-fetched on mount). Verified against `jarvis/core/brain.py` Tier 3 and `providers_catalog.py` on `audit/fixes`. |
| FG-002 | Cascade Status section in the Inference tab: lists the live tiers from `GET /api/models/cascade` with local/cloud badge, timeout and status dot, plus a Refresh button. |
| FG-003 | Active-key display in the key banner: masked key, pool position ("N of M in pool"), success rate, failures and cooldown from `GET /api/keys`. |
| FG-004 / FG-005 | `getCascadeStatus()` and `getKeysStatus()` wrappers added to `web/src/lib/api.ts`; `Settings.tsx` uses them instead of inline fetches. |
| FG-006 | Verified/untested/failed badges next to each model in the model dropdown, from `GET /api/models/verified` (✓/✗/? with latency when present). |
| FG-007 | Typed parameter rows in the Tools tab via a `ToolParams` helper: name, type, required/optional, description, default and enum — read from the JSON-schema `properties`/`required` shape the real `/api/tools` returns, with a raw-JSON `<details>` fallback. |
| FG-008 | Permission filter pills (all / safe / caution / danger) with per-count badges, applied to the tool list. |
| FG-009 | Plugin cards expand to list the tools that depend on them; disabling a plugin that still provides tools asks for confirmation first. |
| FG-010 | MCP server rows have Test and Logs buttons; the logs panel expands in place. |
| FG-013 | Verified: no hardcoded personal integration defaults (no email/phone/ical URL) in `Settings.tsx`. |
| FG-014 / FG-016 | Per-integration "Test connection" buttons with result + latency and a last-5 test history (kept in `localStorage`), plus a "Test All" button in the Integrations header. |
| FG-019 / FG-020 | Settings Backup card in the Data sub-tab: export settings to JSON, import from a JSON file (fills the form; nothing is saved until Save is pressed), and reset to defaults (with a confirmation dialog). |

## Deferred or blocked (no backend support on this branch)

The `ui-hud-upgrade` backend (after the Phase 2 routes split) exposes none of
the endpoints the gap report assumes, so the UI sections above degrade
gracefully — they show an honest "endpoint not available on this backend
build" state instead of fake data. These endpoints need a backend port from
`audit/fixes` (a separate task; this fix touches no backend code):

- `GET /api/models/cascade` — FG-002 live data
- `GET /api/models/verified` — FG-006 live data
- `GET /api/keys` (and `/probe`, `/add`, `/remove`, `/bulk-import`) — FG-003 live data
- `GET /api/models` and `GET/POST /api/config` — FG-004/005 assumed by the report
- `GET /api/council/*`, `GET /api/swarm/*` — already called by the existing UI, also absent
- `POST /api/mcp/servers/{name}/test`, `GET /api/mcp/servers/{name}/logs` — FG-010 live data (the logs endpoint does not exist even on `audit/fixes`)

Deferred for the same reason (no backend data or no tab to host them):

- FG-011 MCP preset health score — no backend health data.
- FG-012 MCP reorder — needs backend persistence.
- FG-015 integration rate limits — no backend data.
- FG-017 webhook URLs — no backend data.
- FG-018 VAD live visualisation — no VAD controls or backend VAD config endpoints on this branch.
- FG-021–FG-025 Monitor tab — no Monitor tab exists on `ui-hud-upgrade`; would need a new tab plus backend learning-stats endpoints.
- FG-026/027 Auth/Vault tabs — `AuthTab`/`VaultTab` components do not exist on this branch.

## Verification

- `npx tsc -b` — clean (exit 0)
- `npx vite build` — succeeds
- `node --test tests/wakeWord.test.mjs tests/settingsGap.test.mjs` — 15 passed (7 wakeWord + 8 new `settingsGap` static assertions)
- `pytest tests/` — 171 passed, 3 skipped, 14 subtests passed (no regressions)
