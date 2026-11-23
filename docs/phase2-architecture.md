# Phase 2 — Architecture refactor

Phase 1 (merged, `6fc55db`) unified config and inventoried the god files.
Phase 2 splits them. No behaviour was intentionally changed except the two
items marked **changed** below; everything else is a move.

## 1. Server routes — `jarvis/server/routes.py` (1,434 lines) → `jarvis/server/routes/`

| Module | Endpoints | Notes |
|---|---|---|
| `routes/system.py` | 19 — `/health`, `/stats`, `/logs`, `/logs/stream`, `/upload`, `/files/{path}`, `/processes`, `/tools`, `/plugins`, `/agents`, `/intents`, `/intents/classify`, `/proxy`, `/reader`, `/cleanslate`, `/mission` ×2, `/persona` ×2 | SSE log sink + NVML/`nvidia-smi` GPU telemetry live here |
| `routes/voice.py` | 3 — `/stt`, `/tts`, `/tts/status` | HTTP only; models live in `jarvis/models/` |
| `routes/media.py` | 5 — `/image-models`, `/image-models/select`, `/analyze-image`, `/image-to-3d`, `/img2img` | Thin wrappers over the media plugin tools |
| `routes/memory.py` | 6 — `/memory/prefs`, `/memory/notes`, `/memory/paths`, `/memory/tools`, `/memory/search`, `/memory/conversation` | Read-only memory views |
| `routes/common.py` | — | Shared `_services(req)` helper |
| `routes/__init__.py` | — | Aggregates the four sub-routers into one `router`, so `app.include_router(routes.router, prefix="/api")` and `from jarvis.server.routes import router` (tests) work unchanged |

All **33 inventoried endpoints** (see `docs/routes-inventory.md`) still exist
with the same paths/methods — verified by mounting the router and counting
OpenAPI paths (31 distinct paths; `/mission` and `/persona` each serve
GET+POST). `routes.install_log_handler()`, `routes._get_whisper_model`,
`routes._should_try_piper` and `routes._synthesize_with_piper` are
re-exported for `server/app.py`'s preload, which is unchanged apart from
the media import (below).

## 2. Model loading — new `jarvis/models/` package

| Module | Contents (moved verbatim from `routes.py`) |
|---|---|
| `models/whisper.py` | Cached faster-whisper model, CUDA-runtime probe, CPU fallback, VRAM-manager eviction callbacks, YouTube-hallucination filter |
| `models/tts.py` | Piper / NVIDIA Riva / Edge-TTS engines, voice resolution, `_pcm16_to_wav` |
| `models/__init__.py` | Public re-exports (`get_whisper_model`, `synthesize_with_piper`, …) |

Loads stay lazy — importing the package loads no model.

## 3. Media generation — `jarvis/plugins/media_generation.py` (1,464 lines) → `jarvis/plugins/media/`

| Module | Contents |
|---|---|
| `media/common.py` | Paths, hashing, aspect fitting, `__JARVIS_MEDIA__` envelope |
| `media/flux.py` | FLUX.2-klein-4B pipeline singleton, GGUF download, image-model registry (`list_image_models` / `select_image_model`), generation loop with OOM hardening |
| `media/hunyuan3d.py` | Hunyuan3D-2GP Mini Turbo backend (source/weights download, seed/MC retry loop, image-relief GLB fallback) |
| `media/trellis.py` | TRELLIS.2 FP8 textured backend (isolated Python 3.12 worker venv + subprocess) |
| `media/providers.py` | **ONE `Image3DProvider` interface** (`name` / `kind` / `generate() -> (kind, out_path, device)`) with `Trellis2Provider` + `Hunyuan3DProvider` and `resolve_3d_provider()` from `JARVIS_3D_BACKEND` (default `trellis2-fp8`; `hunyuan`/`hy3d`/`hunyuan3d`/`hunyuan3d-2gp` select Hunyuan3D). `run_image_to_3d()` keeps the old dispatcher signature |
| `media/tools.py` | The three tools — `image_generate`, `image_to_3d`, `text_to_3d` — unchanged names/descriptions/parameters/payloads |
| `media/__init__.py` | `register()` + re-exports used by routes/ws/app |

