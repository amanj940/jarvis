# Phase 4 — Assistant behaviour

Work done in the local mirror on top of Phase 3 (`ui-hud-upgrade` @ `d94cb1e3`).
Nothing was pushed; the parent verifies and pushes.

## 1. Persistent task system — `jarvis/core/tasks.py`

- `TaskStore` — SQLite table `tasks` (`id, title, kind, status, schedule,
  payload, created_at, updated_at, last_run, next_run, result`) in the same
  DB file as memory (`config.memory.db_path`), so tasks survive a restart.
  `create()` validates the 5-field crontab (bad cron → `ValueError` → HTTP
  400) and computes `next_run`; `update()` / `cancel()` / `mark_*()` cover
  the lifecycle. Statuses: `pending | running | done | failed | cancelled`.
- `TaskScheduler` — APScheduler `AsyncIOScheduler` (new dependency, see
  below). `start()` re-arms every `pending` task from SQLite on boot;
  one-shot tasks run once at `next_run`, cron tasks re-arm with their next
  fire time. `run_task()` executes a task through its kind handler and
  records the outcome in the DB (+ ActionLog).
- Built-in kinds: `reminder` (records + returns the message) and `note`
  (appends a project note). Any other kind needs
  `register_handler(kind, async fn)` — unhandled kinds are marked `failed`
  with `"no handler for kind …"` instead of being silently dropped.
- Wiring: `main.build_services()` builds the store+scheduler;
  `server/app.py` stashes them on `app.state` and starts/stops the
  scheduler in the lifespan.
- API (`jarvis/server/routes/system.py`): `GET /api/tasks`,
  `POST /api/tasks`, `GET /api/tasks/{id}`, `PATCH /api/tasks/{id}`,
  `POST /api/tasks/{id}/cancel`, `POST /api/tasks/{id}/run`.
- New dependency: `apscheduler>=3.10.0` added to `requirements-core.txt`
  (installed in the venv for tests). `TaskStore` itself is plain SQLite
  and works without APScheduler.

## 2. Unified voice state machine — `jarvis/core/voice_state.py`

- States: `idle | listening | thinking | speaking | interrupted` — the
  same vocabulary as the frontend orb (`web/src/lib/store/types.ts`,
  `OrbState`), plus `interrupted`.
- `VoiceStateMachine`: explicit allowed-transition table; illegal
  transitions are rejected (return `False`, logged) instead of corrupting
  state. `barge_in()` is the blessed shortcut
  `speaking/listening/thinking → interrupted → listening`; `cancel()`
  returns to `idle`. A 50-entry transition history is kept.
- Wiring: `Orchestrator.voice_state`; `handle_user_message()` is now a
  wrapper that sets `thinking` for the turn and returns to `idle` when the
  generator finishes/is cancelled. `ws.py` emits `{"type": "voice_state"}`
  at turn start/end, accepts `{"type": "voice_state"}` reports from the
  frontend and `{"type": "interrupt"}` (barge-in → cancels the in-flight
  turn). `EventKind.VOICE_STATE` added.
- Routes (`jarvis/server/routes/voice.py`): `GET /api/voice/state`,
  `POST /api/voice/state` (illegal transition → 409), `POST
  /api/voice/interrupt`. `/api/tts` sets `speaking`; `/api/stt` sets
  `listening` then `thinking`; `/api/tts/status` reports the current
  `voice_state` and `stt_language`.
- **Leftovers / known gap (deliberate):** the backend cannot know when
  browser TTS playback ends, so `speaking → idle` still depends on the
  frontend reporting back via `POST /api/voice/state` (or the WS
  `voice_state` message). The frontend orb code (`web/src/lib/voice/tts.ts`)
  was **not** changed in this phase — wiring the orb to report back is a
  small frontend follow-up; the backend contract (REST + WS messages above)
  is in place. The old scattered flags were the frontend-only orb setters;
  there were no backend voice flags to replace.

## 3. Configurable Arabic STT + Arabic persona

- **Decision (explicit): STT defaults to Arabic, persona stays English
  unless the user opts in.** The user speaks Arabic, so
  `voice.stt_language` defaults to `"ar"` (`jarvis/config.py` +
  `config.yaml`). The persona is a bigger behavioural change, so the
  English persona (`persona/jarvis.md`) remains the default
  (`A.persona_file: persona/jarvis.md`); switching to Arabic is one config
  line — see below. Nothing changes silently for existing users.
- `voice.stt_language: "ar"` (also `"en"` / `"auto"`), plus optional
  `voice.stt_initial_prompt` override. `jarvis/models/whisper.py`:
  `build_transcribe_kwargs(cfg, language, initial_prompt)` resolves
  language as per-request `?language=` > config > `"ar"`, and picks the
  matching initial prompt (Arabic prompt when the language starts with
  `ar`, English otherwise). `/api/stt` uses it — **no more hardcoded
  `language="en"`** anywhere in the STT path. The Arabic hallucination
  filter was extended (`شكرا على المشاهدة`, `اشتركوا في القناة`,
  `مع السلامة`, `إلى اللقاء`, `وداعا`).
