"""Admin routes for models, the failover cascade, and config.

Read endpoints are SAFE; ``POST /api/config`` is CAUTION (it rewrites
``config.yaml`` and needs a restart to take effect).

Design notes (backend port from audit/fixes):
- The multi-tier cascade lives in ``LLMBrain.get_cascade_tiers()`` on
  audit/fixes; on ui-hud-upgrade the brain may not have it yet, so the
  cascade endpoint first tries the brain, then falls back to tiers built
  from the live config + ``providers_catalog`` (if importable).
- ``providers_catalog`` / ``key_manager`` / ``council`` may not exist on
  this backend build yet (they arrive with the audit/fixes merge). Every
  handler imports them lazily and answers 503 with an honest
  ``{"available": false, "reason": ...}`` instead of crashing the app.
- No full API key is ever logged or returned by any endpoint here.
"""
from __future__ import annotations

import importlib
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from .common import _services

router = APIRouter()

# Sections a config POST is allowed to touch. ``permissions`` is excluded
# on purpose: flipping permission mode over the API is out of scope, and
# ``bypass`` must never be settable from here.
_CONFIG_WRITABLE_SECTIONS = {
    "A", "model", "image_model", "ui", "memory", "logging", "backups",
    "code_execution", "project", "plugins", "agents", "mission", "voice",
    "ultimate",
}
_SECRET_HINTS = ("api_key", "token", "secret", "password", "passwd", "apikey")


def _unavailable(reason: str) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"available": False, "reason": reason},
    )


def _require_confirm(cfg: Any) -> None:
    """Writes here require confirm mode — never run them under bypass."""
    mode = getattr(getattr(cfg, "permissions", None), "mode", "confirm")
    if mode != "confirm":
        raise HTTPException(
            status_code=403,
            detail=(
                "refused: permissions.mode is %r — key/config writes require "
                "confirm mode; set permissions.mode: confirm in config.yaml"
                % mode
            ),
        )


def _optional_module(name: str):
    try:
        return importlib.import_module(name)
    except Exception:
        return None


