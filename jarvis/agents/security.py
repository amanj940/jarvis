"""Security / bug-bounty agent — a real executor, not a persona dataclass.

The agent plans a bounty workflow and runs it through the existing tool
registry, so every step still passes through permissions, hooks, and the
action log. It never tests anything itself: it delegates to tools
(``scan_project``, ``code_debug_loop``, ``web_search``, browser tools,
and the ``bounty_*`` tools) and it never submits, publishes, or contacts
anyone. A finding only ever becomes a local DRAFT; a human verifies and
submits it.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

log = logging.getLogger("jarvis.agents.security")

ROLE = "security"
ALLOWED_TOOLS = (
    "bounty_add_program", "bounty_list_programs", "bounty_add_target",
    "bounty_list_targets", "bounty_scope_check", "bounty_classify_finding",
    "bounty_record_finding", "bounty_list_findings", "bounty_render_report",
    "bounty_program_notes", "bounty_sync_programs",
    "scan_project", "code_debug_loop", "web_search", "web_fetch",
    "browser_open", "browser_search", "browser_page_text", "browser_screenshot",
    "read_file", "list_dir",
)

# Workflow steps, in order. Each step names the tool it uses.
WORKFLOW = (
    ("scope", "bounty_scope_check", "Confirm the target is in the recorded program scope."),
    ("recon", "scan_project", "Summarise the target project (local path) or web_search the program."),
    ("triage", "bounty_classify_finding", "Triage-classify the candidate finding."),
    ("record", "bounty_record_finding", "Record the finding as a local DRAFT (scope-checked)."),
    ("report", "bounty_render_report", "Render a local markdown disclosure draft."),
)

_IN_SCOPE = "IN SCOPE"
# Characters that may legally follow the exact verdict token "IN SCOPE".
# Anything else glued onto the token (e.g. "IN SCOPEX", "IN SCOPE-foo",
# "IN SCOPE.evil") is a different string, not an in-scope verdict.
_IN_SCOPE_DELIMITERS = frozenset({":", " ", "\t", "\n", "\r"})


def is_in_scope_detail(detail: Any) -> bool:
    """Return True only for a genuine in-scope verdict — never a prefix trick.

    Accepted forms (exact/structured matching, fail-closed):

    * the exact string ``"IN SCOPE"``;
    * ``"IN SCOPE"`` followed by a delimiter (``:``, whitespace, newline)
      and free-form detail, e.g. ``"IN SCOPE: example.com"``;
    * a structured JSON verdict, e.g. ``'{"in_scope": true, ...}'`` — the
      ``in_scope`` field must be the JSON boolean ``true`` (the string
      ``"true"``, ``1``, or any other truthy value does not count).

    Rejected: ``"IN SCOPEX"``, ``"IN SCOPE-attacker.com"``,
    ``"IN SCOPE.evil.com"``, ``"IN SCOPEISH"``, ``"OUT OF SCOPE"``,
    ``"NOT IN SCOPE"``, empty/blank text, non-strings, and malformed JSON.
    The old ``detail.startswith("IN SCOPE")`` check accepted every one of
    the prefix tricks above, so it must not be used.
    """
    if not isinstance(detail, str):
        return False
    text = detail.strip()
    if not text:
        return False
    if text.startswith("{"):
        try:
            parsed = json.loads(text)
        except (ValueError, TypeError):
            return False
        return isinstance(parsed, dict) and parsed.get("in_scope") is True
    if text == _IN_SCOPE:
        return True
    if not text.startswith(_IN_SCOPE):
        return False
    # The character right after the token decides: a delimiter means the
    # token ended here; any other character means the token never ended
    # (e.g. "IN SCOPEX" is one longer word, not the verdict plus detail).
    return text[len(_IN_SCOPE)] in _IN_SCOPE_DELIMITERS


def _normalise_scope_value(value: str) -> str:
    """Normalise a scope/target for structured comparison."""
    text = value.strip().lower()
    # Tolerate a scheme / trailing path — scope is about the host.
    for prefix in ("https://", "http://"):
        if text.startswith(prefix):
            text = text[len(prefix):]
            break
    text = text.split("/")[0].split(":")[0]
    return text.rstrip(".")


def matches_scope(target: str, scope: str) -> bool:
    """Exact/structured scope match — never a string prefix.

    A target is in scope only when it matches the allowed scope exactly
    (after normalisation), or when the scope is a ``*.example.com`` wildcard
    and the target is a genuine subdomain of ``example.com`` (label-boundary
    match). Prefix look-alikes never match: ``"example.com.evil.com"``,
    ``"fakeexample.com"`` and ``"example.com.attacker.com"`` are all out of
    scope for ``"example.com"``, even though they start with that string.
    """
    if not isinstance(target, str) or not isinstance(scope, str):
        return False
    target_norm = _normalise_scope_value(target)
    scope_norm = _normalise_scope_value(scope)
    if not target_norm or not scope_norm:
        return False
    if scope_norm.startswith("*."):
        base = scope_norm[2:]
        if not base or "." not in base:
            return False
        # Label-boundary subdomain match: target must end with ".<base>"
        # and have at least one label in front of it.
        return target_norm != base and target_norm.endswith("." + base)
    return target_norm == scope_norm


@dataclass
class SecurityAgent:
    """Security agent bound to a live PluginRegistry."""

    registry: Any
    name: str = "security"
    role: str = ROLE
    allowed_tools: tuple[str, ...] = ALLOWED_TOOLS

    async def _invoke(self, tool_name: str, args: dict) -> str:
        """Invoke a tool through the registry, or explain why it is unavailable."""
        tool = self.registry.get(tool_name)
        if tool is None:
            return f"tool unavailable: {tool_name}"
        try:
            result = await tool.invoke(args)
            return str(result)
        except Exception as e:  # noqa: BLE001
            log.warning("security agent tool %s failed: %s", tool_name, e)
            return f"tool {tool_name} failed: {e}"

    def plan(self, target: str, program_id: int | None = None) -> list[dict]:
        """Return the workflow plan for a target. Pure — no tools run."""
        return [
            {"step": step, "tool": tool, "note": note, "target": target,
             "program_id": program_id}
            for step, tool, note in WORKFLOW
        ]

    async def check_scope(self, program_id: int, target: str) -> dict:
        """Scope-gate: returns ``{"in_scope": bool, "detail": str}``.

        The verdict from ``bounty_scope_check`` is parsed with
        :func:`is_in_scope_detail` — exact/structured matching only. A
        verdict that merely starts with the in-scope wording (a prefix
        trick such as ``"IN SCOPEX"``) is treated as out of scope.
        """
        detail = await self._invoke("bounty_scope_check",
                                    {"program_id": program_id, "target": target})
        return {"in_scope": is_in_scope_detail(detail), "detail": detail}

    async def recon(self, target: str) -> str:
        """Reconnaissance for a target.

        A local directory is scanned with ``scan_project``; anything else
        gets a web search for public program/scope information. No probing,
        no exploitation.
        """
        path = Path(target).expanduser()
        if path.exists() and path.is_dir():
            return await self._invoke("scan_project", {"path": str(path)})
        return await self._invoke(
            "web_search", {"query": f"bug bounty program scope {target}"})

    async def triage_and_record(self, program_id: int, target: str, title: str,
                                description: str = "", evidence: str = "") -> dict:
        """Scope-check, classify, and record a finding as a DRAFT.

        Returns ``{"recorded": bool, "detail": str}``. Out-of-scope findings
        are refused at the tool layer and reported here, never recorded.
        """
        scope = await self.check_scope(program_id, target)
        if not scope["in_scope"]:
            return {"recorded": False, "detail": scope["detail"]}
        classification = await self._invoke(
            "bounty_classify_finding",
            {"title": title, "description": description, "evidence": evidence})
        recorded = await self._invoke(
            "bounty_record_finding",
            {"program_id": program_id, "target": target, "title": title,
             "description": description, "evidence": evidence})
        return {"recorded": "recorded as DRAFT" in recorded,
                "detail": f"{classification}\n{recorded}"}

    async def run(self, program_id: int, target: str, title: str | None = None,
                  description: str = "", evidence: str = "") -> dict:
        """Run the full workflow for one target (and one candidate finding).

        Step 1 (scope) is a hard gate: if the target is out of scope, the
        run stops there and nothing is recorded or reported. If a finding
        was requested (``title`` given) but recording it failed, the run
        reports ``ok: False`` with ``stopped_at: "record"`` — a failed
        record must never be reported as a success.
        """
        scope = await self.check_scope(program_id, target)
        if not scope["in_scope"]:
            return {"ok": False, "stopped_at": "scope", "detail": scope["detail"]}
        recon = await self.recon(target)
        result: dict[str, Any] = {
            "ok": True, "stopped_at": None, "scope": scope["detail"], "recon": recon,
        }
        if title:
            triage = await self.triage_and_record(program_id, target, title,
                                                 description, evidence)
            result["triage"] = triage
            if not triage.get("recorded"):
                result["ok"] = False
                result["stopped_at"] = "record"
                result["detail"] = triage.get("detail", "")
        return result


def build_security_agent(registry: Any) -> SecurityAgent:
    """Factory used by the orchestrator / swarm to get the security agent."""
    return SecurityAgent(registry=registry)
