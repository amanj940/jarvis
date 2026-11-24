"""JARVIS Self-Healing, AST Diagnostics & Autonomous Maintenance Tools.
Part of JARVIS Foundation Phase 0.0
"""
from __future__ import annotations

import ast
import json
import logging
import os
import py_compile
import subprocess
from pathlib import Path

from ..core.permissions import Permission
from ..utils import files as F
from .base import PluginInfo, tool

log = logging.getLogger("jarvis.self_healing")


def register(registry):
    cfg = registry.cfg
    root_dir = Path(__file__).resolve().parent.parent.parent

    @tool(
        name="diagnose_last_crash",
        description="Diagnose recent crashes, unhandled tracebacks, or errors from jarvis daemon logs.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "lines": {"type": "integer", "default": 50, "description": "Number of log lines to inspect"},
            },
        },
    )
    def diagnose_last_crash(lines: int = 50) -> str:
        """Inspect journalctl or local logs for Python tracebacks and error root causes."""
        output = ""
        try:
            cmd = ["journalctl", "--user", "-u", "jarvis.service", "-n", str(lines), "--no-pager"]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            output = proc.stdout
        except Exception:
            pass

        if not output:
            log_file = root_dir / "data" / "logs" / "jarvis.log"
            if log_file.exists():
                lines_list = log_file.read_text(encoding="utf-8", errors="ignore").splitlines()
                output = "\n".join(lines_list[-lines:])

        if not output:
            return "No recent logs or crashes found."

        # Scan for Traceback
        tracebacks = []
        in_trace = False
        current_tb = []
        for line in output.splitlines():
            if "Traceback (most recent call last):" in line:
                in_trace = True
                current_tb = [line]
            elif in_trace:
                current_tb.append(line)
                if line and not line.startswith(" ") and not line.startswith("File"):
                    in_trace = False
                    tracebacks.append("\n".join(current_tb))

        if tracebacks:
            return "### Isolated Crash Traceback(s):\n\n" + "\n\n---\n\n".join(tracebacks[-3:])

        return f"Recent Log Snippet ({lines} lines):\n\n" + "\n".join(output.splitlines()[-25:])

    @tool(
        name="validate_python_syntax",
        description="Verify that a Python file or code string compiles without syntax or AST errors.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Path to Python file to check"},
                "code": {"type": "string", "description": "Optional inline Python code string to parse"},
            },
        },
    )
    def validate_python_syntax(path: str = "", code: str = "") -> str:
        """Validate Python syntax via AST and py_compile."""
        if path:
            target = F.expand(path)
            if not target.exists():
                return f"Error: File does not exist: {target}"
            try:
                code = target.read_text(encoding="utf-8")
            except Exception as e:
                return f"Error reading file {target}: {e}"

        if not code:
            return "Error: Neither valid file path nor code was provided."

        try:
            ast.parse(code)
            return "SUCCESS: Syntax is valid (AST parsed cleanly)."
        except SyntaxError as e:
            return f"SYNTAX ERROR at line {e.lineno}, offset {e.offset}: {e.msg}\n--> {e.text}"

    @tool(
        name="self_healing_snapshot",
        description="Take an immutable git commit snapshot before modifying core JARVIS code, as a safety net.",
        permission=Permission.CAUTION,
        parameters={"type": "object", "properties": {}},
    )
    def self_healing_snapshot() -> str:
        """Record current safe git commit."""
        watchdog = root_dir / "scripts" / "jarvis_watchdog.sh"
        if not watchdog.exists():
            return "Watchdog script not found."
        proc = subprocess.run([str(watchdog), "snapshot"], capture_output=True, text=True, cwd=str(root_dir))
        return proc.stdout.strip() or proc.stderr.strip()

    @tool(
        name="self_healing_verify_and_guard",
        description="Verify daemon health after code edits. Automatically rolls back to the safe snapshot if daemon crashes.",
        permission=Permission.CAUTION,
        parameters={
            "type": "object",
            "properties": {
                "timeout_seconds": {"type": "integer", "default": 15},
            },
        },
    )
    def self_healing_verify_and_guard(timeout_seconds: int = 15) -> str:
        """Run health verification and rollback if broken."""
        watchdog = root_dir / "scripts" / "jarvis_watchdog.sh"
        if not watchdog.exists():
            return "Watchdog script not found."
        proc = subprocess.run(
            [str(watchdog), "verify", str(timeout_seconds)],
            capture_output=True,
            text=True,
            cwd=str(root_dir)
        )
        return proc.stdout.strip() or proc.stderr.strip()

    registry.add_pending("self_healing_tools")
    registry.register_plugin(PluginInfo(
        name="self_healing_tools",
        description="Self-healing, AST syntax verification, and autonomous rollback tools",
        permissions_needed=[Permission.SAFE, Permission.CAUTION],
    ))
