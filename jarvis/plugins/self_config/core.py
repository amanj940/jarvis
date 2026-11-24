"""Self-configuration and self-modification engine.

Both operations follow the same loop — the Three Design Laws in code:

1. WITHOUT BREAKING: snapshot BEFORE the change -> syntax/schema
   validation -> affected tests -> health verify -> keep, else AUTOMATIC
   rollback to the pre-change backup. No exceptions.
2. WITHOUT MESS: one file per operation, allowlist / protected-path
   enforcement, every attempt written to the audit log.
3. WITHOUT HALLUCINATION: the returned dict says exactly what was
   verified. A change kept while the backend was not running reports
   outcome ``kept_unverified_health`` — never a claim of a health check
   that did not happen.

The engine CALLS the existing self-healing tools (via the registry when
one is passed): ``self_healing_snapshot`` for the git snapshot and
``validate_python_syntax`` for code validation. It never re-implements
them, and it never calls ``self_healing_verify_and_guard`` itself —
see guard.py for why that tool stays an explicit last resort.
"""
from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

import yaml

from ...config import Config, atomic_yaml_write, load_config
from ...utils import files as F
from . import audit as audit_mod
from . import guard as guard_mod
from .allowlist import is_allowed, validate_value

CONFIG_REL_PATH = Path("config.yaml")


def _deep_get(data: dict, dotted: str) -> Any:
    cur: Any = data
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _deep_set(data: dict, dotted: str, value: Any) -> None:
    parts = dotted.split(".")
    cur = data
    for part in parts[:-1]:
        nxt = cur.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[part] = nxt
        cur = nxt
    cur[parts[-1]] = value


def apply_config_change(
    root: Path,
    key: str,
    value: Any,
    reason: str = "",
    registry: Any = None,
    verify_fn: Any = None,
) -> dict[str, Any]:
    """Safely change one allowlisted config.yaml value.

    ``verify_fn`` is an injectable ``() -> (status, detail)`` health probe
    (defaults to guard.check_health); tests inject it so no live backend
    is needed. Returns a result dict (never raises for a rejected or
    failed change — the failure IS the result, plus an audit entry).
    """
    root = Path(root)
    verification: dict[str, Any] = {}

    def _reject(details: str) -> dict[str, Any]:
        entry = audit_mod.new_entry(
            "config_change", key, reason, "rejected", verification, details
        )
        audit_mod.append_audit(root, entry)
        return {"ok": False, "outcome": "rejected", "key": key,
                "verification": verification, "details": details}

    if not guard_mod.is_enabled(root, "config_changes_enabled"):
        return _reject("config changes are disabled by the kill-switch "
                       "(data/self_config_state.json: "
                       "config_changes_enabled=false)")

    allowed, why = is_allowed(key)
    if not allowed:
        return _reject(why)
    try:
        coerced = validate_value(key, value)
    except ValueError as exc:
        return _reject(str(exc))

    config_path = root / CONFIG_REL_PATH
    if not config_path.exists():
        return _reject(f"config file not found: {config_path}")
    try:
        raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    except Exception as exc:  # noqa: BLE001
        return _reject(f"config.yaml does not parse: {exc}")
    if not isinstance(raw, dict):
        return _reject("config.yaml top level is not a mapping")

    if key == "A.persona_file":
        persona = root / str(coerced)
        if not persona.is_file():
            return _reject(f"A.persona_file must point at an existing file; "
                           f"not found: {persona}")

    old_value = _deep_get(raw, key)
    merged = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    _deep_set(merged, key, coerced)

    # Schema validation against jarvis/config.py defaults (Config model).
    try:
        Config(**merged)
    except Exception as exc:  # noqa: BLE001
        return _reject(f"schema validation failed against jarvis/config.py: {exc}")
    verification["schema"] = "passed (Config(**merged) validates)"

    # Snapshot BEFORE the change: git safe-commit + file backup.
    snapshot = guard_mod.snapshot_git(root, registry)
    backup = guard_mod.backup_file(root, config_path)
    verification["snapshot"] = snapshot or "git snapshot unavailable"
    verification["backup"] = str(backup) if backup else "no backup taken"

    def _rollback(details: str) -> dict[str, Any]:
        restored = False
        if backup is not None:
            restored = guard_mod.restore_backup(backup, config_path)
        entry = audit_mod.new_entry(
            "config_change", key, reason, "rolled_back", verification,
            f"{details} (backup restored: {restored})",
        )
        audit_mod.append_audit(root, entry)
        return {"ok": False, "outcome": "rolled_back", "key": key,
                "old_value": old_value, "new_value": coerced,
                "verification": verification,
                "details": f"{details} (backup restored: {restored})"}

    try:
        atomic_yaml_write(config_path, merged)
    except Exception as exc:  # noqa: BLE001
        return _rollback(f"atomic write failed: {exc}")

    # Verify the written file still loads and validates.
    try:
        load_config(config_path)
        verification["reload"] = "passed (load_config validates the new file)"
    except Exception as exc:  # noqa: BLE001
        return _rollback(f"written config.yaml fails to load: {exc}")

    probe = verify_fn or guard_mod.check_health
    try:
        status, detail = probe()
    except Exception as exc:  # noqa: BLE001
        status, detail = "unreachable", f"health probe raised: {exc}"
    verification["health"] = f"{status}: {detail}"

    if status == "unhealthy":
        return _rollback(f"health check failed after the change: {detail}")

    if status == "unreachable":
        # Backend is not running: syntax/schema + reload passed, but the
        # health check genuinely did not happen. Keep the change, say so.
        outcome = "kept_unverified_health"
        details = ("kept — schema + reload verified, but the backend was "
                   f"not running so no live health check ran ({detail})")
    else:
        outcome = "kept"
        details = f"kept — schema + reload + health verified ({detail})"

    entry = audit_mod.new_entry(
        "config_change", key, reason, outcome, verification, details
    )
    audit_mod.append_audit(root, entry)
    return {"ok": True, "outcome": outcome, "key": key,
            "old_value": old_value, "new_value": coerced,
            "verification": verification, "details": details}


