"""Plugin toggle routes.

``POST /api/plugins/{name}/toggle`` enables or disables one plugin;
``GET /api/plugins/state`` lists every discovered plugin with its
effective enabled flag. (The read-only ``GET /api/plugins`` list
already lives in :mod:`jarvis.server.routes.system`.)

Persistence — no state file existed before this module. The registry
(:mod:`jarvis.plugins.registry`) reads its enabled flags from
``cfg.plugins`` (loaded from ``config.yaml`` at boot), and this module
deliberately does NOT rewrite ``config.yaml``. Instead toggles are
persisted in ``data/plugin_toggles.json`` (owner-only mode, atomic
write) via :class:`PluginToggleStore`, and applied to the live
registry in the same request:

* the toggle is written to ``cfg.plugins`` in memory,
* ``registry.reload_all()`` re-imports the enabled plugins, so the
  disabled plugin's tools disappear (and re-appear on re-enable)
  without a restart.

Surviving a *restart* needs one line of startup wiring that lives
outside this module's owned files: call
``apply_persisted_toggles(cfg)`` in ``jarvis/main.py::build_services``
*before* ``registry.load_all()``. Until that lands, a toggle applied
in a running server survives reloads of the registry but a fresh boot
reads ``config.yaml`` only — see the module docstring of
``apply_persisted_toggles`` and the swarm report. The JSON file is
the source of truth either way, so no toggle is ever lost silently.

Safety: only discovered plugin modules (a ``register(registry)``
module under ``jarvis/plugins/``) or names already known to the
registry/config can be toggled; anything else is a 404. The toggle
body must carry ``{"enabled": bool}``. No secrets are involved —
the state file holds plugin names and booleans only.
"""
from __future__ import annotations

import json
import logging
import os
import pkgutil
import time
from pathlib import Path
from types import SimpleNamespace

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .common import _services

log = logging.getLogger("jarvis.server.routes.plugins")

router = APIRouter()

TOGGLES_FILENAME = "data/plugin_toggles.json"
# Modules inside jarvis/plugins that are infrastructure, not plugins.
_NON_PLUGIN_MODULES = {"__init__", "base", "registry"}


class ToggleRequest(BaseModel):
    enabled: bool


class PluginToggleStore:
    """JSON state file for plugin toggles: ``{name: {"enabled": bool}}``.

    Written atomically (temp file + replace, mode 0600) so a crash
    mid-write never leaves a half-written file. Holds names and
    booleans only — never secrets, keys, or config values.
    """

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def load(self) -> dict[str, bool]:
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return {}
        except OSError as e:
            log.warning("could not read plugin toggles %s: %s", self.path, e)
            return {}
        try:
            data = json.loads(raw)
        except ValueError:
            log.warning("plugin toggles %s is not valid JSON", self.path)
            return {}
        if not isinstance(data, dict):
            return {}
        out: dict[str, bool] = {}
        for name, entry in data.items():
            if isinstance(entry, dict) and isinstance(entry.get("enabled"), bool):
                out[str(name)] = entry["enabled"]
            elif isinstance(entry, bool):
                out[str(name)] = entry
        return out

    def set(self, name: str, enabled: bool) -> dict[str, bool]:
        """Persist one toggle; returns the full state after the write."""
        state = self.load()
        state[name] = bool(enabled)
        payload = {
            n: {"enabled": v, "updated_at": time.time()}
            for n, v in sorted(state.items())
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, self.path)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass
        return state


def _store(request: Request) -> PluginToggleStore:
    cfg, *_ = _services(request)
    return PluginToggleStore(cfg.abs_path(TOGGLES_FILENAME))


def _store_for_cfg(cfg) -> PluginToggleStore:
    return PluginToggleStore(cfg.abs_path(TOGGLES_FILENAME))


def discover_plugin_names() -> set[str]:
    """Module names under ``jarvis/plugins`` that can be toggled."""
    import jarvis.plugins as pkg

    names = set()
    for mod in pkgutil.iter_modules(pkg.__path__):
        if mod.name not in _NON_PLUGIN_MODULES:
            names.add(mod.name)
    return names


def _set_cfg_toggle(cfg, name: str, enabled: bool) -> None:
    """Mirror a toggle into ``cfg.plugins`` (real Config or a test fake)."""
    plugins = getattr(cfg, "plugins", None)
    if plugins is None:
        return
    try:
        from ..config import PluginToggle

        plugins[name] = PluginToggle(enabled=bool(enabled))
    except Exception:  # noqa: BLE001 — test fakes without the real Config
        plugins[name] = SimpleNamespace(enabled=bool(enabled))


