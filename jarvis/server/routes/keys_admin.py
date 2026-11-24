"""Admin routes for API-key pools.

All endpoints here are CAUTION: they mutate credential pools and
**require confirm mode** (``permissions.mode: confirm``). Under
``bypass`` every write is refused with 403.

Safety rules:
- Only *masked* keys are ever returned (``sk-a***bc12`` shape) — the
  full value never appears in a response or a log line.
- The KeyManager lives in ``jarvis.core.key_manager`` on audit/fixes; it
  may not exist on this backend build yet. Handlers resolve it lazily
  (``orchestrator.brain.key_manager`` → ``app.state.key_manager`` → a
  fresh ``KeyManager`` built from config) and answer 503 when the module
  is absent, instead of crashing the app.
- ``POST /api/keys/probe`` by default only checks pool membership and
  status. Pass ``{"live": true}`` for a real ``GET {endpoint}/models``
  check (2 s timeout); a live failure marks the key invalid, a live
  success marks it successful.
"""
from __future__ import annotations

import importlib
import re
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator, model_validator

from .common import _services

router = APIRouter()

# Providers the KeyManager knows about (same list as its vault loader).
_KNOWN_PROVIDERS = [
    "groq", "gemini", "openai", "anthropic", "openrouter", "deepseek",
    "mistral", "cerebras", "nvidia", "cohere", "sambanova", "together",
    "huggingface", "genrelay", "omniroute",
]


class KeyAddBody(BaseModel):
    provider: str
    key: str


class KeyProbeBody(BaseModel):
    provider: str
    key: str | None = None
    masked: str | None = None
    live: bool = False


class KeyRemoveBody(BaseModel):
    provider: str
    # Identify the key by full value, masked value, or key id — at least
    # one is required. A full value is never echoed back in the response.
    key: str | None = None
    masked: str | None = None
    key_id: str | None = None


def _split_keys_blob(blob: str) -> list[str]:
    """Split a pasted block of keys (newlines / commas / semicolons)."""
    out: list[str] = []
    for chunk in re.split(r"[\n,;]+", blob):
        item = chunk.strip().strip('"').strip("'")
        if item:
            out.append(item)
    return out


class KeyBulkBody(BaseModel):
    provider: str
    # The Settings UI bulk-paste box sends the keys as ONE
    # newline-separated string (``{"provider": ..., "keys": "sk-...\\nsk-..."}``)
    # or under ``text`` — both used to 422 against ``list[str]``. Accept
    # the list shape (unchanged), a single string blob, a ``text`` blob,
    # and list items shaped ``{"key": "..."}``; all normalize to a list.
    keys: list[str] | str | None = None
    text: str | None = None

    @field_validator("keys", mode="before")
    @classmethod
    def _coerce_keys(cls, v: Any) -> Any:
        if isinstance(v, list):
            out: list[str] = []
            for item in v:
                if isinstance(item, dict):
                    item = item.get("key") or item.get("value") or ""
                out.append(str(item))
            return out
        return v

    @model_validator(mode="after")
    def _fill_from_text(self) -> "KeyBulkBody":
        if isinstance(self.keys, str):
            self.keys = _split_keys_blob(self.keys)
        if not self.keys and self.text:
            self.keys = _split_keys_blob(self.text)
        return self


def _unavailable(reason: str) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"available": False, "reason": reason},
    )


def _require_confirm(cfg: Any) -> None:
    mode = getattr(getattr(cfg, "permissions", None), "mode", "confirm")
    if mode != "confirm":
        raise HTTPException(
            status_code=403,
            detail=(
                "refused: permissions.mode is %r — key writes require "
                "confirm mode; set permissions.mode: confirm in config.yaml"
                % mode
            ),
        )


