"""Self-configuration & self-modification tools for JARVIS.

Built ON the self-healing foundation — it never replaces it. Every
operation in this plugin CALLS the existing self-healing tools:

- ``self_healing_snapshot`` — git safe-commit snapshot before a change.
- ``validate_python_syntax`` — AST validation of a proposed code patch.
- ``self_healing_guard_status`` — read-only guard state (added by the
  self-config extension to ``self_healing_tools.py``).

Tools (see docs/self-config.md for the full loop and the kill-switch):

- ``self_config_change`` (CAUTION) — change one allowlisted
  config.yaml value, schema-validated, snapshotted, health-verified.
- ``self_config_status`` (SAFE) — kill-switch state + recent audit.
- ``self_config_set_enabled`` (CAUTION) — the kill-switch itself.
- ``self_edit_propose`` (DANGEROUS) — the safe self-edit loop.
- ``self_config_audit_log`` (SAFE) — read the audit log.

UI wiring is NOT in scope here: no Settings.tsx changes. A future
Settings mount only needs to call ``self_config_status`` and
``self_config_set_enabled`` (documented in docs/self-config.md).
"""
from __future__ import annotations

import json
from pathlib import Path

from ...core.permissions import Permission
from . import audit as audit_mod
from . import guard as guard_mod
from .allowlist import SAFE_CONFIG_KEYS, is_allowed
from ..base import PluginInfo, tool
from .core import apply_config_change, apply_self_edit


def _parse_tool_value(raw: str):
    """Tool calls arrive as strings; accept JSON (true/42/0.3/"ar")
    and fall back to the raw string."""
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return raw


def _fmt_result(res: dict) -> str:
    lines = [
        f"outcome: {res.get('outcome')}",
        f"details: {res.get('details')}",
    ]
    verification = res.get("verification") or {}
    for key, value in verification.items():
        lines.append(f"verify[{key}]: {value}")
    return "\n".join(lines)