- Arabic persona: `persona/jarvis-ar.md` — full translation of
  `persona/jarvis.md` with the same structure (character, JARVIS OS
  doctrine, tool hierarchy, execution discipline, reply protocol),
  British-butler tone adapted to Arabic, addressing the user as «سيدي».
- To run JARVIS in Arabic: set in `config.yaml`
  `A.persona_file: persona/jarvis-ar.md` (STT is already Arabic by
  default). TTS voice selection is unchanged (Piper/Edge English voices);
  an Arabic TTS voice is a separate follow-up, not part of this phase.

## 4. Real error recovery

- LLM retries (`jarvis/core/brain.py`): transient failures (connection
  errors, timeouts, HTTP 429 / 5xx) are retried up to 3 attempts with
  exponential backoff (`LLM_RETRY_BASE_S = 0.5`, `×2` per attempt) in the
  OpenAI-compatible non-stream path, the Anthropic path, and the streaming
  path (stream retries only when it failed *before* the first token was
  delivered — re-running mid-stream would duplicate tokens already shown).
  Non-transient 4xx errors return immediately, unretried.
- Embeddings (`jarvis/core/embeddings.py`): `embed_batch()` now retries
  transient errors up to 3 times (0.2 s base backoff) before entering the
  existing 90 s disabled window.
- Model health (`GET /api/health`): now probes the model endpoint
  (`GET {endpoint}/models`, 2 s timeout, never raises) and reports
  `model.reachable` + status/error, plus Whisper importability and
  Piper/Edge-TTS availability (checked without loading any model), the
  current voice state, and the pending-task count. An unreachable model is
  reported, not fatal — health stays 200.
- Auditable action log (`jarvis/core/logger.py`): `ActionLog.recent(n,
  only_failed)` added; `GET /api/actions?n=100&only_failed=true` exposes
  it. The orchestrator already recorded `ran`/`failed`/`denied` for tool
  executions; Phase 4 also records the two previously silent paths —
  **unknown tool** and **mode-blocked tool** — as `failed`/`denied`
  entries, so no tool invocation outcome is swallowed anymore.

## 5. Project memory — goals

- `jarvis/core/memory.py`: new `project_goals` table
  (`id, project, title, notes, status, created_at, completed_at`) with
  `add_goal()`, `goals(project, status)`, `complete_goal(id, done)`;
  `search()` now returns goal hits and `delete("goal", id)` works.
  Pass-throughs added to `MemoryStore`.
- API (`jarvis/server/routes/memory.py`): `GET /api/memory/goals`,
  `POST /api/memory/goals`, `POST /api/memory/goals/{id}/complete`, plus
  `GET /api/memory/fixes?signature=` (past-fixes lookup, previously only
  reachable from tools). Project notes/fixes already existed and are
  unchanged.

## Verification (this mirror)

- `pytest tests/ -q`: **70 passed, 3 skipped** (baseline 35 passed /
  3 skipped + 35 new Phase 4 tests in `tests/test_phase4_tasks.py`, all
  passing). One pre-existing test updated: `tests/test_wake_word.py`
  asserted exact equality on `/api/health`'s `voice` object, which Phase 4
  deliberately extends — it now asserts the `wake_word` value.
- `node --test web/tests/wakeWord.test.mjs`: **7 passed** (node_modules
  symlinked for the run, symlink removed afterwards).
- `py_compile` on every changed `.py`: OK.
- Config load: `gemma4:31b-cloud`, `stt_language=ar`,
  `preload_models=False`, `persona_file=persona/jarvis.md`.
- `python -m jarvis.main --check`: passes (12 plugins, 77 tools,
  9 agents) when run with the sandbox proxy env stripped; see Risks.

## Intentionally unchanged

- Frontend orb/TTS code (`web/src/**`): backend voice-state contract is
  ready (REST + WS), but the orb does not yet report playback end — see §2.
- No Arabic TTS voice; TTS providers/voices unchanged.
- No new push channel for reminders: a `reminder` task records in the
  ActionLog and returns its message; surfacing it in the HUD is a
  follow-up (the task result is visible via `GET /api/tasks`).
- No scheduler UI; tasks are API-only for now.
- `data/` untouched except the normal boot-time SQLite schema creation
  (`tasks`, `project_goals` tables are created on first boot, like the
  existing memory tables). `data/tmp/hf-cache-probe/.../pipeline_fp8.json`
  untouched. Nothing pushed, no branches/PRs.

## Risks / follow-ups

- **Sandbox-only `--check` quirk:** with the sandbox's proxy env present,
  `httpx.AsyncClient()` construction fails (`InvalidURL` on the
  `no_proxy` value's `[fd8b:…::1]` entries) — pre-existing, hits
  `LLMBrain.__init__` before any Phase 4 code runs, and does not occur on
  the user's machine or with the proxy env stripped. The health probe
  catches this and reports `reachable: false`.
- Task execution has no retry of its own: a failing task is marked
  `failed` and (for cron) is **not** re-armed until edited — deliberate,
  so a broken recurring task does not spin forever; re-arming failed cron
  tasks is a possible follow-up.
- APScheduler runs in-process: tasks do not run while the server is down;
  missed one-shot runs are not backfilled (300 s misfire grace only).
