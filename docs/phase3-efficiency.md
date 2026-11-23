# Phase 3 — Efficiency

What changed, what it saves, and what was deliberately left alone.
All measurements below are from the local mirror (`/tmp/jarvis-full`);
LLM-call counts are counted with a stub brain (see
`tests/test_phase3_efficiency.py`), not a live model.

## 1. True lazy loading — no model load at server startup

**Before:** `server/app.py` unconditionally background-preloaded Whisper
(~1.5 GB VRAM) and Piper on every boot; FLUX was already gated off.
**After:**
- The preload task only runs when `voice.preload_models: true` in
  `config.yaml` (default `false`) or `JARVIS_PRELOAD_MODELS=1` in the
  environment. Otherwise the lifespan logs that preload is disabled and
  starts the server immediately.
- Whisper / Piper still load on first STT / TTS use — `jarvis/models/whisper.py`
  (`_get_whisper_model`) and `jarvis/models/tts.py` (`_synthesize_with_piper`)
  already cache the loaded model, so the first request pays the load cost
  once and later requests are instant. Nothing about the caches changed.
- `jarvis/plugins/media/flux.py`: `_FLUX_IDLE_UNLOAD_S` is now `120.0`
  (was `0.0` = never unload). The FLUX pipeline frees its VRAM 120 s after
  the last generation; the next generation reloads it. The existing
  `register_idle_unload` / `schedule_idle_unload` wiring already honoured
  `> 0`, so this is a one-line behaviour change. Set it back to `0` to keep
  the pipeline resident.

**Effect (expected):** server starts in ~1 s instead of waiting on
multi-GB model loads, and holds ~0 GB of model VRAM at idle (was ~1.5 GB
Whisper + Piper from boot). First STT/TTS request is slower (one-time
~1–2 s model load) — the documented trade-off for the flag.

## 2. Whisper eviction actually works

**Before:** `jarvis/models/whisper.py::_evict_whisper_from_gpu` was a no-op
unless `EVICT_WHISPER_FOR_FLUX=1`, so the VRAM manager's "exclusive GPU
lock" never freed anything when FLUX/SF3D took the GPU — the lock's
docstring promised eviction, the callback silently declined.
**After:**
- Eviction is **on by default**. When a media job acquires
  `gpu_exclusive_async(GPUResource.FLUX|SF3D)` the manager evicts Whisper
  (drops the cached model object, flushes VRAM); the next STT request
  lazy-reloads it. Set `EVICT_WHISPER_FOR_FLUX=0` to keep Whisper resident
  (only safe on cards with comfortable VRAM headroom).
- `jarvis/core/vram_manager.py::gpu_exclusive_async`: eviction now runs in
  an executor, not on the event loop — an evict callback takes Whisper's
  lock, which an in-flight STT transcription may be holding in a worker
  thread. Running it inline would stall the whole loop until that
  transcription finished. (The sync `gpu_exclusive` is unchanged — it
  already runs in a thread.)
- Restore stays lazy by design: `_restore_whisper_to_gpu` only logs;
  the model reloads on next use.

**Effect (expected):** FLUX gens get ~1.5 GB more headroom on a 16 GB card
instead of OOMing or spilling to sysmem; STT after a gen pays one ~1–2 s
reload, only if the user speaks again.

## 3. Fewer LLM calls per message

Worst case before (planned, compacting turn): plan + main hop(s) +
reflect + suggest + summarize = up to 5–6 calls. After:

| Call | Before | After |
| --- | --- | --- |
| `_maybe_plan` | any message ≥ 60 chars | only ≥ 60 chars **and** multi-step / goal-shaped (`_looks_complex`: sequencing words, goal verbs, numbered lists, ≥ 3 clauses/sentences). New knob `ultimate.plan_require_complexity` (default `true`) restores the old length-only heuristic when `false`. The LLM's `NONE` reply is still a second filter. |
| main hop | 1 per hop | unchanged |
| `_reflect` | inline, blocks DONE, could continue the turn | **fire-and-forget after the reply**. If a planned step is missing it surfaces as a late `INFO` event ("Self-check: …") instead of continuing the turn. |
| `_suggest` | inline, blocks DONE | **fire-and-forget after the reply**. Chips still arrive as `SUGGESTIONS`, just after `DONE` instead of before it. |
| `_summarize` (compaction) | inline before the main hop | **background task** — it only feeds *future* turns' prompts. `_summarize` was already only reachable via `_maybe_compact_history`; there is no separate sixth call on the response path anymore. |