def apply_self_edit(
    root: Path,
    rel_path: str,
    old_text: str,
    new_text: str,
    reason: str = "",
    registry: Any = None,
    verify_fn: Any = None,
    test_fn: Any = None,
) -> dict[str, Any]:
    """Safe self-edit loop for one Python file.

    propose patch -> snapshot -> validate_python_syntax (existing tool)
    -> write -> affected tests -> health verify -> keep, else AUTOMATIC
    rollback to the pre-change backup. ``test_fn`` / ``verify_fn`` are
    injectable for tests; defaults are guard.run_affected_tests /
    guard.check_health.
    """
    root = Path(root)
    verification: dict[str, Any] = {}
    target_label = str(rel_path)

    def _reject(details: str) -> dict[str, Any]:
        entry = audit_mod.new_entry(
            "self_edit", target_label, reason, "rejected", verification, details
        )
        audit_mod.append_audit(root, entry)
        return {"ok": False, "outcome": "rejected", "target": target_label,
                "verification": verification, "details": details}

    if not guard_mod.is_enabled(root, "self_code_edits_enabled"):
        return _reject("self code edits are disabled by the kill-switch "
                       "(data/self_config_state.json: "
                       "self_code_edits_enabled=false)")

    normalized = str(rel_path).replace("\\", "/").lstrip("./")
    if not normalized or normalized.startswith("/") or ".." in Path(normalized).parts:
        return _reject(f"unsafe path: {rel_path!r}")
    if not normalized.endswith(".py"):
        return _reject("self-edit only touches Python (.py) files")
    reason_protected = guard_mod.protected_reason(normalized)
    if reason_protected:
        return _reject(reason_protected)

    target = F.expand(root / normalized)
    try:
        target.relative_to(F.expand(root))
    except ValueError:
        return _reject(f"path escapes the project root: {rel_path!r}")
    if not target.is_file():
        return _reject(f"file does not exist: {normalized}")
    if not old_text:
        return _reject("old_text must not be empty")
    try:
        original = target.read_text(encoding="utf-8")
    except OSError as exc:
        return _reject(f"cannot read {normalized}: {exc}")

    occurrences = original.count(old_text)
    if occurrences == 0:
        return _reject(f"old_text not found in {normalized} (0 matches)")
    if occurrences > 1:
        return _reject(f"old_text is ambiguous in {normalized} "
                       f"({occurrences} matches); be more specific")

    new_content = original.replace(old_text, new_text, 1)

    # Syntax validation BEFORE writing anything (existing tool).
    syntax_ok, syntax_detail = guard_mod.validate_code(new_content, registry)
    verification["syntax"] = syntax_detail
    if not syntax_ok:
        return _reject(f"syntax validation failed: {syntax_detail}")
    try:
        ast.parse(new_content)
    except SyntaxError as exc:  # noqa: BLE001 — belt and braces
        return _reject(f"AST re-check failed: {exc}")

    # Snapshot BEFORE the write: git safe-commit + file backup.
    snapshot = guard_mod.snapshot_git(root, registry)
    backup = guard_mod.backup_file(root, target)
    verification["snapshot"] = snapshot or "git snapshot unavailable"
    verification["backup"] = str(backup) if backup else "no backup taken"

    def _rollback(details: str) -> dict[str, Any]:
        restored = False
        if backup is not None:
            restored = guard_mod.restore_backup(backup, target)
        entry = audit_mod.new_entry(
            "self_edit", target_label, reason, "rolled_back", verification,
            f"{details} (backup restored: {restored})",
        )
        audit_mod.append_audit(root, entry)
        return {"ok": False, "outcome": "rolled_back", "target": target_label,
                "verification": verification,
                "details": f"{details} (backup restored: {restored})"}

    try:
        target.write_text(new_content, encoding="utf-8")
    except OSError as exc:
        return _rollback(f"write failed: {exc}")

    # Affected tests.
    run_tests = test_fn or (lambda: guard_mod.run_affected_tests(root, normalized))
    try:
        tests_ok, tests_detail = run_tests()
    except Exception as exc:  # noqa: BLE001
        tests_ok, tests_detail = False, f"test runner raised: {exc}"
    verification["tests"] = tests_detail
    if not tests_ok:
        return _rollback(f"affected tests failed: {tests_detail}")

    # Health verify.
    probe = verify_fn or guard_mod.check_health
    try:
        status, detail = probe()
    except Exception as exc:  # noqa: BLE001
        status, detail = "unreachable", f"health probe raised: {exc}"
    verification["health"] = f"{status}: {detail}"

    if status == "unhealthy":
        return _rollback(f"health check failed after the edit: {detail}")

    if status == "unreachable":
        outcome = "kept_unverified_health"
        details = ("kept — syntax + tests verified, but the backend was "
                   f"not running so no live health check ran ({detail})")
    else:
        outcome = "kept"
        details = f"kept — syntax + tests + health verified ({detail})"

    entry = audit_mod.new_entry(
        "self_edit", target_label, reason, outcome, verification, details
    )
    audit_mod.append_audit(root, entry)
    return {"ok": True, "outcome": outcome, "target": target_label,
            "verification": verification, "details": details}