The plugin name stays **`media_generation`** (PluginInfo + pending-registration
key), so config, `/api/plugins` output and the registry are unchanged; the
plugin loader discovers the `media` package automatically. One path fix was
required by the move: the TRELLIS worker script is now at
`Path(__file__).parents[2] / "workers" / "trellis2_worker.py"`. The
`image_to_3d` tool now takes the device string from the provider's return
value instead of a module global. `server/ws.py` (`/image-model` command)
and `server/app.py` (FLUX preload) import from `jarvis.plugins.media`.

## 4. Unified memory — new `jarvis/core/memory_store.py`

`MemoryStore` composes `Memory` (keyword SQLite) + optional `SemanticMemory`
(embedding recall) over the **same SQLite file**. No schema change, no data
migration: both tables are untouched, only access is unified.

- Keyword API (`set_pref`, `notes`, `search`, `append_message`, … — the full
  public `Memory` surface) delegates to `Memory`.
- `await store.remember(text, kind, meta)` / `await store.recall(query, k,
  min_score)` delegate to `SemanticMemory` when one was built, and degrade
  to `False` / `[]` when embeddings are unavailable — exactly the old
  behaviour.
- `await store.search_all(query)` returns `{"keyword": [...], "semantic": [...]}`.
- `main.py` now builds `MemoryStore(cfg, semantic=semantic)`; the
  Orchestrator takes the store and no longer has a separate `semantic`
  parameter (`_recall_for` / `_auto_remember` / `_ultimate_on` read it from
  the store). `server/app.py`'s type hint follows. Memory tools, routes and
  ws read the same object, so nothing else changed.

## 5. Agents — merged into the Orchestrator (decision)

**Decision: merge, don't executor-ify.** The nine files in `jarvis/agents/`
were dataclass *personalities* (`name`, `description`, `system_prompt`,
`tool_allowlist`) with no execution logic; the real "agent" behaviours —
planning (`_maybe_plan`), multi-intent swarm (`classify_multi` +
`run_swarm`), intent routing, reflection — already live in the
Orchestrator, and `Agent.applies_to()` was never called anywhere. Turning
nine personas into nine executors would have duplicated the orchestrator's
tool loop nine times for no gain. So:

- `jarvis/agents/` is **deleted** (10 files).
- The nine personas moved verbatim (same names, descriptions, prompts,
  allowlists) to `jarvis/core/modes.py` as `Mode` + `ModeRegistry` +
  `build_default_registry(cfg)` (same `cfg.agents` toggles). `Agent` /
  `AgentRegistry` are kept as aliases.
- The Orchestrator is the only executor: `_active_mode`, `set_mode()` (with
  a `set_agent()` alias), same system-prompt injection.
- `/api/agents`, the `/agent` chat command, `main.py --check` output and
  `config.yaml`'s `agents:` section are unchanged.

**Changed (the one intentional behaviour change):** the tool allowlist is
now *enforced* in `Orchestrator._invoke_tool` — the single choke point for
the tool loop, intent fast-path and swarm. With a mode active, a tool
outside its allowlist is denied with
`tool '<name>' is not available in <mode> mode` (logged, surfaced as a
denied tool result, recorded in history). Previously the allowlist was
dead code. Empty allowlist still means "all tools" (planner, executor).

## 6. Web — `store.ts` / `voice.ts` split + one env file

```
web/src/lib/store/        types.ts    — all store types + SKINS
                          session.ts  — nextId, boot-greeting dedup, session-archive keys
                          index.ts    — StoreState + useStore
web/src/lib/store.ts      — re-export shim (existing imports unchanged)

web/src/lib/voice/        tts.ts      — server/browser TTS + streaming queue
                          mic.ts      — JarvisMic, VAD, wake-word gate, barge-in, live mode
                          index.ts    — re-exports
web/src/lib/voice.ts      — re-export shim (existing imports unchanged)
```

