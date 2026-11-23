# Launching JARVIS

There is **one backend** and **three ways to show it**. Every path starts the
same server — `python -m jarvis.main` — and every UI waits for the backend
to be healthy before it appears. There is no separate "server script".

## The one backend

`jarvis/main.py` (`python -m jarvis.main`) is the only thing that starts the
FastAPI server. It binds `127.0.0.1:7341` by default (`--host` / `--port` to
change it; Electron also honours the `JARVIS_PORT` environment variable).
`--check` boots, prints diagnostics, and exits without serving.

## The three launch paths

| Script | What you get | How it starts |
|---|---|---|
| `run.bat` | Production: backend + browser UI | Runs `python -m jarvis.main`. The backend polls `GET /api/health` (up to 30 s) and only then opens the browser. If the backend never becomes healthy, the browser is not opened. |
| `run-app.bat` | Desktop: Electron shell | Runs `npm start` in `electron/`. Electron spawns the same backend (`python -m jarvis.main --no-browser`) if it is not already running, then waits up to 60 s for `/api/health` before loading the window (`electron/main.cjs`: `startBackend` / `waitForBackend` / `loadApp`). If the backend never answers, the window shows an error page instead of a dead HUD. |
| `run-dev.bat` | Dev: backend + Vite HMR | Starts the backend with `--no-browser` in one window and `npm run dev` in `web/` in another. Frontend at http://127.0.0.1:5173. No health wait — Vite proxies to the backend as it comes up. |

`setup.bat` is not a launch path: it is the one-time setup (venv, pip,
Playwright Chromium, `.env`, web build). Run it once, then use one of the
three scripts above.

## The health-check contract

`GET /api/health` → `200 {"status": "online", ...}` is the single readiness
signal for the whole project. Both the browser path (`jarvis/main.py`) and
the desktop path (`electron/main.cjs`) poll it before showing any UI. If
you add a new UI entry point, poll `/api/health` first — do not open a
window on a fixed sleep.

## Port

Default `7341` everywhere: `jarvis/main.py --port` (default), `electron/main.cjs`
(`JARVIS_PORT` env or `7341`). The frontend talks to the same origin when
served by the backend, and to `5173` (Vite) in dev mode.