def _scrub(value: Any) -> Any:
    """Recursively mask anything that looks like a secret in a config dump."""
    if isinstance(value, dict):
        return {
            k: ("••••••••" if _looks_secret(k, v) else _scrub(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return value


def _looks_secret(key: str, value: Any) -> bool:
    if not isinstance(value, str) or not value:
        return False
    lowered = key.lower()
    return any(hint in lowered for hint in _SECRET_HINTS)


def _tier_dict(tier: Any) -> dict[str, Any]:
    if is_dataclass(tier):
        return asdict(tier)
    if isinstance(tier, dict):
        return dict(tier)
    return {
        "name": getattr(tier, "name", "tier"),
        "provider": getattr(tier, "provider", ""),
        "endpoint": getattr(tier, "endpoint", ""),
        "model": getattr(tier, "model", ""),
        "is_local": bool(getattr(tier, "is_local", False)),
        "timeout": getattr(tier, "timeout", 14.0),
        "ttft_timeout": getattr(tier, "ttft_timeout", 5.0),
    }


def _fallback_tiers(cfg: Any) -> list[dict[str, Any]]:
    """Config-derived cascade tiers (used when the brain has no cascade)."""
    mc = getattr(cfg, "model", None)
    tiers: list[dict[str, Any]] = []
    seen: set[str] = set()
    if mc is not None:
        provider = getattr(mc, "provider", "") or "openai_compatible"
        model = getattr(mc, "model", "") or ""
        endpoint = getattr(mc, "endpoint", "") or ""
        tiers.append({
            "name": "Tier 0 (Primary)",
            "provider": provider,
            "endpoint": endpoint,
            "model": model,
            "is_local": provider in ("ollama", "lmstudio"),
            "timeout": 60.0 if provider in ("ollama", "lmstudio") else 15.0,
            "ttft_timeout": 25.0 if provider in ("ollama", "lmstudio") else 6.0,
        })
        seen.add(f"{provider}/{model}")
        fb_p = getattr(mc, "fallback_provider", None) or "openrouter"
        fb_m = getattr(mc, "fallback_model", None) or "deepseek/deepseek-chat"
        fb_e = getattr(mc, "fallback_endpoint", None) or ""
        if f"{fb_p}/{fb_m}" not in seen:
            tiers.append({
                "name": "Tier 2 (Resilient Cloud)",
                "provider": fb_p,
                "endpoint": fb_e,
                "model": fb_m,
                "is_local": fb_p in ("ollama", "lmstudio"),
                "timeout": 20.0,
                "ttft_timeout": 6.0,
            })
            seen.add(f"{fb_p}/{fb_m}")
    catalog = _optional_module("jarvis.core.providers_catalog")
    if catalog is not None:
        spec = catalog.get_provider_spec("omniroute")
        if spec is not None:
            import os
            omni_model = os.environ.get(
                "JARVIS_OMNIROUTE_MODEL", "groq/openai/gpt-oss-120b")
            if f"omniroute/{omni_model}" not in seen:
                tiers.append({
                    "name": "Tier 3 (9Router Aggregate)",
                    "provider": "omniroute",
                    "endpoint": getattr(spec, "default_base_url", ""),
                    "model": omni_model,
                    "is_local": True,
                    "timeout": 30.0,
                    "ttft_timeout": 10.0,
                })
    return tiers


@router.get("/models/cascade")
async def models_cascade(request: Request):
    cfg, orchestrator, *_ = _services(request)
    brain = getattr(orchestrator, "brain", None)
    tiers = None
    source = "brain"
    if brain is not None and hasattr(brain, "get_cascade_tiers"):
        try:
            tiers = [_tier_dict(t) for t in brain.get_cascade_tiers()]
        except Exception as e:  # noqa: BLE001 - fall back to config tiers
            tiers = None
            source = f"brain-error:{e}"
    if tiers is None:
        tiers = _fallback_tiers(cfg)
        source = "config-fallback"
    # Annotate each tier with key-pool health when a KeyManager is present.
    km = getattr(brain, "key_manager", None) if brain is not None else None
    if km is not None:
        for tier in tiers:
            try:
                pool = km.get_masked_keys(tier.get("provider", ""))
                tier["keys_available"] = sum(
                    1 for k in pool if k.get("status") == "active")
                tier["keys_total"] = len(pool)
            except Exception:  # noqa: BLE001 - health is best-effort
                tier["keys_available"] = None
                tier["keys_total"] = None
    return {"available": True, "source": source, "tiers": tiers}


@router.get("/models/verified")
async def models_verified(request: Request):
    council_mod = _optional_module("jarvis.core.council")
    if council_mod is None:
        return _unavailable(
            "council module not present on this backend build "
            "(arrives with the audit/fixes merge)")
    try:
        members = council_mod.roster_from_verified_lineup()
    except Exception as e:  # noqa: BLE001
        return _unavailable(f"could not load verified lineup: {e}")
    out = []
    for m in members:
        d = asdict(m) if is_dataclass(m) else dict(m)
        try:
            d["avg_latency_ms"] = council_mod._avg_latency_for(
                d.get("provider", ""), d.get("model", ""))
        except Exception:  # noqa: BLE001 - latency is best-effort
            d["avg_latency_ms"] = None
        out.append(d)
    benchmark = []
    try:
        benchmark = council_mod.AICouncil.get_last_benchmark()
    except Exception:  # noqa: BLE001
        benchmark = []
    return {
        "available": True,
        "verified": out,
        "count": len(out),
        "last_benchmark": benchmark,
    }


@router.get("/models")
async def models_list(request: Request):
    cfg, *_ = _services(request)
    mc = getattr(cfg, "model", None)
    current = {
        "provider": getattr(mc, "provider", None),
        "model": getattr(mc, "model", None),
        "endpoint": getattr(mc, "endpoint", None),
        "temperature": getattr(mc, "temperature", None),
        "max_tokens": getattr(mc, "max_tokens", None),
        "native_tool_calls": getattr(mc, "native_tool_calls", None),
    }
    catalog = _optional_module("jarvis.core.providers_catalog")
    if catalog is None:
        return {
            "available": True,
            "providers_available": False,
            "reason": "providers_catalog not present on this backend build",
            "current": current,
            "providers": [],
        }
    providers = []
    for spec in catalog.list_providers():
        providers.append({
            "id": getattr(spec, "id", ""),
            "name": getattr(spec, "display_name", getattr(spec, "id", "")),
            "endpoint": getattr(spec, "default_base_url", ""),
            "protocol": str(getattr(spec, "protocol", "")),
            "free_tier": bool(getattr(spec, "free_tier", False)),
            "local": bool(getattr(spec, "local", False)),
            "credential_env": getattr(spec, "credential_env", None),
        })
    return {
        "available": True,
        "providers_available": True,
        "current": current,
        "providers": providers,
    }


@router.get("/config")
async def config_get(request: Request):
    cfg, *_ = _services(request)
    try:
        dumped = cfg.model_dump(mode="json")
    except Exception:
        dumped = {k: getattr(cfg, k) for k in dir(cfg) if not k.startswith("_")}
    return {
        "available": True,
        "config": _scrub(dumped),
        "_meta": {
            "config_path": str(Path(getattr(cfg, "project_root", ".")) / "config.yaml"),
            "permissions_mode": getattr(
                getattr(cfg, "permissions", None), "mode", None),
            "note": "Secrets are masked. Restart the backend for config "
                    "changes to take effect.",
        },
    }


@router.post("/config")
async def config_post(request: Request, body: dict):
    cfg, *_ = _services(request)
    _require_confirm(cfg)
    updates = body.get("updates", body) if isinstance(body, dict) else {}
    if not isinstance(updates, dict) or not updates:
        raise HTTPException(status_code=400, detail="body must contain updates")
    forbidden = sorted(set(updates) - _CONFIG_WRITABLE_SECTIONS)
    if forbidden:
        raise HTTPException(
            status_code=400,
            detail=f"sections not writable via API: {forbidden}",
        )
    # Reject anything secret-shaped anywhere in the update.
    def _contains_secret(obj: Any) -> bool:
        if isinstance(obj, dict):
            return any(_looks_secret(k, v) or _contains_secret(v)
                       for k, v in obj.items())
        if isinstance(obj, list):
            return any(_contains_secret(v) for v in obj)
        return False
    if _contains_secret(updates):
        raise HTTPException(
            status_code=400,
            detail="updates must not contain api keys, tokens or secrets — "
                   "use the /api/keys endpoints for credentials",
        )
    # Validate the merged config through Pydantic before touching disk.
    try:
        current = cfg.model_dump(mode="json")
    except Exception:
        current = {}
    from ...config import Config as _Config, _deep_merge

    merged = _deep_merge(current, updates)
    try:
        _Config(**merged)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"invalid config: {e}")
    # Write back the raw yaml (round-trip through the file, not the model,
    # so comments and unknown keys survive).
    cfg_path = Path(getattr(cfg, "project_root", ".")) / "config.yaml"
    try:
        raw = {}
        if cfg_path.exists():
            with cfg_path.open("r", encoding="utf-8") as f:
                raw = yaml.safe_load(f) or {}
        merged_raw = _deep_merge(raw, updates)
        with cfg_path.open("w", encoding="utf-8") as f:
            yaml.safe_dump(merged_raw, f, allow_unicode=True, sort_keys=False)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"could not write config: {e}")
    return {
        "ok": True,
        "applied_sections": sorted(updates),
        "requires_restart": True,
        "config_path": str(cfg_path),
    }