def _get_key_manager(request: Request):
    """Resolve the live KeyManager, or None if the module is absent."""
    cfg, orchestrator, *_ = _services(request)
    brain = getattr(orchestrator, "brain", None)
    km = getattr(brain, "key_manager", None) if brain is not None else None
    if km is not None:
        return km
    km = getattr(request.app.state, "key_manager", None)
    if km is not None:
        return km
    try:
        mod = importlib.import_module("jarvis.core.key_manager")
    except Exception:
        return None
    initial = {}
    mc = getattr(cfg, "model", None)
    pool = getattr(mc, "api_keys_pool", None) if mc is not None else None
    if isinstance(pool, dict) and pool:
        initial = pool
    try:
        km = mod.KeyManager(initial or None)
    except Exception:
        return None
    request.app.state.key_manager = km
    return km


def _providers_for(cfg: Any, km: Any) -> list[str]:
    providers = list(_KNOWN_PROVIDERS)
    mc = getattr(cfg, "model", None)
    if mc is not None and getattr(mc, "provider", None):
        providers.append(str(mc.provider).lower())
    try:
        pools = getattr(km, "_pools", {}) or {}
        providers.extend(str(p).lower() for p in pools)
    except Exception:  # noqa: BLE001
        pass
    return sorted(set(providers))


@router.get("/keys")
async def keys_list(request: Request, provider: str | None = None):
    cfg, *_ = _services(request)
    km = _get_key_manager(request)
    if km is None:
        return _unavailable(
            "key_manager module not present on this backend build "
            "(arrives with the audit/fixes merge)")
    providers = [provider.lower()] if provider else _providers_for(cfg, km)
    out: dict[str, list[dict[str, Any]]] = {}
    for prov in providers:
        try:
            masked = km.get_masked_keys(prov)
        except Exception:
            masked = []
        if masked:
            out[prov] = masked
    active = {}
    for prov in providers:
        try:
            active[prov] = km.get_active_key(prov) is not None
        except Exception:
            active[prov] = False
    return {
        "available": True,
        "providers": out,
        "has_active_key": active,
    }


@router.post("/keys/probe")
async def keys_probe(request: Request, body: KeyProbeBody):
    cfg, *_ = _services(request)
    _require_confirm(cfg)
    km = _get_key_manager(request)
    if km is None:
        return _unavailable("key_manager module not present on this backend build")
    provider = body.provider.lower().strip()
    if not provider:
        raise HTTPException(status_code=400, detail="provider is required")
    masked_entries = km.get_masked_keys(provider)
    target_masked = body.masked
    full_key = (body.key or "").strip()
    entry = None
    if full_key:
        # Identify by full value without ever returning it.
        try:
            from jarvis.core.key_manager import mask_key as _mask
        except Exception:
            _mask = None
        if _mask is not None:
            target_masked = _mask(full_key)
    if target_masked:
        entry = next(
            (e for e in masked_entries if e.get("masked") == target_masked), None)
    if entry is None:
        raise HTTPException(
            status_code=404, detail=f"no such key in pool for {provider}")
    result: dict[str, Any] = {
        "available": True,
        "provider": provider,
        "masked": entry["masked"],
        "status": entry["status"],
        "cooldown_remaining": entry.get("cooldown_remaining", 0),
        "failures": entry.get("failures", 0),
        "successes": entry.get("successes", 0),
        "last_error": entry.get("last_error"),
        "live_checked": False,
    }
    if body.live:
        # Real check: GET {endpoint}/models with the key, 2 s timeout.
        endpoint = ""
        catalog = None
        try:
            catalog = importlib.import_module("jarvis.core.providers_catalog")
        except Exception:
            catalog = None
        if catalog is not None:
            spec = catalog.get_provider_spec(provider)
            endpoint = getattr(spec, "default_base_url", "") if spec else ""
        if not endpoint and provider == str(
                getattr(getattr(cfg, "model", None), "provider", "")).lower():
            endpoint = getattr(getattr(cfg, "model", None), "endpoint", "") or ""
        if not endpoint:
            result["live_error"] = f"no known endpoint for {provider}"
            return result
        url = endpoint.rstrip("/") + "/models"
        try:
            headers = {"Authorization": f"Bearer {full_key}"} if full_key else {}
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(url, headers=headers)
            result["live_checked"] = True
            result["live_status"] = resp.status_code
            if resp.status_code < 400:
                if full_key:
                    km.mark_success(provider, full_key)
                result["status"] = "active"
            elif resp.status_code in (401, 403):
                if full_key:
                    km.mark_invalid(provider, full_key, "Auth failed (live probe)")
                result["status"] = "invalid"
        except Exception as e:  # noqa: BLE001 - probe failure is data
            result["live_checked"] = True
            result["live_error"] = str(e)[:200]
    return result