`tts.ts` ↔ `mic.ts` import each other, but only inside function bodies at
runtime (no module-eval-time cycle); `vite build` passes.

Backend address is now a **single env file**:

- `web/.env.example` — `VITE_JARVIS_HOST=127.0.0.1`, `VITE_JARVIS_PORT=7341`.
- `web/src/lib/config.ts` — `JARVIS_HOST` / `JARVIS_PORT` / `JARVIS_API_URL`
  (the one place the web app reads them). `lib/api.ts` (`API_BASE`) and
  `lib/ws.ts` derive from it; no more hardcoded `127.0.0.1:7341` in app code.
- `web/vite.config.ts` — dev proxy target from `loadEnv` (`VITE_JARVIS_*`),
  `JARVIS_API` shell var still overrides.
- `electron/main.cjs` — reads the same `web/.env` (tiny built-in parser, no
  new dependency) for `VITE_JARVIS_HOST`/`VITE_JARVIS_PORT`, overridable via
  `JARVIS_HOST`/`JARVIS_PORT` env vars; spawns the backend with `--host` too.
- Decorative "Port 7341" labels in HUD components (`Subsystems.tsx`,
  `HoloStudio.tsx`) were left alone — display text, not connection config.

A standard `web/src/vite-env.d.ts` (`/// <reference types="vite/client" />`)
was added so `import.meta.env` typechecks; it did not exist before because
nothing in `src/` used `import.meta.env`.

## Intentionally unchanged

- All 33 API paths/methods; tool names (`image_generate`, `image_to_3d`,
  `text_to_3d`) and their parameters/payloads; plugin name
  `media_generation`; `/api/agents` output; `/agent` command; `config.yaml`
  (no new keys); SQLite schemas and stored data; model files under
  `data/models/` and `data/voices/` (untouched); `data/` contents in general.
- Whisper/Piper/Riva/FLUX/Hunyuan3D/TRELLIS loading, tuning constants,
  fallbacks and VRAM behaviour — moved, not modified.
- No GitHub interaction: no push, branches or PRs (parent pushes).

## Verification (this tree, `/tmp/jarvis-full`)

- `pytest tests/ -q`: **13 passed, 3 skipped** (baseline identical).
- `node --test tests/wakeWord.test.mjs`: **7 passed** (baseline identical;
  node_modules symlinked from `/tmp/jarvis-p1/web`, symlink removed after).
- `py_compile` on every changed/created `.py` file: clean.
- `python -c "from jarvis.config import load_config; ..."` prints
  `gemma4:31b-cloud` (config loads).
- Router mounted on a test app: 31 distinct OpenAPI paths = all 33 endpoints
  (GET+POST share `/mission`, `/persona`); `/api/health` returns 200.
- Plugin registry `load_all()`: 12 plugins, 77 tools; `image_generate` /
  `image_to_3d` / `text_to_3d` registered under `media_generation`.
- `MemoryStore` smoke test on a temp DB: prefs/notes/search round-trip,
  `recall`/`remember` degrade to `[]`/`False` without embeddings.
- `tsc --noEmit`: only the pre-existing `MediaReveal.tsx:369` framer-motion
  `MotionStyle` error (present without any Phase 2 file; untouched file).
- `vite build`: succeeds (1,009 modules).

## Known limits / risks

- `/tmp/jarvis-venv` lacks `rich` (and `uvicorn`/`numpy`), so the full boot
  path (`python -m jarvis.main --check`, `create_app`) cannot be exercised
  in this environment — pre-existing, not caused by Phase 2. The routes,
  registry, modes and memory store were each verified in isolation instead.
- FastAPI 0.165 represents nested `include_router` as lazy `_IncludedRouter`
  entries; routes materialise on request/OpenAPI (verified working) rather
  than appearing eagerly in `router.routes`.
- The allowlist enforcement (section 5) is the only behaviour change: a user
  with an active mode who asks for an out-of-allowlist tool now gets a
  denial instead of the tool running. If that proves annoying, the guard is
  one block in `Orchestrator._invoke_tool`.
