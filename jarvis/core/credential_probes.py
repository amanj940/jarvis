"""Zero-token lightweight credential checks for JARVIS.

Inspired directly by free-claude-code's credential_validation.py.
Validates API keys against official authenticated non-inference endpoints without
consuming generation tokens or incurring LLM costs.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

import httpx

from .providers_catalog import PROVIDER_CATALOG, ProviderProtocol, get_provider_spec

log = logging.getLogger("jarvis.probes")


class ProbeStatus(StrEnum):
    VERIFIED = "verified"      # Valid key and ready for inference
    REJECTED = "rejected"      # Key is explicitly invalid, expired, or rejected
    UNVERIFIED = "unverified"  # Network error, rate limit, or proxy timeout


@dataclass(frozen=True, slots=True)
class ProbeResult:
    key: str
    status: ProbeStatus
    message: str
    provider_id: str
    status_code: int | None = None
    details: dict[str, Any] | None = None


def _extract_error_detail(resp: httpx.Response) -> str:
    try:
        data = resp.json()
        if isinstance(data, dict):
            if "error" in data:
                err = data["error"]
                if isinstance(err, dict):
                    msg = err.get("message") or err.get("code")
                    if msg:
                        return str(msg)
                return str(err)
            if "message" in data:
                return str(data["message"])
            if "detail" in data:
                return str(data["detail"])
    except Exception:
        pass
    return resp.text[:200] if resp.text else f"HTTP {resp.status_code}"


async def probe_credential(provider_id: str, key: str, custom_endpoint: str | None = None) -> ProbeResult:
    """Probe an API key using the provider's designated non-inference endpoint."""
    pid = provider_id.lower().strip()
    spec = get_provider_spec(pid)
    
    if not spec:
        return ProbeResult(
            key=key,
            status=ProbeStatus.UNVERIFIED,
            message=f"Unknown provider '{provider_id}'",
            provider_id=pid,
        )

    # SSRF protection for custom_endpoint
    if custom_endpoint:
        # Import here to avoid circular dependency
        import sys
        sys.path.insert(0, "/home/kozer/AI/JARVIS")
        from jarvis.server.routes import _validate_url_ssrf
        allowed, reason = _validate_url_ssrf(custom_endpoint)
        if not allowed:
            return ProbeResult(
                key=key,
                status=ProbeStatus.REJECTED,
                message=f"SSRF protection: {reason}",
                provider_id=pid,
                status_code=400,
            )

    # Local providers without keys
    if not spec.requires_key:
        endpoint = custom_endpoint or spec.default_base_url
        target_url = endpoint.rstrip("/") + spec.probe_path
        try:
            async with httpx.AsyncClient(timeout=5.0, trust_env=True) as client:
                resp = await client.get(target_url)
                if resp.is_success:
                    return ProbeResult(
                        key="",
                        status=ProbeStatus.VERIFIED,
                        message=f"{spec.name} is running and reachable.",
                        provider_id=pid,
                        status_code=resp.status_code,
                    )
                return ProbeResult(
                    key="",
                    status=ProbeStatus.UNVERIFIED,
                    message=f"{spec.name} returned HTTP {resp.status_code}",
                    provider_id=pid,
                    status_code=resp.status_code,
                )
        except Exception as exc:
            return ProbeResult(
                key="",
                status=ProbeStatus.UNVERIFIED,
                message=f"Cannot connect to {spec.name} at {endpoint}. Ensure service is running.",
                provider_id=pid,
            )

    key = key.strip().strip('"').strip("'")
    if not key:
        return ProbeResult(
            key="",
            status=ProbeStatus.REJECTED,
            message="API key cannot be empty.",
            provider_id=pid,
        )

    base_url = (custom_endpoint or spec.default_base_url).rstrip("/")
    headers = {"User-Agent": "JARVIS-Probe/1.0"}

    # Special handling per provider
    try:
        async with httpx.AsyncClient(timeout=12.0, trust_env=True) as client:
            if pid == "gemini":
                # Google AI Studio supports both native endpoint and OpenAI compat
                # Test 1: Native endpoint with x-goog-api-key header
                url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1"
                resp = await client.get(url, headers={**headers, "x-goog-api-key": key})
                if resp.is_success:
                    return ProbeResult(key, ProbeStatus.VERIFIED, "Gemini API key verified successfully.", pid, resp.status_code)

                # Test 2: Native endpoint with ?key=
                url_param = f"https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key={key}"
                resp_param = await client.get(url_param, headers=headers)
                if resp_param.is_success:
                    return ProbeResult(key, ProbeStatus.VERIFIED, "Gemini API key verified successfully.", pid, resp_param.status_code)
                
                # Test 3: OpenAI-compat endpoint
                url2 = f"{base_url}/models"
                resp2 = await client.get(url2, headers={**headers, "Authorization": f"Bearer {key}"})
                if resp2.is_success:
                    return ProbeResult(key, ProbeStatus.VERIFIED, "Gemini API key verified successfully.", pid, resp2.status_code)

                # Analyze errors
                err_text = _extract_error_detail(resp) or _extract_error_detail(resp_param)
                if ("API_KEY_INVALID" in err_text) or ("API key not valid" in err_text):
                    return ProbeResult(key, ProbeStatus.REJECTED, f"Gemini rejected key: {err_text}", pid, resp.status_code)
                return ProbeResult(key, ProbeStatus.UNVERIFIED, f"Gemini probe: {err_text}", pid, resp.status_code)

            elif pid == "anthropic":
                url = f"{base_url}{spec.probe_path}"
                headers.update({
                    "x-api-key": key,
                    "anthropic-version": "2023-06-01",
                })
                resp = await client.get(url, headers=headers)
                if resp.is_success:
                    return ProbeResult(key, ProbeStatus.VERIFIED, "Anthropic key verified successfully.", pid, resp.status_code)
                err_text = _extract_error_detail(resp)
                if resp.status_code in (401, 403):
                    return ProbeResult(key, ProbeStatus.REJECTED, f"Anthropic rejected key: {err_text}", pid, resp.status_code)
                return ProbeResult(key, ProbeStatus.UNVERIFIED, f"Anthropic probe: {err_text}", pid, resp.status_code)

            elif pid == "deepseek":
                url = f"{base_url}{spec.probe_path}"
                headers["Authorization"] = f"Bearer {key}"
                resp = await client.get(url, headers=headers)
                if resp.is_success:
                    return ProbeResult(key, ProbeStatus.VERIFIED, "DeepSeek key verified successfully.", pid, resp.status_code)
                err_text = _extract_error_detail(resp)
                if resp.status_code in (401, 403):
                    return ProbeResult(key, ProbeStatus.REJECTED, f"DeepSeek rejected key: {err_text}", pid, resp.status_code)
                return ProbeResult(key, ProbeStatus.UNVERIFIED, f"DeepSeek probe: {err_text}", pid, resp.status_code)

            elif pid == "openrouter":
                url = f"{base_url}{spec.probe_path}"
                headers["Authorization"] = f"Bearer {key}"
                resp = await client.get(url, headers=headers)
                if resp.is_success:
                    return ProbeResult(key, ProbeStatus.VERIFIED, "OpenRouter key verified successfully.", pid, resp.status_code)
                err_text = _extract_error_detail(resp)
                if resp.status_code in (401, 403):
                    return ProbeResult(key, ProbeStatus.REJECTED, f"OpenRouter rejected key: {err_text}", pid, resp.status_code)
                return ProbeResult(key, ProbeStatus.UNVERIFIED, f"OpenRouter probe: {err_text}", pid, resp.status_code)

            else:
                # Standard OpenAI-compatible (Groq, OpenAI, Mistral, Cerebras, NVIDIA, etc.)
                url = f"{base_url}{spec.probe_path}"
                headers["Authorization"] = f"Bearer {key}"
                resp = await client.get(url, headers=headers)
                if resp.is_success:
                    return ProbeResult(key, ProbeStatus.VERIFIED, f"{spec.name} API key verified successfully.", pid, resp.status_code)
                err_text = _extract_error_detail(resp)
                if resp.status_code in (401, 403):
                    return ProbeResult(key, ProbeStatus.REJECTED, f"{spec.name} rejected key: {err_text}", pid, resp.status_code)
                if resp.status_code == 429:
                    return ProbeResult(key, ProbeStatus.UNVERIFIED, f"{spec.name} reports rate limit (429): {err_text}", pid, resp.status_code)
                return ProbeResult(key, ProbeStatus.UNVERIFIED, f"{spec.name} probe: {err_text}", pid, resp.status_code)

    except httpx.TimeoutException:
        return ProbeResult(key, ProbeStatus.UNVERIFIED, f"Connection to {spec.name} timed out. If you are behind a proxy, ensure it is active.", pid)
    except httpx.NetworkError as ne:
        return ProbeResult(key, ProbeStatus.UNVERIFIED, f"Network error connecting to {spec.name}: {ne}", pid)
    except Exception as exc:
        return ProbeResult(key, ProbeStatus.UNVERIFIED, f"Probe error: {exc}", pid)


CredentialStatus = ProbeStatus
CredentialCheck = ProbeResult


async def probe_credential_batch(provider_keys: list[tuple[str, str]]) -> list[ProbeResult]:
    """Probe a list of (provider_id, key) tuples concurrently."""
    import asyncio
    tasks = [probe_credential(p, k) for p, k in provider_keys]
    return await asyncio.gather(*tasks)