def register(registry):
    cfg = registry.cfg
    # __init__.py is at jarvis/plugins/self_config/__init__.py:
    # self_config -> plugins -> jarvis -> project root (four parents).
    root_dir = Path(__file__).resolve().parent.parent.parent.parent

    @tool(
        name="self_config_change",
        description=(
            "Safely change ONE allowlisted JARVIS config.yaml value "
            "(e.g. model.temperature, voice.edge_voice, ui.theme). "
            "Allowlisted keys only — permissions, secrets, endpoints and "
            "integrations are always refused. Snapshots before the change, "
            "validates against jarvis/config.py, verifies health, and "
            "automatically rolls back on failure."
        ),
        permission=Permission.CAUTION,
        parameters={
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "description": "Dotted config key, e.g. model.temperature",
                },
                "value": {
                    "type": "string",
                    "description": 'New value as JSON (e.g. "0.5", "true", "\\"ar\\"")',
                },
                "reason": {
                    "type": "string",
                    "description": "Why this change is being made (audit log)",
                },
            },
            "required": ["key", "value"],
        },
    )
    def self_config_change(key: str, value: str, reason: str = "") -> str:
        res = apply_config_change(
            root_dir, key, _parse_tool_value(value), reason, registry=registry
        )
        return _fmt_result(res)

    @tool(
        name="self_config_status",
        description=(
            "Read-only status of the self-configuration system: kill-switch "
            "flags, how many config keys are allowlisted, guard state, and "
            "the most recent audit entries."
        ),
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {}},
    )
    def self_config_status() -> str:
        state = guard_mod.load_state(root_dir)
        recent = audit_mod.read_audit(root_dir, limit=5)
        lines = [
            "self-config status:",
            f"  config_changes_enabled: {state['config_changes_enabled']}",
            f"  self_code_edits_enabled: {state['self_code_edits_enabled']}",
            f"  allowlisted config keys: {len(SAFE_CONFIG_KEYS)} (+ plugins.<name>.enabled)",
            f"  audit entries on file: {len(audit_mod.read_audit(root_dir, limit=0))}",
        ]
        for entry in recent:
            lines.append(
                f"  - {entry.get('ts', '')} [{entry.get('kind')}] "
                f"{entry.get('target')} -> {entry.get('outcome')}"
            )
        return "\n".join(lines)

    @tool(
        name="self_config_set_enabled",
        description=(
            "Kill-switch for self-modification: enable or disable config "
            "changes or self code edits. Disabling a feature makes the "
            "matching tool refuse immediately. Use this (or Settings later) "
            "to stop Jarvis from changing itself."
        ),
        permission=Permission.CAUTION,
        parameters={
            "type": "object",
            "properties": {
                "feature": {
                    "type": "string",
                    "description": "config_changes or self_code_edits",
                },
                "enabled": {
                    "type": "boolean",
                    "description": "true to allow, false to stop (kill-switch)",
                },
            },
            "required": ["feature", "enabled"],
        },
    )
    def self_config_set_enabled(feature: str, enabled: bool = True) -> str:
        mapping = {
            "config_changes": "config_changes_enabled",
            "self_code_edits": "self_code_edits_enabled",
        }
        state_key = mapping.get(feature)
        if state_key is None:
            return (
                f"Error: unknown feature {feature!r}; "
                "use 'config_changes' or 'self_code_edits'."
            )
        state = guard_mod.load_state(root_dir)
        state[state_key] = bool(enabled)
        guard_mod.save_state(root_dir, state)
        audit_mod.append_audit(
            root_dir,
            audit_mod.new_entry(
                "kill_switch", state_key,
                f"kill-switch set via self_config_set_enabled",
                "kept", {}, f"{state_key}={bool(enabled)}",
            ),
        )
        return f"{state_key} is now {bool(enabled)}."

    @tool(
        name="self_edit_propose",
        description=(
            "Propose ONE small code patch to a Python file (old_text -> "
            "new_text). The loop snapshots first, validates syntax with "
            "validate_python_syntax, runs the affected tests, verifies "
            "backend health, and AUTOMATICALLY rolls back on any failure. "
            "Guard/verify code, secrets, permissions and config.yaml can "
            "never be edited this way."
        ),
        permission=Permission.DANGEROUS,
        parameters={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Project-relative Python file, e.g. jarvis/plugins/demo.py",
                },
                "old_text": {
                    "type": "string",
                    "description": "Exact existing text to replace (must match once)",
                },
                "new_text": {
                    "type": "string",
                    "description": "Replacement text",
                },
                "reason": {
                    "type": "string",
                    "description": "Why this patch is being made (audit log)",
                },
            },
            "required": ["path", "old_text", "new_text"],
        },
    )
    def self_edit_propose(
        path: str, old_text: str, new_text: str, reason: str = ""
    ) -> str:
        res = apply_self_edit(
            root_dir, path, old_text, new_text, reason, registry=registry
        )
        return _fmt_result(res)

    @tool(
        name="self_config_audit_log",
        description=(
            "Read the self-configuration audit log: every config change "
            "and self-edit attempt, what was verified, and whether it was "
            "kept or rolled back."
        ),
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "default": 20,
                    "description": "Number of most recent entries to show",
                },
            },
        },
    )
    def self_config_audit_log(limit: int = 20) -> str:
        entries = audit_mod.read_audit(root_dir, limit=limit)
        if not entries:
            return "Audit log is empty — no self-config changes yet."
        lines = []
        for entry in entries:
            lines.append(
                f"{entry.get('ts', '')} [{entry.get('kind')}] "
                f"{entry.get('target')} -> {entry.get('outcome')} "
                f"({entry.get('details', '')})"
            )
        return "\n".join(lines)

    registry.add_pending("self_config")
    registry.register_plugin(
        PluginInfo(
            name="self_config",
            description=(
                "Self-configuration & safe self-modification, built on the "
                "self-healing foundation (snapshot -> validate -> test -> "
                "health verify -> keep, else automatic rollback)"
            ),
            permissions_needed=[
                Permission.SAFE,
                Permission.CAUTION,
                Permission.DANGEROUS,
            ],
        )
    )
