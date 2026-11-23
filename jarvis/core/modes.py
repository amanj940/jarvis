"""Operating modes (Phase 2 — merged agent layer).

Phase 2 decision (see docs/phase2-architecture.md): the old ``jarvis/agents/``
package was deleted. It held nine dataclass *personalities* with no
execution logic — the real work (planning, multi-intent swarm, intent
routing, the tool loop) already lives in the Orchestrator, and the
``tool_allowlist`` on each agent was dead code (``applies_to`` was never
called anywhere). Turning nine personas into nine executors would have
duplicated the orchestrator's tool loop nine times for no gain.

So the personas moved here, next to the Orchestrator, as **modes**: a mode
supplies a name, a description shown in the UI, a system-prompt addendum,
and an optional tool allowlist. The Orchestrator is the only executor; a
mode only biases it. Two things changed versus the old layer:

- The allowlist is now *enforced* in ``Orchestrator._invoke_tool`` — an
  active mode can no longer call tools outside its list (previously the
  list was decorative). Empty allowlist still means "all tools".
- There is no separate ``agents`` package to import; ``main.py`` builds
  the registry from here and everything else (``/api/agents``, the ``/agent``
  chat command, ``cfg.agents`` toggles) works exactly as before.

``Agent`` / ``AgentRegistry`` / ``build_default_registry`` are kept as
aliases so older imports keep working.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Mode:
    name: str
    description: str
    system_prompt: str = ""
    tool_allowlist: list[str] = field(default_factory=list)  # empty = all tools

    def applies_to(self, tool_name: str) -> bool:
        if not self.tool_allowlist:
            return True
        return tool_name in self.tool_allowlist


class ModeRegistry:
    def __init__(self) -> None:
        self._modes: dict[str, Mode] = {}

    def add(self, m: Mode) -> None:
        self._modes[m.name] = m

    def get(self, name: str) -> Mode | None:
        return self._modes.get(name)

    def list(self) -> list[Mode]:
        return list(self._modes.values())

    def names(self) -> list[str]:
        return list(self._modes.keys())


# Backwards-compatible aliases (old jarvis/agents/* names).
Agent = Mode
AgentRegistry = ModeRegistry


def _default_modes() -> list[Mode]:
    """The nine personas, verbatim from the old jarvis/agents/*.py."""
    return [
        Mode(
            name="planner",
            description="Breaks complex requests into ordered, concrete steps.",
            system_prompt=(
                "Right now you are the PLANNER. Do not execute. "
                "Produce a numbered plan with 3–8 steps. Each step names "
                "the tool you would use (if any) and the exact inputs. "
                "End with a one-line summary of the goal. Be concise."
            ),
            tool_allowlist=[],  # planning uses no tools; pure reasoning
        ),
        Mode(
            name="executor",
            description="Runs an approved plan step-by-step, reporting results.",
            system_prompt=(
                "You are the EXECUTOR. Carry out the plan exactly. "
                "Use one tool per turn, then summarise the outcome of that step "
                "in one short line. Stop and ask the user if any step fails "
                "twice or requires destructive action you cannot infer consent for."
            ),
        ),
        Mode(
            name="research",
            description="Searches and summarises web sources.",
            system_prompt=(
                "You are the RESEARCH agent. Prefer web_search then web_fetch "
                "to read promising pages. Quote sources with their URL. "
                "Summarise findings in tight bullets. Never invent URLs."
            ),
            tool_allowlist=["web_search", "web_fetch", "remember", "add_note", "search_memory"],
        ),
        Mode(
            name="code",
            description="Writes, runs, debugs, and iterates on code.",
            system_prompt=(
                "You are the CODE agent. Plan briefly, then write code with "
                "write_file, run it with run_python / run_node / run_python_file, "
                "inspect stderr, fix issues, retry. Stop when the program runs "
                "clean OR you have reached the retry cap; explain the final state."
            ),
            tool_allowlist=[
                "write_file", "read_file", "append_file", "list_dir", "search_files",
                "run_python", "run_python_file", "run_node",
                "pip_install", "npm_install",
                "scan_project", "code_debug_loop",
                "add_fix", "lookup_fix",
            ],
        ),
        Mode(
            name="file",
            description="Reads, writes, searches, and reorganises files safely.",
            system_prompt=(
                "You are the FILE agent. Always check the directory layout with "
                "list_dir before mutating anything. Use write_file's automatic "
                "backup. Never delete recursively without explicit confirmation."
            ),
            tool_allowlist=[
                "list_dir", "read_file", "write_file", "append_file",
                "search_files", "mkdir", "copy", "move", "delete", "stat",
                "scan_project",
            ],
        ),
        Mode(
            name="system",
            description="Reports PC health and helps diagnose performance issues.",
            system_prompt=(
                "You are the SYSTEM agent. Read system_status, list_processes, "
                "network_info, battery, disk_usage, gpu_info — combine them into "
                "a short situational brief. Suggest concrete actions when something "
                "looks off (high CPU/RAM/disk). Never kill processes without confirmation."
            ),
            tool_allowlist=[
                "system_status", "list_processes", "network_info",
                "battery", "gpu_info", "disk_usage", "kill_process",
                "which", "env_var",
            ],
        ),
        Mode(
            name="memory",
            description="Curates JARVIS' long-term memory: prefs, notes, paths, fixes.",
            system_prompt=(
                "You are the MEMORY agent. Read prefs and notes before answering. "
                "When the user shares a fact worth keeping (preference, path, fix), "
                "use remember / add_note / set_path / add_fix. Search memory before "
                "asking for info you might already have."
            ),
            tool_allowlist=[
                "remember", "recall", "forget", "list_prefs",
                "add_note", "list_notes", "search_memory",
                "set_path", "get_path", "list_paths",
                "record_tool", "list_tools",
                "add_fix", "lookup_fix",
                "top_commands",
            ],
        ),
        Mode(
            name="vision",
            description="OPTIONAL: screenshot / OCR / webcam analysis.",
            system_prompt=(
                "You are the VISION agent. Only act when the user explicitly asks "
                "for screen or camera input. Always describe what you intend to capture "
                "and request confirmation. Never auto-capture in the background."
            ),
            tool_allowlist=[
                "screenshot", "ocr_image", "screen_ocr",
                "webcam_status", "webcam_snapshot",
            ],
        ),
        Mode(
            name="voice",
            description="OPTIONAL: speak text out loud / listen via microphone.",
            system_prompt=(
                "You are the VOICE agent. Use speak() to vocalise short replies. "
                "Use listen() only when explicitly asked. If no microphone is detected, "
                "fall back to text without complaining."
            ),
            tool_allowlist=["speak", "listen", "microphone_status"],
        ),
    ]


def build_default_registry(cfg) -> ModeRegistry:
    """Construct the mode registry honoring the per-mode enable flags."""
    reg = ModeRegistry()
    for m in _default_modes():
        toggle = cfg.agents.get(m.name)
        if toggle is not None and not toggle.enabled:
            continue
        reg.add(m)
    return reg
