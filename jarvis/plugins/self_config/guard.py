"""Guard rails for self-configuration and self-modification.

This module is the safety core of the self-config system — and it is
itself a protected path: the self-edit loop may NEVER modify any file in
``jarvis/plugins/self_config/``, ``jarvis/plugins/self_healing_tools.py``,
``scripts/jarvis_watchdog.sh``, ``jarvis/core/permissions.py`` or
``jarvis/config.py`` (see PROTECTED_PATHS). That is what stops a bad
self-edit from disabling its own guard.

Kill-switch: runtime state in ``data/self_config_state.json``.
``config_changes_enabled`` defaults ON; ``self_code_edits_enabled``
defaults ON but every code edit is still gated behind the full
verify-and-guard pass (syntax -> tests -> health). Either flag can be
turned off from Settings later (see docs/self-config.md) or by calling
the ``self_config_set_enabled`` tool; turning a flag off makes the
matching tool refuse immediately, before any snapshot or write.

Why the loop does NOT call ``self_healing_verify_and_guard`` itself:
that tool runs the watchdog's ``verify``, which on failure does a
``git reset --hard`` to the safe commit. Firing that automatically from
inside a self-edit — e.g. while the backend is simply not running yet —
could wipe the user's uncommitted work. The loop therefore performs the
same checks itself (health probe + file-level backup restore) and leaves
``self_healing_verify_and_guard`` as the explicit, human/assistant-invoked
last-resort rollback. The health probe distinguishes "backend not
running" (unreachable: keep only if syntax+tests passed, and say so
plainly) from "backend running but unhealthy" (rollback).
"""
from __future__ import annotations

import ast
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

STATE_REL_PATH = Path("data/self_config_state.json")
BACKUP_DIR_REL = Path("data/self_config_backups")

DEFAULT_STATE: dict[str, bool] = {
    "config_changes_enabled": True,
    "self_code_edits_enabled": True,
}

# Exact relative paths (from the project root) the self-edit loop may
# never touch, plus directory prefixes below.
PROTECTED_PATHS = {
    # Own guard / verify code — editing it could disable the guard.
    "jarvis/plugins/self_config/__init__.py",
    "jarvis/plugins/self_config/allowlist.py",
    "jarvis/plugins/self_config/audit.py",
    "jarvis/plugins/self_config/core.py",
    "jarvis/plugins/self_config/guard.py",
    # Self-healing foundation (owned by worker O only as an extension,
    # never self-editable) and the watchdog that rolls back.
    "jarvis/plugins/self_healing_tools.py",
    "scripts/jarvis_watchdog.sh",
    # Permission enforcement and the config schema itself.
    "jarvis/core/permissions.py",
    "jarvis/config.py",
    # Secrets, config (config.yaml goes through the config tool only),
    # kill-switch state and the audit log itself.
    ".env",
    "config.yaml",
    "data/self_config_state.json",
    "data/logs/self_config_audit.jsonl",
    # Own tests — a patch must never be able to fake its verification.
    "tests/test_self_config.py",
    "tests/test_self_config_guard.py",
    "tests/test_self_healing_tools.py",
}

PROTECTED_PREFIXES = (
    "jarvis/plugins/self_config/",
    ".git/",
)


def load_state(root: Path) -> dict[str, bool]:
    """Kill-switch state; missing/corrupt file means defaults (both ON)."""
    path = Path(root) / STATE_REL_PATH
    state = dict(DEFAULT_STATE)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return state
    if isinstance(raw, dict):
        for key in DEFAULT_STATE:
            if isinstance(raw.get(key), bool):
                state[key] = raw[key]
    return state


def save_state(root: Path, state: dict[str, bool]) -> Path:
    path = Path(root) / STATE_REL_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    merged = dict(DEFAULT_STATE)
    merged.update({k: bool(v) for k, v in state.items() if k in DEFAULT_STATE})
    path.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    return path


def is_enabled(root: Path, feature: str) -> bool:
    """Kill-switch check. Unknown features are disabled (fail closed)."""
    return bool(load_state(root).get(feature, False))


def protected_reason(rel_path: str) -> str | None:
    """Return why ``rel_path`` is protected, or None if it is editable."""
    normalized = rel_path.replace("\\", "/").lstrip("./")
    if normalized in PROTECTED_PATHS:
        return f"{normalized!r} is a protected path (guard / verify / secrets)"
    for prefix in PROTECTED_PREFIXES:
        if normalized.startswith(prefix):
            return f"{normalized!r} is under protected prefix {prefix!r}"
    return None


