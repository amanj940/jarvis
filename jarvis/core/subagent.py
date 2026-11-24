"""JARVIS — Autonomous Sub-Agent Engine.

Each AutonomousSubAgent represents a specialized, self-directed worker
with its own execution loop, isolated conversation context, assigned model/provider,
and targeted toolset.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from .brain import BrainReply, LLMBrain, ToolCall
from .events import Event, EventKind
from .livelog import livelog
from .providers_catalog import get_provider_spec

log = logging.getLogger("jarvis.subagent")


class PermissionGuard:
    """Security and permission guard inspired by Harness Gitspaces policy.

    Enforces allow/deny filters on shell commands and file operations executed by subagents.
    """
    DANGEROUS_PATTERNS = [
        r"\brm\s+(-rf?|-fr?)\s+(/|/\*|~|\$HOME)\b",
        r"\bmkfs\b",
        r"\bdd\s+if=.*of=(/dev/|/dev/sd|/dev/nvme)",
        r":\(\)\s*\{\s*:\|:&\s*\};:",
        r">\s*/etc/(passwd|shadow|sudoers)",
        r"\bchmod\s+(-R\s+)?777\s+/",
    ]

    @classmethod
    def check_command(cls, cmd: str) -> tuple[bool, str]:
        for pattern in cls.DANGEROUS_PATTERNS:
            if re.search(pattern, cmd, re.IGNORECASE):
                return False, f"Blocked dangerous command matching safety policy: {pattern}"
        return True, "Allowed"


@dataclass
class SubAgentStep:
    hop: int
    thought: str
    tool_call: dict[str, Any] | None = None
    tool_result: str | None = None
    duration_ms: float = 0.0


@dataclass
class SubAgentResult:
    agent_id: str
    role: str
    goal: str
    status: str  # "completed", "failed", "max_hops_reached"
    summary: str
    steps: list[SubAgentStep] = field(default_factory=list)
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    model: str = ""
    provider: str = ""
    total_duration_seconds: float = 0.0
    error: str | None = None
    sandbox_dir: str | None = None


class AutonomousSubAgent:
    """Independent worker agent with isolated loop, custom toolset, LiveLog streaming, and sandbox."""

    def __init__(
        self,
        agent_id: str,
        role: str,
        *,
        brain: LLMBrain,
        registry: Any,
        provider: str | None = None,
        model: str | None = None,
        system_prompt: str | None = None,
        allowed_tools: list[str] | None = None,
        max_hops: int = 12,
        sandbox_dir: str | None = None,
    ):
        self.agent_id = agent_id
        self.role = role
        self.brain = brain
        self.registry = registry
        self.provider = provider or brain.mc.provider
        self.model = model or brain.mc.model
        self.max_hops = max_hops
        self.allowed_tools = set(allowed_tools) if allowed_tools is not None else None

        # Setup isolated sandbox directory
        if sandbox_dir:
            self.sandbox_dir = Path(sandbox_dir)
        else:
            self.sandbox_dir = Path.home() / ".jarvis" / "sandboxes" / self.agent_id
        try:
            self.sandbox_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            log.warning("Could not create sandbox dir %s: %s", self.sandbox_dir, e)

        spec = get_provider_spec(self.provider)
        self.endpoint = spec.default_base_url if spec else brain.mc.endpoint

        self.system_prompt = system_prompt or (
            f"You are the {role.upper()} autonomous agent inside J.A.R.V.I.S. "
            "You are an expert specialist working on an assigned objective. "
            f"You have an isolated scratch sandbox at: {self.sandbox_dir}\n"
            "Execute the task methodically using your tools, verify your work, and produce a concise, high-quality final result."
        )

        self.history: list[dict[str, Any]] = []
        self._schemas = self._filter_tool_schemas()

    def _filter_tool_schemas(self) -> list[dict[str, Any]]:
        """Filter registry tool schemas to only tools permitted for this subagent."""
        all_schemas = self.registry.schemas() if hasattr(self.registry, "schemas") else []
        if self.allowed_tools is None:
            return all_schemas
        return [
            s for s in all_schemas
            if s.get("function", {}).get("name") in self.allowed_tools
        ]

    async def run(
        self,
        goal: str,
        *,
        context: str = "",
        on_event: Callable[[Event], None] | None = None,
    ) -> SubAgentResult:
        """Execute the subagent autonomous loop until the goal is achieved or max hops reached."""
        start_time = time.time()
        log.info("[%s - %s] Launched with goal: %s (model: %s/%s)", self.agent_id, self.role, goal[:80], self.provider, self.model)
        livelog.log(self.agent_id, f"🚀 Agent [{self.role}] launched: {goal}", level="info")

        if on_event:
            on_event(
                Event(
                    EventKind.INFO,
                    text=f"🚀 انطلاق الوكيل المستقل [{self.role}]: {goal[:80]}...",
                    payload={
                        "subagent": True,
                        "agent_id": self.agent_id,
                        "role": self.role,
                        "model": f"{self.provider}/{self.model}",
                        "status": "running",
                    },
                )
            )

        # Initialize isolated session history
        full_system = (
            f"{self.system_prompt}\n\n"
            "OPERATING GUIDELINES:\n"
            "1. You have actual tools available in your tool schemas. Call tools directly to read files, search, or run checks. DO NOT simulate tool calls in markdown text blocks.\n"
            f"2. Your scratch sandbox is at: {self.sandbox_dir} (use it for temp files).\n"
            "3. When you have inspected the necessary information and completed the task, provide your final comprehensive summary starting with 'FINAL RESULT:'.\n"
            "4. Be concise, precise, and technically rigorous. Never stop at empty promises; always execute."
        )
        self.history = [
            {"role": "system", "content": full_system},
            {"role": "user", "content": f"ASSIGNED GOAL:\n«{goal}»\n\nADDITIONAL CONTEXT:\n{context or 'None'}"},
        ]

        steps: list[SubAgentStep] = []
        final_summary = ""
        status = "completed"
        error_msg = None

        hop = 0
        while hop < self.max_hops:
            hop += 1
            step_start = time.time()

            try:
                reply: BrainReply = await self.brain._run_provider_attempt_loop(
                    provider=self.provider,
                    endpoint=self.endpoint,
                    model=self.model,
                    messages=self.history,
                    tool_schemas=self._schemas,
                    stream=False,
                )
            except Exception as e:
                log.error("[%s] Provider execution failed: %s", self.agent_id, e)
                status = "failed"
                error_msg = str(e)
                livelog.log(self.agent_id, f"❌ Execution error: {e}", level="error")
                break

            reply_text = reply.text or ""

            # Stream thought to LiveLog
            first_line = reply_text.strip().split("\n")[0] if reply_text.strip() else ""
            if first_line:
                livelog.log(self.agent_id, f"💭 [Hop {hop}] {first_line[:150]}", level="thought")

            # Check if finished with text alone (no tool calls)
            if not reply.tool_calls:
                step_duration = (time.time() - step_start) * 1000.0
                steps.append(SubAgentStep(hop=hop, thought=reply_text, duration_ms=step_duration))
                self.history.append({"role": "assistant", "content": reply_text})
                final_summary = reply_text
                status = "completed"
                break

            # Process tool calls
            tc_dicts = []
            for tc in reply.tool_calls:
                call_id = tc.call_id or f"subcall_{hop}_{int(time.time()*1000)}"
                tc_dicts.append({
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": json.dumps(tc.args, ensure_ascii=False),
                    },
                })

            self.history.append({
                "role": "assistant",
                "content": reply_text,
                "tool_calls": tc_dicts,
            })

            # Execute tools in this hop
            for tc in reply.tool_calls:
                call_id = tc.call_id or f"subcall_{hop}_{int(time.time()*1000)}"
                tool_name = tc.name
                tool_args = tc.args or {}

                livelog.log(self.agent_id, f"⚡ Tool call: {tool_name}({tool_args})", level="action")

                if on_event:
                    on_event(
                        Event(
                            EventKind.TOOL_CALL,
                            text=f"[{self.role}] استدعاء أداة: {tool_name}",
                            payload={"agent_id": self.agent_id, "tool": tool_name, "args": tool_args},
                        )
                    )

                # Security & Permission Guard check (inspired by Harness)
                is_safe = True
                guard_msg = ""
                if tool_name in ("run_command", "bash", "sh", "shell", "exec"):
                    cmd = str(tool_args.get("command") or tool_args.get("CommandLine") or "")
                    is_safe, guard_msg = PermissionGuard.check_command(cmd)

                if not is_safe:
                    t_res_text = f"PERMISSION DENIED by Harness Safety Guard: {guard_msg}"
                    livelog.log(self.agent_id, f"🛡️ {t_res_text}", level="warn")
                else:
                    # Tool lookup & execution
                    t_instance = self.registry.get(tool_name) if hasattr(self.registry, "get") else None
                    if not t_instance:
                        t_res_text = f"Tool '{tool_name}' is not registered or unavailable."
                    else:
                        try:
                            res = t_instance.call(tool_args)
                            if asyncio.iscoroutine(res):
                                res = await res
                            t_res_text = str(res)
                        except Exception as exc:
                            t_res_text = f"Tool '{tool_name}' failed with error: {exc}"

                step_duration = (time.time() - step_start) * 1000.0
                steps.append(
                    SubAgentStep(
                        hop=hop,
                        thought=reply_text,
                        tool_call={"name": tool_name, "args": tool_args},
                        tool_result=t_res_text[:1000],
                        duration_ms=step_duration,
                    )
                )

                livelog.log(self.agent_id, f"✓ [{tool_name}] output: {t_res_text[:200]}...", level="info")

                # Append tool result to history
                self.history.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": tool_name,
                    "content": t_res_text,
                })

                if on_event:
                    on_event(
                        Event(
                            EventKind.TOOL_RESULT,
                            text=f"[{self.role}] نتيجة الأداة: {tool_name} ({len(t_res_text)} chars)",
                            payload={"agent_id": self.agent_id, "tool": tool_name, "preview": t_res_text[:200]},
                        )
                    )
        else:
            if not final_summary:
                status = "max_hops_reached"
                final_summary = f"Reached maximum allowed tool hops ({self.max_hops}) without clean termination."

        total_duration = time.time() - start_time
        log.info("[%s - %s] Finished in %.2fs with status: %s", self.agent_id, self.role, total_duration, status)
        livelog.log(self.agent_id, f"🏁 Completed in {total_duration:.2f}s (status: {status})", level="info")

        if on_event:
            on_event(
                Event(
                    EventKind.INFO,
                    text=f"✓ اكتمل عمل الوكيل المستقل [{self.role}] في {total_duration:.1f} ثانية.",
                    payload={
                        "subagent": True,
                        "agent_id": self.agent_id,
                        "role": self.role,
                        "status": status,
                        "duration": total_duration,
                    },
                )
            )

        return SubAgentResult(
            agent_id=self.agent_id,
            role=self.role,
            goal=goal,
            status=status,
            summary=final_summary,
            steps=steps,
            model=f"{self.provider}/{self.model}",
            provider=self.provider,
            total_duration_seconds=total_duration,
            error=error_msg,
            sandbox_dir=str(self.sandbox_dir),
        )