@router.post("/keys/add")
async def keys_add(request: Request, body: KeyAddBody):
    cfg, *_ = _services(request)
    _require_confirm(cfg)
    km = _get_key_manager(request)
    if km is None:
        return _unavailable("key_manager module not present on this backend build")
    provider = body.provider.lower().strip()
    key = body.key.strip()
    if not provider or not key:
        raise HTTPException(status_code=400, detail="provider and key required")
    if not km.add_key(provider, key):
        raise HTTPException(
            status_code=409, detail="key already present in pool")
    return {"ok": True, "provider": provider,
            "masked": km.get_masked_keys(provider)[-1]["masked"]
            if km.get_masked_keys(provider) else None}


@router.post("/keys/remove")
async def keys_remove(request: Request, body: KeyRemoveBody):
    """Remove one key by full value, masked value, or key id (POST form).

    The UI's key-remove button POSTs a JSON body; the DELETE
    ``/api/keys/{key_id}`` route stays as the REST equivalent. The full
    key value is never echoed back — only its masked form.
    """
    cfg, *_ = _services(request)
    _require_confirm(cfg)
    km = _get_key_manager(request)
    if km is None:
        return _unavailable("key_manager module not present on this backend build")
    provider = body.provider.lower().strip()
    identifier = (
        (body.key or "").strip()
        or (body.masked or "").strip()
        or (body.key_id or "").strip()
    )
    if not provider or not identifier:
        raise HTTPException(
            status_code=400,
            detail="provider and one of key / masked / key_id are required")
    if not km.remove_key(provider, identifier):
        raise HTTPException(
            status_code=404, detail=f"no such key in pool for {provider}")
    # Echo only the masked form — never a full key value.
    removed = identifier
    if body.key:
        try:
            from jarvis.core.key_manager import mask_key as _mask
            removed = _mask(body.key)
        except Exception:
            removed = "••••••••"
    return {
        "ok": True,
        "provider": provider,
        "removed": removed,
        "remaining": len(km.get_masked_keys(provider)),
    }


@router.delete("/keys/{key_id}")
async def keys_delete(request: Request, key_id: str, provider: str | None = None):
    cfg, *_ = _services(request)
    _require_confirm(cfg)
    km = _get_key_manager(request)
    if km is None:
        return _unavailable("key_manager module not present on this backend build")
    providers = [provider.lower()] if provider else _providers_for(cfg, km)
    for prov in providers:
        try:
            if km.remove_key(prov, key_id):
                return {"ok": True, "provider": prov, "removed": key_id}
        except Exception:
            continue
    raise HTTPException(status_code=404, detail=f"no such key: {key_id}")


@router.post("/keys/bulk-import")
async def keys_bulk_import(request: Request, body: KeyBulkBody):
    cfg, *_ = _services(request)
    _require_confirm(cfg)
    km = _get_key_manager(request)
    if km is None:
        return _unavailable("key_manager module not present on this backend build")
    provider = body.provider.lower().strip()
    if not provider or not body.keys:
        raise HTTPException(
            status_code=400, detail="provider and a non-empty keys list required")
    added = 0
    duplicates = 0
    for raw in body.keys:
        key = str(raw).strip().strip('"').strip("'")
        if not key:
            continue
        if km.add_key(provider, key):
            added += 1
        else:
            duplicates += 1
    return {
        "ok": True,
        "provider": provider,
        "added": added,
        "duplicates": duplicates,
        "total_in_pool": len(km.get_masked_keys(provider)),
    }
