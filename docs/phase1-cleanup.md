# Phase 1 cleanup — what changed and what did not

Branch: `muse/phase1-cleanup` (from `efe8ac05`, the default branch
`ui-hud-upgrade` — this repo has no `main` branch). No merge to the default
branch in this phase; review the draft PR first.

## 1. Tests live in `tests/` now

- `data/test_gemini.py` → `tests/test_gemini.py`
- `data/test_tts.py` → `tests/test_tts.py`
- `data/test_tts_endpoint.py` → `tests/test_tts_endpoint.py`
- New: `tests/intent_router_test.py` — the scaffold the router's own
  docstring promised ("Add a fixture under `tests/intent_router_test.py`
  (todo: scaffold)"). It pins the routing contract: information needs →
  `web_search`, pictures → `image_search`, videos → `video_search`,
  generation → `image_generate`, plus no-match and compound-request cases.

The three moved files used to execute network calls at import time (bare
`asyncio.run(...)`), which breaks pytest collection. Their logic is
unchanged, but the check now lives in `run_check()` and runs only via
`python tests/test_*.py` or under pytest when `JARVIS_RUN_NETWORK_TESTS=1`
(the endpoint test additionally skips unless a server answers on
`127.0.0.1:7341`). The existing `tests/test_wake_word.py` is untouched.

`data/tmp/` contained only a HuggingFace cache probe
(`hf-cache-probe/CACHEDIR.TAG` + an empty `models--visualbruno--TRELLIS.2-4B-FP8`
directory). The marker file was removed and `data/tmp/` added to
`.gitignore` — it is runtime scratch, not source.

## 2. One source of truth for configuration

`config.yaml` is authoritative; the Pydantic defaults in `jarvis/config.py`
now mirror it, so a missing or partial `config.yaml` behaves exactly like
the shipped one. Values that used to disagree:

| Setting | Old code default | `config.yaml` (now the default) |
|---|---|---|
| `model.endpoint` | `http://localhost:1234/v1` | `http://localhost:11434/v1` |
| `model.model` | `local-model` | `gemma4:31b-cloud` |
| `model.api_key_env` | `LLM_API_KEY` | `OLLAMA_API_KEY` |
| `model.max_tokens` | `4096` | `16384` |
| `model.request_timeout_seconds` | `120` | `180` |
| `model.native_tool_calls` | `false` | `true` |
| `ultimate.embed_model` | `text-embedding-3-small` | `nomic-embed-text` |
| `voice.piper_enabled` | `false` | `true` |
| `voice.piper_length_scale` | `1.32` | `1.0` |
| `voice.riva_server` | `localhost:50051` | `grpc.nvcf.nvidia.com:443` |
| `voice.riva_voice` | `English-US.Female-1` | `Magpie-Multilingual.EN-US.Leo` |

**Deliberately not aligned:** `permissions.mode`. `config.yaml` sets
`bypass`, but the code default stays `confirm` — a missing `config.yaml`
must never silently auto-allow every tool. The yaml value still wins
whenever the file is present.

**Persona extracted:** the ~130-line persona (including the TOOL HIERARCHY)
moved out of `config.yaml` into `persona/jarvis.md`, verbatim.
`config.yaml` now has `A.persona_file: persona/jarvis.md`, and
`load_config()` reads that file. Precedence: inline `A.persona:` in
`config.yaml` (still supported) > `persona_file` > the short built-in
fallback. A missing/unreadable file is not an error. `GET /api/persona`
and `POST /api/persona` are unchanged — they read/write the in-memory
persona as before.

## 3. One launch path, with a health check

Every script starts the same backend (`python -m jarvis.main`); only the
UI differs. See `docs/launch.md` for the full matrix.

- `run.bat` — production: backend + browser. `jarvis/main.py` now polls
  `GET /api/health` (up to 30 s) before opening the browser, instead of a
  fixed 0.8 s sleep. If the backend never becomes healthy, the browser is
  not opened.
- `run-app.bat` — desktop: Electron. No code change needed — Electron
  already spawns the backend and waits up to 60 s for `/api/health`
  (`electron/main.cjs`: `startBackend` / `waitForBackend` / `loadApp`).
  The port there was already overridable via `JARVIS_PORT` (default 7341),
  not hardcoded.
- `run-dev.bat` — dev: backend (`--no-browser`) + Vite HMR on `:5173`.
- `setup.bat` — one-time setup only, unchanged in behaviour.

## 4. Routes inventory (no split yet)

`docs/routes-inventory.md` lists all 33 endpoints in
`jarvis/server/routes.py` (1,434 lines) with handler, line number, purpose,
and model/GPU involvement, plus the app-level routes in `app.py`.
`routes.py` was **not** split in Phase 1 — the inventory is the checklist
for the Phase 2 split (`routes/voice.py`, `routes/media.py`,
`routes/memory.py`, `routes/system.py`, model loading to `jarvis/models/`).

## Deliberately NOT changed in Phase 1

- `routes.py`, `orchestrator.py`, `media_generation.py` — inventoried, not
  refactored (Phase 2).
- `permissions.mode: bypass` in `config.yaml` — a security decision for the
  owner, not a cleanup. Flagged in the audit; do not build the bug-bounty
  or commercial agents on top of it.
- `TripoSR/`, `stable-fast-3d/`, `output/`, `data/research/` — already
  `.gitignore`d and not tracked in git; nothing to delete from the repo.
  The comments in `.gitignore` already document them as abandoned.
- `data/models/`, `data/voices/` — runtime model/voice storage, untouched.
- No behaviour change to the HUD, the voice loop, or any tool.

## Verification

- `python -m pytest tests/test_wake_word.py tests/test_intent_router.py`
  (offline; the three moved network tests skip without
  `JARVIS_RUN_NETWORK_TESTS=1`).
- `python -c "from jarvis.config import load_config; ..."` — config loads,
  values match `config.yaml`, persona comes from `persona/jarvis.md`.
- `python -m py_compile` on every changed `.py` file.
- Full `python -m jarvis.main --check` was **not** run locally: it boots
  the whole service graph (plugins, orchestrator, GPU code) and needs the
  Windows environment + full dependency set. Run it on the dev machine
  before merging.
