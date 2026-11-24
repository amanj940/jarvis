# Settings — Monitor tab

Standalone Monitor tab for the Settings panel, built as a separate component
so it could land while `Settings.tsx` was being merged. It is **not mounted
yet** — apply the mount instruction below after the merge agent finishes.

## What the tab shows

Three read-only sections, refreshed every 10 s (plus a manual Refresh button):

1. **Backend Health** — `GET /api/health`: server status, model provider /
   model / endpoint / key configured / endpoint reachable, image model,
   plugins loaded, tools registered, agents, permission mode, voice state /
   wake word / STT language / Whisper / Piper / Edge-TTS availability,
   pending-task count.
2. **System Telemetry** — `GET /api/stats`: CPU (with core count), RAM
   used/total, disk used/total, network sent/received, OS, GPU (name, load,
   memory, temperature — "not available" when there is no GPU), battery when
   the OS reports one.
3. **Persistent Tasks** — `GET /api/tasks`: every persistent task with title,
   kind, status, cron schedule, next run and creation time, plus a result
   line when present. Filter pills: All / Pending / Running / Completed /
   Failed / Cancelled, each with a count.

## Endpoints used (existing only — nothing invented)

| Endpoint | Used via |
|---|---|
| `GET /api/health` | existing `getHealth()` wrapper in `web/src/lib/api.ts` |
| `GET /api/stats` | existing `getStats()` wrapper in `web/src/lib/api.ts` |
| `GET /api/tasks` | direct `fetch(\`${API_BASE}/api/tasks\`)` — no `api.ts` wrapper exists for tasks, and none was added |

The tab is read-only: only GETs, no POST/PATCH/PUT/DELETE, no new `api.ts`
functions.

## Graceful degradation

Every section degrades honestly instead of showing fake data:

- Backend unreachable or an endpoint errors → the section shows
  "… — not available on this backend build".
- `GET /api/tasks` returns 503 → "Persistent tasks (task system not
  initialised) — not available on this backend build" (the backend replies
  503 when the task system was never initialised).
- No tasks at all → "No persistent tasks yet."

## Mount instruction (apply in `web/src/components/HUD/Settings.tsx`)

Four one-line changes, all inside the "System & Config" master tab:

1. Add the import next to the other component imports (near
   `import { resetAllLayouts } from "./Floating";`):

   ```tsx
   import SettingsMonitor from "./SettingsMonitor";
   ```

2. Extend the `systemSubTab` state union (currently
   `"voice" | "display" | "diagnostics" | "data"`) to include the new id:

   ```tsx
   const [systemSubTab, setSystemSubTab] = useState<"voice" | "display" | "diagnostics" | "data" | "monitor">(...
   ```

3. Add the sub-tab button to the `sysSubTabs` array in the System & Config
   block:

   ```tsx
   { id: "monitor", label: "📊 Monitor" },
   ```

4. Render the component after the `data` sub-tab block (after the
   `{systemSubTab === "data" && (...)}` block, inside the same System &
   Config container):

   ```tsx
   {systemSubTab === "monitor" && <SettingsMonitor />}
   ```

No other file needs to change. `SettingsMonitor.tsx` only imports
`API_BASE`, `getHealth`, `getStats` from `../../lib/api` and the
`SystemStats` type from `../../lib/store`.

## Verification

- `npx tsc -b` — clean
- `npx vite build` — succeeds
- `node --test tests/settingsMonitor.test.mjs` — static checks pass (see
  `web/tests/settingsMonitor.test.mjs`)
