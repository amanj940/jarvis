# Backend port — admin endpoints for Settings

Backend counterpart of the Settings UI gap fix (FG-001…FG-020). These
routes expose, over REST, the model cascade, verified models, config,
API-key pools, council and swarm — the things the Settings page needs
and previously had no backend for.

All routes live under `/api` (registered in `jarvis/server/routes/`).

## Endpoint table

| Endpoint | Method | Permission | What it does |
|---|---|---|---|
| `/api/models/cascade` | GET | SAFE | Failover cascade tiers. Prefers `LLMBrain.get_cascade_tiers()`; falls back to tiers built from live config + `providers_catalog`. Each tier is annotated with key-pool health when a KeyManager exists. |
| `/api/models/verified` | GET | SAFE | Verified lineup from `data/model_council.json` (via `council.roster_from_verified_lineup`) with measured avg latency from `data/models.db`, plus the last council benchmark. |
| `/api/models` | GET | SAFE | Provider list from `providers_catalog` + the currently configured model/endpoint. |
| `/api/config` | GET | SAFE | Full config dump with anything secret-shaped masked (`••••••••`). |
| `/api/config` | POST | CAUTION | Validates a partial update through Pydantic, then deep-merges it into `config.yaml`. Requires restart. See restrictions below. |
| `/api/keys` | GET | SAFE | Masked keys per provider + whether each provider has an active key. Never returns a full key. |
| `/api/keys/probe` | POST | CAUTION | Pool-membership + status check for one key (by full key or masked value). `{"live": true}` also does a real `GET {endpoint}/models` (2 s timeout) and marks the key successful/invalid accordingly. |
| `/api/keys/add` | POST | CAUTION | Adds one key to a provider pool. 409 if already present. |
| `/api/keys/{key_id}` | DELETE | CAUTION | Removes a key by masked value (optionally `?provider=`). 404 if not found. |
| `/api/keys/bulk-import` | POST | CAUTION | Adds many keys to one provider pool; reports added/duplicates. Never echoes keys. |
| `/api/council/members` | GET | SAFE | Council members that can actively vote (live availability check, else the verified lineup). |
| `/api/council/roster` | GET | SAFE | Static + dynamic council rosters. |
| `/api/council/fast-members?n=` | GET | SAFE | The n fastest members by measured latency. |
| `/api/council/last-benchmark` | GET | SAFE | Last council benchmark results. |
| `/api/swarm/status` | GET | SAFE | Swarm runner availability + swarm-kind task counts from the task store. |
| `/api/swarm/tasks` | GET | SAFE | Swarm-kind tasks from the Phase 4 task store. |

## Safety rules (enforced in code, not just documented)

- **Confirm mode required for writes.** `POST /api/config` and every
  `/api/keys` write return **403** unless `permissions.mode` is
  `confirm`. They are refused outright under `bypass`. (Note: the
  shipped `config.yaml` currently sets `mode: bypass`, so these writes
  403 until the mode is changed to `confirm` — that is intentional.)
- **No full key ever leaves the server.** Only masked values
  (`sk-a***bc12`) are returned; request bodies carrying a full key are
  never logged or echoed.
- **`POST /api/config` restrictions:** only the sections in
  `_CONFIG_WRITABLE_SECTIONS` may change (`permissions` is excluded —
  permission mode can never be flipped from the API); any update
  containing an `api_key`/`token`/`secret`/`password`-shaped value is
  rejected with 400; the merged config is validated with Pydantic
  before anything is written; the raw `config.yaml` is round-tripped
  so comments and unknown keys survive. Changes need a backend restart.
- **Graceful degradation.** `key_manager`, `council` and
  `providers_catalog` arrive with the audit/fixes merge and may not
  exist on this build yet. Handlers import them lazily and answer
  **503 `{"available": false, "reason": ...}`** when a module is
  absent, instead of crashing the app. The cascade endpoint always
  works (config fallback); `/api/models` works without the catalog
  (current model only).

## What is still missing

- **No live key probe by default.** `POST /api/keys/probe` without
  `"live": true` only checks pool membership/status; the live check
  needs a known provider endpoint and network access.
- **No key persistence beyond the process.** Added keys live in the
  in-memory `KeyManager` (and in `brain.key_manager` once the
  audit/fixes brain lands). There is no vault/config write-back for
  keys yet — restart drops keys that were only added via the API.
  (The KeyManager's own `to_dict()` can serialize pools for a future
  config write-back.)
- **No `/api/mcp/servers/{name}/test|logs` endpoints.** The MCP
  test/logs endpoints the Settings UI wants do not exist on either
  branch (the logs endpoint does not exist even on audit/fixes).
- **No Monitor/Auth/Vault admin endpoints.** FG-021–027 need backend
  tabs that do not exist yet.
- **No council deliberation trigger.** These are read endpoints only;
  starting a council run still goes through the orchestrator, not REST.
- **No swarm run trigger.** `run_swarm` is dispatched by the LLM via
  the `parallel_tasks` meta-tool; there is intentionally no REST
  endpoint that fans out arbitrary tool calls.

## Verification

`tests/test_admin_endpoints.py` — 24 tests, no network, no real keys
(stub modules stand in for the audit/fixes modules; separate tests
assert the honest 503 when a module is absent).
