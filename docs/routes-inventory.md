# Routes inventory — `jarvis/server/routes.py`

Inventory only (Phase 1). The file is **not split yet** — see
`docs/phase1-cleanup.md`. It is 1,434 lines, 52 KB, with **33 endpoints**
on `router` (mounted at `/api` by `jarvis/server/app.py`), plus the
WebSocket and the frontend routes in `app.py` (see "App-level routes").

## Endpoints

| # | Method | Path | Handler (line) | Purpose | Model / GPU involvement |
|---|---|---|---|---|---|
| 1 | GET | `/logs` | `get_logs` (134) | Last `n` log records as JSON (in-memory ring buffer, max 300) | None |
| 2 | GET | `/logs/stream` | `stream_logs` (141) | SSE stream of live log lines, 15 s heartbeat | None |
| 3 | POST | `/stt` | `speech_to_text` (184) | Upload audio (webm), transcribe with Whisper | **GPU**: Whisper `large-v3-turbo` fp16 on CUDA, `small` int8 on CPU fallback; cached model, VRAM-manager eviction callbacks; sync transcribe runs in an executor |
| 4 | GET | `/health` | `health` (405) | Readiness: status, model, plugins/tools/agents, permission mode, wake word | None (no model loaded) |
| 5 | GET | `/image-models` | `image_models` (430) | List selectable image models | None (lists only) |
| 6 | POST | `/image-models/select` | `select_image_model_endpoint` (437) | Switch the active image model | None (selection only) |
| 7 | GET | `/stats` | `stats` (447) | CPU/RAM/disk/net/battery + GPU telemetry | GPU telemetry only (NVML, or sync `nvidia-smi` subprocess, 2 s timeout) |
| 8 | POST | `/upload` | `upload_file` (559) | Drag-drop upload sink → `data/uploads/`, returns URL (+ inline base64 for images) | None |
| 9 | GET | `/files/{full_path:path}` | `serve_data_file` (595) | Serve files from allowlisted `data/` roots (`screenshots`, `voices`, `backups`, `sandbox`, `uploads`, `generated`); path-traversal guarded | None |
| 10 | GET | `/processes` | `processes` (627) | Top processes by CPU | None |
| 11 | GET | `/tools` | `tools` (639) | Registered tool catalogue (name, description, permission, plugin, parameters) | None |
| 12 | GET | `/plugins` | `plugins` (656) | Registered plugins and their permissions | None |
| 13 | GET | `/agents` | `list_agents` (671) | Agent matrix (name, description, tool allowlist) | None |
| 14 | GET | `/intents` | `list_intents_endpoint` (682) | Deterministic intent catalogue | None |
| 15 | GET | `/intents/classify` | `classify_endpoint` (690) | Dry-run intent classification — reports the intent, executes nothing, no LLM call | None |
| 16 | GET | `/memory/prefs` | `get_prefs` (709) | Stored user preferences | SQLite memory |
| 17 | GET | `/memory/notes` | `get_notes` (715) | Notes, optionally filtered by project | SQLite memory |
| 18 | GET | `/memory/paths` | `get_paths` (721) | Labelled paths | SQLite memory |
| 19 | GET | `/memory/tools` | `get_known_tools` (727) | Tools the user has used before | SQLite memory |
| 20 | GET | `/memory/search` | `search_memory` (733) | Keyword search over memory | SQLite memory |
| 21 | GET | `/memory/conversation` | `conversation` (739) | Recent conversation messages | SQLite memory |
| 22 | GET | `/persona` | `get_persona` (754) | Current persona text + name | None |
| 23 | POST | `/persona` | `set_persona` (760) | Replace the in-memory persona (not persisted to disk) | None |
| 24 | GET | `/tts/status` | `tts_status` (767) | Which TTS provider would be used (Piper / Riva / Edge) and their availability | None (checks only; Piper model file existence) |
| 25 | POST | `/tts` | `tts` (830) | Synthesise speech, fallback chain Piper → Riva → Edge | **GPU/model**: Piper ONNX voice (cached, local); Riva/Edge are cloud (network) |
| 26 | GET | `/proxy` | `iframe_proxy` (1111) | Fetch a URL server-side, strip frame-busting headers, rewrite relative URLs, so it can be iframed in the Media Bay | None (network fetch) |
| 27 | GET | `/reader` | `reader` (1194) | Fetch an article, resolve Google News wrappers, extract clean text with trafilatura | None (local extraction, no LLM) |
| 28 | POST | `/cleanslate` | `clean_slate` (1255) | Wipe conversation history (`orchestrator.reset()`); memory preserved | None |
| 29 | GET | `/mission` | `mission` (1262) | Mission config (enabled, project_path) | None |
| 30 | POST | `/mission` | `set_mission` (1272) | Set the mission project path (must exist on disk) | None |
| 31 | POST | `/analyze-image` | `analyze_image` (1292) | Vision analysis of an uploaded image via the LLM (bypasses the orchestrator) | **LLM call** (multimodal, up to 20 MB image) |
| 32 | POST | `/image-to-3d` | `image_to_3d_endpoint` (1341) | Upload an image, convert to a 3D GLB via the `image_to_3d` tool | **GPU heavy**: Hunyuan3D / TRELLIS worker (subprocess) |
| 33 | POST | `/img2img` | `img2img_endpoint` (1384) | Upload an init image + prompt, generate a guided image | **GPU heavy**: FLUX pipeline |

## App-level routes (`jarvis/server/app.py`, not in `routes.py`)

| Method | Path | Purpose |
|---|---|---|
| WS | `/ws` | Bi-directional chat / events stream (`jarvis/server/ws.py`) |
| GET | `/` | Serves `web/dist/index.html` when the frontend is built, else a JSON "frontend not built" notice |
| GET | `/{full_path:path}` | SPA fallback — serves the built file if it exists, else `index.html` |

## What lives in `routes.py` besides endpoints (why it is hard to split)

- Whisper model cache + CUDA-runtime probing + CPU fallback (`_get_whisper_model`, `_whisper_cuda_runtime_ok`, `_switch_whisper_to_cpu`, `_evict_whisper_from_gpu`, `_restore_whisper_to_gpu`)
- Piper / Riva / Edge TTS engines (`_synthesize_with_piper`, `_get_riva_service`, `_synthesize_with_riva`, `_pcm16_to_wav`)
- GPU telemetry (`_read_gpu`, NVML + `nvidia-smi` fallback)
- SSE log sink (`_SSELogHandler`, `install_log_handler`, `_LOG_BUFFER`)
- Whisper hallucination filter (`_filter_whisper_hallucination`)

Phase 2 should split along these boundaries: `routes/voice.py` (STT/TTS),
`routes/media.py` (image/3D), `routes/memory.py`, `routes/system.py`
(health/stats/logs/files/processes), with model loading moved to
`jarvis/models/`. This inventory is the checklist for that split.
