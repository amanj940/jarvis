"""MCP (Model Context Protocol) server routes.

Zero MCP routes existed before this module. It exposes the servers
already configured in ``config.yaml`` under ``mcp_servers`` (read by
:mod:`jarvis.core.mcp.MCPServerManager`) over HTTP:

* ``GET /mcp/servers`` — every configured server: name, command, args,
  enabled flag, live connection state, discovered tool names.
* ``GET /mcp/servers/{name}/status`` — per-server status. When the
  server is not already connected, a short-lived handshake probe is
  run (``initialize`` + ``tools/list``, capped by ``?timeout=``,
  default 5 s, max 15 s) and the probe process is stopped afterwards.
* ``POST /mcp/servers/{name}/test`` — same probe as an explicit test
  action; returns the same shape plus a duration.

Probes are read-only: they never call a server tool (no
``tools/call``), never execute anything beyond the MCP handshake, and
never return environment values — server ``env`` is never included in
any response (values could hold secrets; even the keys are omitted).

The manager is created lazily and cached on ``app.state.mcp_manager``
so live connections survive across requests without touching
``app.py``. If the app already provides one, it is reused.
"""
from __future__ import annotations

import asyncio
import logging
import shutil
import time
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ...core.mcp import MCPProcess, MCPServerConfig, MCPServerManager
from .common import _services

log = logging.getLogger("jarvis.server.routes.mcp")

router = APIRouter()

_DEFAULT_PROBE_TIMEOUT = 5.0
_MAX_PROBE_TIMEOUT = 15.0


def _config_path(cfg) -> Path:
    """``config.yaml`` next to the project root (see ``jarvis.config``)."""
    root = getattr(cfg, "project_root", None)
    return (Path(root) / "config.yaml") if root else Path("config.yaml")


def _manager(request: Request) -> MCPServerManager:
    manager = getattr(request.app.state, "mcp_manager", None)
    if manager is None:
        cfg, *_ = _services(request)
        manager = MCPServerManager(
            getattr(request.app.state, "registry", None),
            _config_path(cfg),
        )
        request.app.state.mcp_manager = manager
    return manager


def _public_server(name: str, cfg: MCPServerConfig,
                   manager: MCPServerManager) -> dict:
    """Public view of one configured server — env values never included."""
    proc = manager.servers.get(name)
    return {
        "name": name,
        "command": cfg.command,
        "args": list(cfg.args or []),
        "enabled": bool(cfg.enabled),
        "description": cfg.description or "",
        "command_found": bool(cfg.command and shutil.which(cfg.command)),
        "connected": bool(proc.connected) if proc else False,
        "tools_count": len(proc.tools) if proc else 0,
        "tools": [t.get("name") for t in ((proc.tools or []) if proc else [])
                  if isinstance(t, dict)],
        "error": proc.last_error if proc else None,
    }


def _not_found(name: str) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"ok": False, "error": f"unknown MCP server: {name!r}"},
    )


async def _probe(config: MCPServerConfig, timeout: float) -> dict:
    """Short-lived handshake probe: initialize + tools/list, then stop.

    Returns ``{"reachable": bool, "tools": [...], "error": str|None,
    "duration_ms": int}``. Never calls a server tool. The probe process
    is always stopped, even on timeout/cancellation.
    """
    started = time.monotonic()
    proc = MCPProcess(config)
    try:
        ok = await asyncio.wait_for(proc.start(), timeout=timeout)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        ok = False
        proc.last_error = f"probe timed out after {timeout:g}s"
    except Exception as e:  # noqa: BLE001 — probe must never raise
        ok = False
        proc.last_error = str(e)
    finally:
        try:
            await asyncio.wait_for(proc.stop(), timeout=2.0)
        except Exception:  # noqa: BLE001
            pass
    return {
        "reachable": bool(ok),
        "connected": bool(ok),
        "tools_count": len(proc.tools) if ok else 0,
        "tools": [t.get("name") for t in (proc.tools or [])
                  if isinstance(t, dict)] if ok else [],
        "error": None if ok else (proc.last_error or "probe failed"),
        "duration_ms": int((time.monotonic() - started) * 1000),
    }


def _clamp_timeout(raw: float | None) -> float:
    try:
        timeout = float(raw) if raw is not None else _DEFAULT_PROBE_TIMEOUT
    except (TypeError, ValueError):
        timeout = _DEFAULT_PROBE_TIMEOUT
    return max(1.0, min(timeout, _MAX_PROBE_TIMEOUT))


@router.get("/mcp/servers")
async def mcp_list(request: Request):
    manager = _manager(request)
    configs = manager.load_configs()
    servers = [_public_server(name, cfg, manager)
               for name, cfg in configs.items()]
    return {"ok": True, "count": len(servers), "servers": servers}


