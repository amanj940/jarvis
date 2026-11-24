# Self-configuration & self-modification (self-config)

> The Three Design Laws, in code: **without breaking, without mess,
> without hallucination.** Every self-change goes
> snapshot → syntax/schema validation → affected tests → health verify →
> keep, else automatic rollback. If a step cannot be verified, the result
> says so plainly (`kept_unverified_health`) — it is never reported as
> verified.

## What this is

JARVIS can now change its own configuration and propose small code
patches to itself — safely. It is built **on** the existing self-healing
foundation, never instead of it:

| Existing foundation (unchanged, only extended) | What self-config calls |
|---|---|
| `jarvis/plugins/self_healing_tools.py` — `validate_python_syntax`, `self_healing_snapshot`, `self_healing_verify_and_guard`, `diagnose_last_crash` | `validate_python_syntax` for every patch, `self_healing_snapshot` for the git safe-commit before every change |
| `scripts/jarvis_watchdog.sh` — polls `/api/health`, rolls back to `data/.jarvis_safe_commit` | untouched by this work; remains the last-resort rollback |
| `tests/test_self_healing_tools.py` | still passing, unmodified |

New files (all owned by this system):

- `jarvis/plugins/self_config/__init__.py` — the 5 tools (below).
- `jarvis/plugins/self_config/allowlist.py` — the closed allowlist.
- `jarvis/plugins/self_config/core.py` — the two loops.
- `jarvis/plugins/self_config/guard.py` — kill-switch, protected paths,
  snapshot/health/test helpers.
- `jarvis/plugins/self_config/audit.py` — the audit log.
- `tests/test_self_config.py`, `tests/test_self_config_guard.py`
- `docs/self-config.md` (this file)

The one extension to `self_healing_tools.py` is a single new **read-only**
tool, `self_healing_guard_status` (watchdog present? safe commit? health?).
No existing tool was changed.

## The two loops

### 1. Self-configuration — `self_config_change`

```
kill-switch on? -> key on allowlist? -> value in range/type?
  -> schema validation (Config(**merged) against jarvis/config.py)
  -> snapshot (git safe-commit + config.yaml backup)
  -> atomic write -> reload validation -> health probe
  -> keep, else AUTOMATIC rollback to the backup
```

- Only **52 allowlisted keys** (+ `plugins.<name>.enabled`) may change:
  model temperature / tokens / timeout, voice provider & voices, UI,
  logging level, backups, `ultimate.*` toggles, VAD thresholds, and the
  assistant name / persona file.
- **Always refused:** `permissions.*` (the permission mode is never
  self-editable), anything secret-shaped (`api_key`, `token`, `password`,
  `secret`), endpoints, `integrations.*`, and paths that move data/logs
  (`memory.db_path`, `logging.file`, `code_execution.workdir`…).
- Unknown keys are refused — the allowlist is closed.
- Health probe outcomes: `ok` → kept; `unhealthy` (backend answering
  but broken) → rolled back; `unreachable` (backend not running) → kept
  **only** if schema + reload passed, reported as
  `kept_unverified_health` — never claimed as health-verified.

### 2. Self-modification — `self_edit_propose`

```
kill-switch on? -> path safe (.py, under root, not protected)?
  -> old_text matches exactly once?
  -> validate_python_syntax on the NEW content (before writing)
  -> snapshot (git safe-commit + file backup)
  -> write -> affected tests (tests/test_<module>.py, else import check)
  -> health probe -> keep, else AUTOMATIC rollback
```

- One file, one exact replacement per call. Ambiguous `old_text`
  (0 or 2+ matches) is refused.
- **Protected paths — never editable by this loop:** everything under
  `jarvis/plugins/self_config/` (its own guard/verify code),
  `jarvis/plugins/self_healing_tools.py`, `scripts/jarvis_watchdog.sh`,
  `jarvis/core/permissions.py`, `jarvis/config.py`, `.env`,
  `config.yaml` (use `self_config_change`), the kill-switch state, the
  audit log, and its own tests. A patch can therefore never disable its
  own guard or fake its verification.
- **Why the loop does not call `self_healing_verify_and_guard` itself:**
  that tool runs the watchdog's `verify`, which on failure does a
  `git reset --hard` to the safe commit. Firing it automatically — e.g.
  while the backend is simply not running yet — could wipe uncommitted
  work. The loop performs the same checks itself (health probe +
  file-level backup restore) and leaves `self_healing_verify_and_guard`
  as the explicit, assistant/human-invoked last resort.

## Tools

| Tool | Permission | Purpose |
|---|---|---|
| `self_config_change(key, value, reason)` | CAUTION | One allowlisted config change |
| `self_config_status()` | SAFE | Kill-switch flags + recent audit |
| `self_config_set_enabled(feature, enabled)` | CAUTION | The kill-switch |
| `self_edit_propose(path, old_text, new_text, reason)` | DANGEROUS | The safe self-edit loop |
| `self_config_audit_log(limit)` | SAFE | Read the audit log |
| `self_healing_guard_status()` | SAFE | Watchdog / safe-commit / health |

## Kill-switch

State lives in `data/self_config_state.json` (created on first use):

```json
{"config_changes_enabled": true, "self_code_edits_enabled": true}
```

Both default **ON**; every code edit is still gated behind the full
verify-and-guard pass. Either flag can be turned off with
`self_config_set_enabled` (`feature`: `config_changes` or
`self_code_edits`). A disabled feature makes its tool refuse
immediately, before any snapshot or write. Disabling the whole plugin
in `config.yaml` (`plugins.self_config.enabled: false`) also works —
the registry skips disabled plugins at load.

## Audit log

Every attempt — kept, rolled back, or rejected — is appended to
`data/logs/self_config_audit.jsonl` (one JSON object per line: timestamp,
kind, target, reason, outcome, verification detail). The log is
append-only; the self-edit loop cannot modify it.

## UI wiring (follow-up, NOT done here)

No `Settings.tsx` changes were made (another worker owns it). When the
Settings owner is ready, the mount is small — a "Self-config" section
that calls:

- `self_config_status()` for the two toggles + last audit entries,
- `self_config_set_enabled(feature, enabled)` for the kill-switch,
- `self_config_audit_log(limit)` for history.

No new backend route is needed: the tools are already in the registry.

## Known limitations

- `self_config_change` rewrites `config.yaml` with `yaml.dump`, so
  comments in the file are lost on a self-edit. Values and structure
  are preserved; hand-editing the file keeps comments.
- A config change only takes effect after a backend restart for values
  read at startup (e.g. `voice.wake_word`); the tool result does not
  restart anything.
- Health verification needs the backend running on
  `http://127.0.0.1:7341`. When it is not running, changes are honestly
  reported as `kept_unverified_health` — verify on the machine after
  pulling.
- Live end-to-end behaviour (real backend health probe after a real
  change) is **unverified — needs his machine**; the sandbox has no
  running backend. The loop itself is covered by tests, including a
  test that runs the real `pytest` subprocess path.

## Tests

```bash
python -m pytest tests/test_self_config.py tests/test_self_config_guard.py tests/test_self_healing_tools.py -q
```

34 tests: allowlist rejection (permissions/secrets/unknown/out-of-range),
config change kept / rolled back on unhealthy backend / rejected by the
kill-switch, self-edit syntax rejection / test-failure rollback /
unhealthy rollback / protected paths / ambiguous patch / kill-switch,
audit-log contents, tool registration, and plugin auto-discovery via
`registry.load_all()`.