def apply_persisted_toggles(cfg) -> list[str]:
    """Merge ``data/plugin_toggles.json`` into ``cfg.plugins``.

    STARTUP WIRING (not in this module's owned files): call this in
    ``jarvis/main.py::build_services`` *before* ``registry.load_all()``.
    ``PluginRegistry.load_all()`` consults ``cfg.plugins`` only, so
    without that one call a toggle survives the running server and
    every registry reload, but a fresh boot falls back to
    ``config.yaml``. Returns the plugin names the file overrode.
    """
    state = _store_for_cfg(cfg).load()
    applied = []
    for name, enabled in state.items():
        _set_cfg_toggle(cfg, name, enabled)
        applied.append(name)
    if applied:
        log.info("applied %d persisted plugin toggle(s): %s",
                 len(applied), ", ".join(sorted(applied)))
    return applied


def _effective_enabled(cfg, name: str, persisted: dict[str, bool]) -> bool:
    """Persisted file wins; then ``cfg.plugins``; absent means enabled
    (``PluginRegistry.load_all`` loads a plugin unless explicitly
    disabled)."""
    if name in persisted:
        return persisted[name]
    toggle = (getattr(cfg, "plugins", None) or {}).get(name)
    if toggle is None:
        return True
    return bool(getattr(toggle, "enabled", True))


def _known_names(request: Request, cfg) -> set[str]:
    names = discover_plugin_names()
    registry = getattr(request.app.state, "registry", None)
    if registry is not None:
        try:
            names |= {p.name for p in registry.plugins()}
        except Exception:  # noqa: BLE001
            pass
    names |= set((getattr(cfg, "plugins", None) or {}).keys())
    return names


@router.get("/plugins/state")
async def plugins_state(request: Request):
    cfg, *_ = _services(request)
    registry = getattr(request.app.state, "registry", None)
    persisted = _store(request).load()
    registered = {}
    if registry is not None:
        try:
            registered = {p.name: p for p in registry.plugins()}
        except Exception:  # noqa: BLE001
            registered = {}
    tools_by_plugin: dict[str, int] = {}
    if registry is not None:
        try:
            for t in registry.all_tools():
                if t.plugin:
                    tools_by_plugin[t.plugin] = tools_by_plugin.get(t.plugin, 0) + 1
        except Exception:  # noqa: BLE001
            pass
    names = sorted(_known_names(request, cfg))
    return {
        "ok": True,
        "plugins": [
            {
                "name": name,
                "enabled": _effective_enabled(cfg, name, persisted),
                "persisted": name in persisted,
                "registered": name in registered,
                "tools": tools_by_plugin.get(name, 0),
            }
            for name in names
        ],
    }


@router.post("/plugins/{name}/toggle")
async def plugin_toggle(request: Request, name: str, body: ToggleRequest):
    cfg, *_ = _services(request)
    registry = getattr(request.app.state, "registry", None)
    if name not in _known_names(request, cfg):
        return JSONResponse(
            status_code=404,
            content={"ok": False, "plugin": name,
                     "error": f"unknown plugin: {name!r}"},
        )
    enabled = bool(body.enabled)
    # 1. Persist first — fail closed: if the file cannot be written,
    #    do not change the running server either.
    try:
        _store(request).set(name, enabled)
    except OSError as e:
        log.warning("could not persist plugin toggle %s: %s", name, e)
        return JSONResponse(
            status_code=500,
            content={"ok": False, "plugin": name, "enabled": enabled,
                     "error": f"could not persist toggle: {e}"},
        )
    # 2. Mirror into cfg.plugins so the registry sees the new state.
    #    The registry reads its OWN cfg on reload_all(); in production
    #    that is the same object as the request cfg, but mirror into
    #    both so the toggle can never silently miss the reload.
    _set_cfg_toggle(cfg, name, enabled)
    if registry is not None and getattr(registry, "cfg", None) is not None \
            and registry.cfg is not cfg:
        _set_cfg_toggle(registry.cfg, name, enabled)
    # 3. Apply live: reload_all() re-imports only the enabled plugins.
    applied_live = False
    if registry is not None:
        try:
            registry.reload_all()
            applied_live = True
        except Exception as e:  # noqa: BLE001
            log.warning("registry reload after toggling %s failed: %s", name, e)
            return JSONResponse(
                status_code=500,
                content={"ok": False, "plugin": name, "enabled": enabled,
                         "persisted": True, "applied_live": False,
                         "error": f"toggle persisted but live reload failed: {e}"},
            )
    tools = 0
    registered = False
    if registry is not None:
        try:
            tools = len(registry.all_tools())
            registered = any(p.name == name for p in registry.plugins())
        except Exception:  # noqa: BLE001
            pass
    return {
        "ok": True,
        "plugin": name,
        "enabled": enabled,
        "persisted": True,
        "applied_live": applied_live,
        "registered": registered,
        "tools": tools,
    }