@router.get("/mcp/servers/{name}/status")
async def mcp_status(request: Request, name: str,
                     timeout: float | None = None):
    manager = _manager(request)
    configs = manager.load_configs()
    cfg = configs.get(name)
    if cfg is None:
        return _not_found(name)
    proc = manager.servers.get(name)
    if proc is not None and proc.connected:
        return {"ok": True, **_public_server(name, cfg, manager),
                "reachable": True, "duration_ms": 0}
    if not cfg.enabled:
        return {"ok": True, **_public_server(name, cfg, manager),
                "reachable": False,
                "error": "server is disabled in config",
                "duration_ms": 0}
    if not cfg.command or not shutil.which(cfg.command):
        return {"ok": True, **_public_server(name, cfg, manager),
                "reachable": False,
                "error": f"command not found: {cfg.command!r}",
                "duration_ms": 0}
    probe = await _probe(cfg, _clamp_timeout(timeout))
    return {"ok": True, **_public_server(name, cfg, manager),
            "reachable": probe["reachable"],
            "tools_count": probe["tools_count"],
            "tools": probe["tools"],
            "error": probe["error"],
            "duration_ms": probe["duration_ms"]}


@router.post("/mcp/servers/{name}/test")
async def mcp_test(request: Request, name: str,
                   timeout: float | None = None):
    """Explicit handshake test for one server (same probe as status)."""
    manager = _manager(request)
    configs = manager.load_configs()
    cfg = configs.get(name)
    if cfg is None:
        return _not_found(name)
    if not cfg.enabled:
        return {"ok": False, "name": name, "reachable": False,
                "error": "server is disabled in config",
                "tools_count": 0, "tools": [], "duration_ms": 0}
    if not cfg.command or not shutil.which(cfg.command):
        return {"ok": False, "name": name, "reachable": False,
                "error": f"command not found: {cfg.command!r}",
                "tools_count": 0, "tools": [], "duration_ms": 0}
    probe = await _probe(cfg, _clamp_timeout(timeout))
    return {"ok": probe["reachable"], "name": name, **probe}


BUILTIN_MCP_PRESETS = [
    {
        "id": "filesystem",
        "name": "filesystem",
        "label": "Filesystem",
        "icon": "📁",
        "desc": "Local workspace filesystem",
        "auto_detected": True,
        "detection_info": "JARVIS Workspace",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
    },
    {
        "id": "github",
        "name": "github",
        "label": "GitHub",
        "icon": "🐙",
        "desc": "Repos, PRs, issues",
        "auto_detected": bool(shutil.which("gh")),
        "detection_info": "gh CLI detected" if shutil.which("gh") else "Requires gh / PAT",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
    },
    {
        "id": "sqlite",
        "name": "sqlite",
        "label": "SQLite",
        "icon": "🗃",
        "desc": "JARVIS databases",
        "auto_detected": True,
        "detection_info": "models.db ready",
        "command": "uvx",
        "args": ["mcp-server-sqlite", "--db-path", "data/models.db"],
    },
    {
        "id": "puppeteer",
        "name": "puppeteer",
        "label": "Puppeteer",
        "icon": "🤖",
        "desc": "Browser automation",
        "auto_detected": bool(shutil.which("npx")),
        "detection_info": "NPX Ready" if shutil.which("npx") else "Requires Node.js",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
    },
    {
        "id": "brave-search",
        "name": "brave-search",
        "label": "Brave Search",
        "icon": "🔍",
        "desc": "Live web search & news",
        "auto_detected": False,
        "detection_info": "Requires Key",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-brave-search"],
    },
]


@router.get("/mcp/presets")
async def mcp_presets(request: Request):
    manager = _manager(request)
    configs = manager.load_configs()
    configured_names = set(configs.keys())

    presets = []
    for p in BUILTIN_MCP_PRESETS:
        item = dict(p)
        item["already_configured"] = p["id"] in configured_names
        proc = manager.servers.get(p["id"])
        item["is_running"] = bool(proc and proc.connected)
        presets.append(item)
    return {"ok": True, "presets": presets}


@router.post("/mcp/presets/{preset_id}/connect")
async def mcp_connect_preset(request: Request, preset_id: str):
    preset = next((p for p in BUILTIN_MCP_PRESETS if p["id"] == preset_id), None)
    if not preset:
        return JSONResponse({"ok": False, "error": f"unknown MCP preset: {preset_id!r}"}, status_code=404)

    manager = _manager(request)
    configs = manager.load_configs()
    name = preset["name"]
    cfg = MCPServerConfig(
        name=name,
        command=preset["command"],
        args=list(preset["args"]),
        env={},
        enabled=True,
        description=preset.get("desc", ""),
    )
    configs[name] = cfg
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
    manager.save_configs(raw_dict)
    return {"ok": True, "server": name}

