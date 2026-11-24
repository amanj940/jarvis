"""Autonomous Model Context Protocol (MCP) Server Manager for JARVIS.

Implements JSON-RPC 2.0 over stdio to connect external MCP servers
(e.g., GitHub, Filesystem, SQLite, Postgres, Puppeteer, Brave Search, etc.),
autonomously discover their tools, and dynamically register them into JARVIS's
PluginRegistry.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from ..plugins.base import Permission, Tool

log = logging.getLogger("jarvis.mcp")


@dataclass
class MCPServerConfig:
    name: str
    command: str
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    enabled: bool = True
    description: str = ""


class MCPProcess:
    """Manages an active stdio connection to an external MCP server."""

    def __init__(self, config: MCPServerConfig):
        self.config = config
        self.process: asyncio.subprocess.Process | None = None
        self._req_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._reader_task: asyncio.Task | None = None
        self.tools: list[dict[str, Any]] = []
        self.connected = False
        self.last_error: str | None = None

    async def start(self) -> bool:
        cmd = self.config.command
        user_dirs = [
            str(Path.home() / ".local/lib/npm/bin"),
            str(Path.home() / ".local/bin"),
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
        ]
        current_path = os.environ.get("PATH", "")
        search_path = os.pathsep.join(user_dirs) + os.pathsep + current_path
        resolved_cmd = shutil.which(cmd, path=search_path) or cmd

        env = os.environ.copy()
        env["PATH"] = search_path
        env.update(self.config.env)

        try:
            self.process = await asyncio.create_subprocess_exec(
                resolved_cmd,
                *self.config.args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            self._reader_task = asyncio.create_task(self._read_stdout())
            asyncio.create_task(self._log_stderr())

            # 1. Initialize
            init_res = await self.call_method(
                "initialize",
                {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "JARVIS", "version": "0.2.0"},
                },
                timeout=10.0,
            )
            if not init_res:
                self.last_error = "Initialize handshake returned empty response"
                return False

            # 2. Initialized notification
            await self.send_notification("notifications/initialized")

            # 3. Discover tools
            tools_res = await self.call_method("tools/list", {}, timeout=10.0)
            if tools_res and "tools" in tools_res:
                self.tools = tools_res["tools"]
                log.info("MCP server '%s' initialized with %d tools", self.config.name, len(self.tools))
            else:
                self.tools = []

            self.connected = True
            self.last_error = None
            return True
        except Exception as e:
            self.last_error = str(e)
            log.warning("Failed to start MCP server '%s': %s", self.config.name, e)
            await self.stop()
            return False

    async def stop(self) -> None:
        self.connected = False
        if self._reader_task:
            self._reader_task.cancel()
            self._reader_task = None

        if self.process:
            try:
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=2.0)
            except Exception:
                try:
                    self.process.kill()
                except Exception:
                    pass
            self.process = None

        for fut in self._pending.values():
            if not fut.done():
                fut.cancel()
        self._pending.clear()

    async def send_notification(self, method: str, params: dict | None = None) -> None:
        if not self.process or not self.process.stdin:
            return
        payload = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        data = (json.dumps(payload) + "\n").encode("utf-8")
        self.process.stdin.write(data)
        await self.process.stdin.drain()

    async def call_method(self, method: str, params: dict | None = None, timeout: float = 30.0) -> Any:
        if not self.process or not self.process.stdin:
            raise RuntimeError(f"MCP server '{self.config.name}' is not running")

        self._req_id += 1
        req_id = self._req_id
        fut = asyncio.get_running_loop().create_future()
        self._pending[req_id] = fut

        payload = {"jsonrpc": "2.0", "id": req_id, "method": method}
        if params is not None:
            payload["params"] = params

        data = (json.dumps(payload) + "\n").encode("utf-8")
        self.process.stdin.write(data)
        await self.process.stdin.drain()

        try:
            res = await asyncio.wait_for(fut, timeout=timeout)
            return res
        finally:
            self._pending.pop(req_id, None)

    async def _read_stdout(self) -> None:
        if not self.process or not self.process.stdout:
            return
        while True:
            try:
                line = await self.process.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if not text:
                    continue
                try:
                    msg = json.loads(text)
                except json.JSONDecodeError:
                    continue

                if "id" in msg:
                    req_id = msg["id"]
                    fut = self._pending.get(req_id)
                    if fut and not fut.done():
                        if "error" in msg:
                            fut.set_exception(RuntimeError(f"MCP Error: {msg['error']}"))
                        else:
                            fut.set_result(msg.get("result"))
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.debug("MCP stdout read error: %s", e)
                break

    async def _log_stderr(self) -> None:
        if not self.process or not self.process.stderr:
            return
        while True:
            try:
                line = await self.process.stderr.readline()
                if not line:
                    break
                log.debug("MCP [%s stderr]: %s", self.config.name, line.decode("utf-8", errors="replace").strip())
            except Exception:
                break


class MCPServerManager:
    """Singleton manager for all configured MCP servers."""

    def __init__(self, registry: Any, config_path: Path):
        self.registry = registry
        self.config_path = config_path
        self.servers: dict[str, MCPProcess] = {}

    def load_configs(self) -> dict[str, MCPServerConfig]:
        import yaml
        if not self.config_path.exists():
            return {}
        try:
            with self.config_path.open("r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            mcp_data = data.get("mcp_servers", {})
            configs = {}
            for name, sc in mcp_data.items():
                if isinstance(sc, dict):
                    configs[name] = MCPServerConfig(
                        name=name,
                        command=sc.get("command", ""),
                        args=sc.get("args", []),
                        env=sc.get("env", {}),
                        enabled=sc.get("enabled", True),
                        description=sc.get("description", ""),
                    )
            return configs
        except Exception as e:
            log.warning("Failed to load mcp_servers from config.yaml: %s", e)
            return {}

    def save_configs(self, configs: dict[str, dict]) -> None:
        import yaml
        from ..config import atomic_yaml_write
        if not self.config_path.exists():
            return
        with self.config_path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        data["mcp_servers"] = configs
        atomic_yaml_write(self.config_path, data)

    async def start_all(self) -> None:
        configs = self.load_configs()
        for name, cfg in configs.items():
            if cfg.enabled and cfg.command:
                proc = MCPProcess(cfg)
                self.servers[name] = proc
                ok = await proc.start()
                if ok:
                    self._register_tools(name, proc)

    def _register_tools(self, server_name: str, proc: MCPProcess) -> None:
        for tool_info in proc.tools:
            t_name = f"mcp_{server_name}_{tool_info['name']}"
            t_desc = tool_info.get("description") or f"MCP tool from {server_name}"
            t_schema = tool_info.get("inputSchema") or {"type": "object", "properties": {}}

            mcp_tool_name = tool_info["name"]

            async def _handler(**kwargs):
                res = await proc.call_method("tools/call", {"name": mcp_tool_name, "arguments": kwargs})
                if isinstance(res, dict) and "content" in res:
                    parts = []
                    for c in res["content"]:
                        if isinstance(c, dict) and "text" in c:
                            parts.append(c["text"])
                    return "\n".join(parts) if parts else json.dumps(res)
                return json.dumps(res) if res is not None else "(no output)"

            tool_obj = Tool(
                name=t_name,
                description=t_desc,
                handler=_handler,
                parameters=t_schema,
                permission=Permission.CAUTION,
                plugin=f"mcp:{server_name}",
            )
            self.registry.add(tool_obj)
            log.info("Registered MCP tool: %s", t_name)

    async def toggle_server(self, name: str, enabled: bool) -> bool:
        configs = self.load_configs()
        if name not in configs:
            return False
        configs[name].enabled = enabled

        raw_dict = {
            k: {
                "command": v.command,
                "args": v.args,
                "env": v.env,
                "enabled": v.enabled,
                "description": v.description,
            }
            for k, v in configs.items()
        }
        self.save_configs(raw_dict)

        if not enabled:
            if name in self.servers:
                await self.servers[name].stop()
                del self.servers[name]
                self.registry.reload_all()
                await self.re_register_active()
            return True
        else:
            proc = MCPProcess(configs[name])
            self.servers[name] = proc
            ok = await proc.start()
            if ok:
                self._register_tools(name, proc)
            return ok

    async def re_register_active(self) -> None:
        for name, proc in self.servers.items():
            if proc.connected:
                self._register_tools(name, proc)

    async def stop_all(self) -> None:
        for proc in self.servers.values():
            await proc.stop()
        self.servers.clear()

    def get_status(self) -> list[dict[str, Any]]:
        configs = self.load_configs()
        res = []
        for name, cfg in configs.items():
            proc = self.servers.get(name)
            res.append({
                "name": name,
                "command": cfg.command,
                "args": cfg.args,
                "enabled": cfg.enabled,
                "description": cfg.description,
                "connected": proc.connected if proc else False,
                "tools_count": len(proc.tools) if proc else 0,
                "tools": proc.tools if proc else [],
                "error": proc.last_error if proc else None,
            })
        return res

    def get_presets_info(self) -> list[dict[str, Any]]:
        """Return available presets with dynamic auto-detection."""
        # 1. Auto-detect GitHub token from gh CLI or env
        gh_token = os.environ.get("GITHUB_TOKEN", "")
        if not gh_token:
            try:
                import subprocess
                res = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=3)
                if res.returncode == 0 and res.stdout.strip():
                    gh_token = res.stdout.strip()
            except Exception:
                pass

        workspace_path = str(self.config_path.parent) if self.config_path else str(Path.cwd())
        models_db_path = str(Path(workspace_path) / "data" / "models.db")
        memory_db_path = str(Path(workspace_path) / "data" / "memory.db")
        active_db = models_db_path if Path(models_db_path).exists() else memory_db_path

        brave_key = os.environ.get("BRAVE_API_KEY", "")

        configs = self.load_configs()

        python_exe = sys.executable or "python3"

        presets = [
            {
                "id": "filesystem",
                "name": "filesystem",
                "label": "Filesystem",
                "icon": "📁",
                "desc": "Local workspace filesystem access (read, write, list files)",
                "command": python_exe,
                "args": ["-m", "jarvis.mcp_servers.filesystem", workspace_path],
                "env": {},
                "auto_detected": True,
                "detection_info": f"Workspace: {Path(workspace_path).name}",
                "already_configured": "filesystem" in configs,
                "is_running": self.servers.get("filesystem").connected if self.servers.get("filesystem") else False,
            },
            {
                "id": "github",
                "name": "github",
                "label": "GitHub",
                "icon": "🐙",
                "desc": "GitHub repository management, PRs, issues, commits, branches",
                "command": python_exe,
                "args": ["-m", "jarvis.mcp_servers.github"],
                "env": {"GITHUB_TOKEN": gh_token} if gh_token else {},
                "auto_detected": bool(gh_token),
                "detection_info": "Token auto-detected (gh CLI)" if gh_token else "Requires GitHub Personal Token",
                "token_preview": f"{gh_token[:6]}...{gh_token[-4:]}" if gh_token else "",
                "already_configured": "github" in configs,
                "is_running": self.servers.get("github").connected if self.servers.get("github") else False,
            },
            {
                "id": "sqlite",
                "name": "sqlite",
                "label": "SQLite",
                "icon": "🗃",
                "desc": "Query JARVIS local databases (models catalog & memories)",
                "command": python_exe,
                "args": ["-m", "jarvis.mcp_servers.sqlite", active_db],
                "env": {},
                "auto_detected": True,
                "detection_info": f"DB: {Path(active_db).name}",
                "already_configured": "sqlite" in configs,
                "is_running": self.servers.get("sqlite").connected if self.servers.get("sqlite") else False,
            },
            {
                "id": "puppeteer",
                "name": "puppeteer",
                "label": "Puppeteer",
                "icon": "🤖",
                "desc": "Headless browser automation, web scraping, and screenshots",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
                "env": {},
                "auto_detected": True,
                "detection_info": "NPX Ready",
                "already_configured": "puppeteer" in configs,
                "is_running": self.servers.get("puppeteer").connected if self.servers.get("puppeteer") else False,
            },
            {
                "id": "brave-search",
                "name": "brave-search",
                "label": "Brave Search",
                "icon": "🔍",
                "desc": "Live web search and news via Brave Search API",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-brave-search"],
                "env": {"BRAVE_API_KEY": brave_key} if brave_key else {},
                "auto_detected": bool(brave_key),
                "detection_info": "Key found in .env" if brave_key else "Requires BRAVE_API_KEY",
                "already_configured": "brave-search" in configs,
                "is_running": self.servers.get("brave-search").connected if self.servers.get("brave-search") else False,
            },
        ]
        return presets

    async def connect_preset(self, preset_id: str, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
        """Dynamically configure and connect an MCP preset in one click."""
        presets = {p["id"]: p for p in self.get_presets_info()}
        if preset_id not in presets:
            return {"ok": False, "error": f"Unknown preset: {preset_id}"}

        p = presets[preset_id]
        ov = overrides or {}

        env = dict(p["env"])
        if "env" in ov and isinstance(ov["env"], dict):
            env.update(ov["env"])
        if "token" in ov and ov["token"]:
            if preset_id == "github":
                env["GITHUB_TOKEN"] = ov["token"]
            elif preset_id == "brave-search":
                env["BRAVE_API_KEY"] = ov["token"]

        args = list(p["args"])
        if "args" in ov and isinstance(ov["args"], list):
            args = ov["args"]

        cfg = MCPServerConfig(
            name=p["name"],
            command=p["command"],
            args=args,
            env=env,
            enabled=True,
            description=p["desc"],
        )

        configs = self.load_configs()
        configs[p["name"]] = cfg

        raw_dict = {
            k: {
                "command": v.command,
                "args": v.args,
                "env": v.env,
                "enabled": v.enabled,
                "description": v.description,
            }
            for k, v in configs.items()
        }
        self.save_configs(raw_dict)

        ok = await self.toggle_server(p["name"], True)
        proc = self.servers.get(p["name"])
        tools = proc.tools if proc else []
        err = proc.last_error if proc else None

        return {
            "ok": ok,
            "server": p["name"],
            "connected": proc.connected if proc else False,
            "tools_count": len(tools),
            "tools": tools,
            "error": err,
        }

    async def test_server(self, name: str) -> dict[str, Any]:
        """Test and query an active MCP server dynamically."""
        import time
        proc = self.servers.get(name)
        if not proc or not proc.connected:
            # Try to start it
            configs = self.load_configs()
            if name not in configs:
                return {"ok": False, "error": f"Server '{name}' is not configured"}
            ok = await self.toggle_server(name, True)
            proc = self.servers.get(name)
            if not ok or not proc:
                return {"ok": False, "error": proc.last_error if proc else "Failed to start"}

        t0 = time.perf_counter()
        res = await proc.call_method("tools/list", {}, timeout=8.0)
        latency_ms = round((time.perf_counter() - t0) * 1000)

        if res and "tools" in res:
            proc.tools = res["tools"]
            return {
                "ok": True,
                "server": name,
                "tools_count": len(proc.tools),
                "tools": proc.tools,
                "latency_ms": latency_ms,
            }
        else:
            return {
                "ok": False,
                "server": name,
                "error": proc.last_error or "Server returned invalid response",
                "latency_ms": latency_ms,
            }