**Mechanics** (`jarvis/core/orchestrator.py`, `jarvis/server/ws.py`):
- `Orchestrator._schedule_late()` tracks background tasks;
  `_reflect_late` / `_suggest_late` / `_compact_late` push their events into
  a late queue; `drain_late_events()` yields them. `ws.py::run_brain`
  drains the queue after the main generator yields `DONE` — the receive
  loop stays hot because `run_brain` is a background task. A new chat
  cancels the previous turn's unfinished late tasks (best-effort follow-ups
  are dropped when the user moves on).
- Verified by test: with a 0.5 s suggestion call, the turn (THINKING →
  ASSISTANT → DONE) completes in < 0.01 s; suggestions arrive via the drain.

**Deliberate behaviour change:** reflection no longer auto-continues the
turn when a planned step is missed — that continuation is exactly what
delayed the reply. The missed step is now reported, not executed. If
auto-continuation is wanted back, it belongs behind a flag in Phase 4.

## 4. Vector index — sqlite-vec (+ pure-Python fallback)

**Before:** `semantic_memory.py::_load_vectors()` re-read and re-decoded
**every** stored vector from SQLite on **every** recall, then a linear
`np.dot` scan — and it hard-required `numpy`, which isn't even installed
in the minimal venv (the module couldn't be imported there at all).

**After** (`jarvis/core/semantic_memory.py`, public API unchanged):
- **Preferred backend: sqlite-vec** (`vec0` virtual table
  `semantic_memory_vec`, `rowid` mirrors `semantic_memory.id`, unit-normalised
  float32 vectors). Recall is one indexed KNN query
  (`embedding MATCH … AND k = ? ORDER BY distance`); insert appends one row.
  `distance` is L2 over unit vectors, so `cosine = 1 − d²/2` exactly.
  The `semantic_memory` table is **unchanged** — the vec table is an additive
  index, rebuilt from the stored blobs if its row count ever drifts from the
  source table (checked at open and on recall; inserts stay O(1)).
- **Fallback backend: pure-Python in-memory index.** The normalised matrix
  is loaded **once per process** (first recall) and appended to incrementally
  on insert, never re-read per retrieval. Cosine is a dot product over unit
  vectors. No dependency at all.
- Backend selection is automatic: sqlite-vec is used when the package
  imports and the SQLite connection accepts `load_extension`; otherwise the
  Python index (`SemanticMemory.index_backend` reports which). `prefer_vec=False`
  forces the fallback (used by tests).
- `numpy` is gone from this module: blobs are `struct`-packed float32
  little-endian, byte-identical to the old `numpy.tobytes()` on x86, so
  existing databases keep working.
- Two sqlite-vec quirks found by testing and handled in code:
  `INSERT OR REPLACE` on a vec0 table raises UNIQUE instead of replacing
  (use DELETE + INSERT); the vec table must be synced, not rebuilt, on
  insert or every `remember` becomes O(N).

**Effect (measured):** recall no longer touches the full table per turn;
with the vec backend it is a single indexed query. Smoke-tested with
deterministic 4-dim vectors on both backends (recall ordering, scores,
forget, restart persistence all green).

**Switching to FAISS later:** keep the `remember` / `recall` / `forget`
API and swap the backend — FAISS wants an `IndexFlatIP` over
unit-normalised float32 vectors persisted with `faiss.write_index` next to
the DB, with the same rowid↔id mapping the vec table uses today. Not done
now: FAISS wheels are ~10–30 MB + a native dependency for a personal-scale
store where sqlite-vec already gives indexed KNN.

## 5. Caching + one shared HTTP client

**Before:** `jarvis/plugins/web_tools.py` built a fresh `httpx.AsyncClient`
(TLS + pool setup) on **every** search/fetch/provider call, and identical
queries re-fetched every time.
**After:**
- One process-wide shared client (`_get_client()`), recreated if the event
  loop changes. All providers (`_google_news`, `_ddg_text`, `_ddg_images`,
  `_yt_search`, `_brave`, `_tavily`, `_serpapi`) and `web_fetch` use it with
  per-request timeouts. `aclose_shared_client()` closes it on shutdown.
- `web_search` and `web_fetch` results are cached **10 minutes**
  (`_WEB_CACHE_TTL_S = 600`, max 128 entries, oldest evicted). Only
  successful results are cached — failures / soft errors are never stored.
  Cache key is `(tool, provider, query, max_results)` / `(url, max_chars)`.
  `clear_web_cache()` is the test/admin hook.
- Robustness fix found by testing: httpx 0.28 raises `InvalidURL` at
  client construction when the environment's `NO_PROXY` contains a bare
  `::1` (this sandbox does). The shared client now falls back to
  `trust_env=False` instead of failing every web request. Note: the
  pre-existing `LLMBrain` / `EmbeddingClient` clients construct with
  default env handling and hit the same trap in this sandbox — out of
  scope for Phase 3, but worth a follow-up if the server ever runs here.

**Effect (expected):** repeat searches/fetches within 10 min cost 0 HTTP
requests; every web call skips client/TLS setup (connection reuse).

## 6. requirements split

`requirements.txt` is still the full umbrella (`setup.bat` unchanged — it
runs `pip install -r requirements.txt`), now composed of `-r` includes:

| File | Contents |
| --- | --- |
| `requirements-core.txt` | server, chat loop, memory, tools; **+ `sqlite-vec`** (Phase 3), `nvidia-ml-py` |
| `requirements-voice.txt` | edge-tts, piper-tts, faster-whisper, nvidia-riva-client, SpeechRecognition, pyttsx3 (+ optional CUDA DLL note) |
| `requirements-vision.txt` | opencv-python, mss, pytesseract, Pillow |
| `requirements-gpu-media.txt` | torch, diffusers, transformers, accelerate, sentencepiece, safetensors, huggingface-hub, gguf, einops, omegaconf, pymeshlab, mmgp, rembg, onnxruntime |
| `requirements-browser.txt` | playwright |

`numpy` is listed **nowhere** — it arrives transitively with torch, and
Phase 3 removed the last hard numpy dependency (semantic memory).

## Verification (local mirror, 2026-11-24)

- `pytest tests/ -q`: **35 passed, 3 skipped** (baseline 13/3; +22 new
  Phase 3 tests in `tests/test_phase3_efficiency.py`, 1.7 s total).
- `node --test tests/wakeWord.test.mjs`: **7 passed** (node_modules
  symlinked from `/tmp/jarvis-p1/web/node_modules`, removed afterwards).
- `py_compile` on every changed `.py`: **OK**.
- Config load: `gemma4:31b-cloud`, `preload_models=False`,
  `plan_require_complexity=True`.
- `pip install --dry-run -r requirements-core.txt`: resolves OK.
  `pip install --dry-run -r requirements.txt` (full umbrella) was still
  resolving after ~5 min and was stopped — the resolver stalls on the
  pre-existing `mmgp==3.2.7` pin / torch backtracking, not on the split:
  all six files parse cleanly with pip's own requirements parser
  (umbrella = 38 entries = 13 core + 6 voice + 4 vision + 14 gpu-media +
  1 browser), and the core dry-run proves the `-r` include syntax works.
  Rerun the full dry-run on a machine with a warm pip cache to confirm.

## Intentionally unchanged

- `data/tmp/hf-cache-probe/.../pipeline_fp8.json` — untouched (cache
  artifact, local copy differs from remote for unknown reasons).
- `data/models/`, `data/voices/`, all tracked files — nothing deleted.
- No branches / PRs / pushes; all work is in the local mirror only.
- The `semantic_memory` **table** schema: untouched (the vec table is additive).
- `LLMBrain` / `EmbeddingClient` HTTP clients: not touched (see the
  `NO_PROXY` note above — same trap, separate fix).
- Reflection auto-continuation: removed by design (see §3); the missed
  step is reported, not executed.
- No scheduler / persistent missions (Phase 4 scope), no FAISS (see §4).