def snapshot_git(root: Path, registry: Any = None) -> str:
    """Take a safe-commit snapshot, CALLING the existing self-healing
    tool when a registry is available. Falls back to git directly.
    Returns the commit hash, or "" when no snapshot could be taken."""
    root = Path(root)
    if registry is not None:
        tool = registry.get("self_healing_snapshot")
        if tool is not None:
            try:
                result = str(tool.handler())
                for token in result.replace(",", " ").split():
                    if len(token) >= 7 and all(
                        c in "0123456789abcdef" for c in token.lower()
                    ):
                        return token
                return result
            except Exception:
                pass
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            cwd=str(root),
            timeout=10,
        )
        commit = proc.stdout.strip()
        if commit:
            safe_file = root / "data" / ".jarvis_safe_commit"
            safe_file.parent.mkdir(parents=True, exist_ok=True)
            safe_file.write_text(commit + "\n", encoding="utf-8")
            return commit
    except Exception:
        pass
    return ""


def validate_code(code: str, registry: Any = None) -> tuple[bool, str]:
    """Validate Python code, CALLING the existing ``validate_python_syntax``
    tool when a registry is available, else ast.parse directly."""
    if registry is not None:
        tool = registry.get("validate_python_syntax")
        if tool is not None:
            try:
                result = str(tool.handler(code=code))
                return ("SUCCESS" in result, result)
            except Exception as exc:  # noqa: BLE001
                return False, f"validate_python_syntax failed: {exc}"
    try:
        ast.parse(code)
        return True, "SUCCESS: Syntax is valid (AST parsed cleanly)."
    except SyntaxError as exc:
        return False, f"SYNTAX ERROR at line {exc.lineno}: {exc.msg}"


def check_health(
    base_url: str = "http://127.0.0.1:7341", timeout: int = 3
) -> tuple[str, str]:
    """Probe ``/api/health``. Returns (status, detail) where status is
    ``ok`` (200), ``unhealthy`` (reachable but not 200) or
    ``unreachable`` (nothing listening — backend not running)."""
    url = base_url.rstrip("/") + "/api/health"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            if resp.status == 200:
                return "ok", f"{url} returned 200"
            return "unhealthy", f"{url} returned HTTP {resp.status}"
    except urllib.error.HTTPError as exc:
        return "unhealthy", f"{url} returned HTTP {exc.code}"
    except Exception as exc:  # noqa: BLE001 — connection refused, timeout, ...
        return "unreachable", f"{url} unreachable: {exc}"


def run_affected_tests(
    root: Path, rel_path: str, timeout: int = 180
) -> tuple[bool, str]:
    """Run the test file matching the edited module
    (``tests/test_<stem>.py``). If none exists, fall back to an import
    check of the edited module in a clean subprocess. Returns
    (passed, detail)."""
    root = Path(root)
    stem = Path(rel_path).stem
    test_file = root / "tests" / f"test_{stem}.py"
    env = dict(os.environ)
    env["PYTHONPATH"] = str(root) + os.pathsep + env.get("PYTHONPATH", "")
    if test_file.exists():
        cmd = [sys.executable, "-m", "pytest", str(test_file), "-q"]
        label = f"pytest {test_file.name}"
    else:
        module = Path(rel_path).with_suffix("").as_posix().replace("/", ".")
        cmd = [sys.executable, "-c", f"import {module}"]
        label = f"import check {module} (no dedicated test file)"
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, cwd=str(root),
            env=env, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return False, f"{label}: TIMEOUT after {timeout}s"
    tail = (proc.stdout + proc.stderr).strip().splitlines()[-5:]
    detail = f"{label}: exit={proc.returncode} :: " + " | ".join(tail)
    return proc.returncode == 0, detail


def backup_file(root: Path, target: Path) -> Path | None:
    """Copy ``target`` into data/self_config_backups/ for rollback."""
    from ...utils import files as F

    backup_dir = Path(root) / BACKUP_DIR_REL
    return F.backup_file(Path(target), backup_dir)


def restore_backup(backup: Path, target: Path) -> bool:
    try:
        shutil.copy2(backup, target)
        return True
    except OSError:
        return False
