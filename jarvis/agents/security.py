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
    "bounty_program_notes",
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
        """Scope-gate: returns ``{"in_scope": bool, "detail": str}``."""
        detail = await self._invoke("bounty_scope_check",
                                    {"program_id": program_id, "target": target})
        return {"in_scope": detail.startswith("IN SCOPE"), "detail": detail}

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
        run stops there and nothing is recorded or reported.
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
        return result


def build_security_agent(registry: Any) -> SecurityAgent:
    """Factory used by the orchestrator / swarm to get the security agent."""
    return SecurityAgent(registry=registry)
