"""OmniRoute Client for JARVIS - Free Tier Aggregation.

OmniRoute aggregates multiple free-tier AI providers into a single endpoint
with smart routing and automatic fallback. This module provides a client
to integrate OmniRoute with JARVIS.

Key providers supported (without keys):
- Pollinations - Open public API, no key needed
- Kiro AI - Free Claude tier (requires signup)
- OpenCode Free - No auth, generous rate limits
- Qoder - Free OAuth
- Cloudflare AI - Workers AI free tier
- Qwen - Unlimited access
- LongCat - 50M tokens/day

Reference: https://omniroute.hagicode.com
"""
from __future__ import annotations

import logging
import httpx
from dataclasses import dataclass
from typing import Any, Optional

log = logging.getLogger("jarvis.omniroute")


@dataclass
class OmniRouteConfig:
    """Configuration for OmniRoute integration."""
    enabled: bool = False
    base_url: str = "http://localhost:20128/v1"  # OmniRoute runs locally on port 20128
    fallback_to_paid: bool = True  # Fall back to paid providers if free tiers fail
    max_retries: int = 3
    timeout: float = 30.0
    model: str = "auto"  # "auto" for smart routing, or specific model


class OmniRouteClient:
    """Client for OmniRoute free-tier aggregation."""
    
    def __init__(self, config: OmniRouteConfig):
        self.config = config
        self._client: Optional[httpx.AsyncClient] = None
    
    @property
    def client(self) -> httpx.AsyncClient:
        """Lazy-initialize HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.config.timeout,
                trust_env=True,
            )
        return self._client
    
    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
    
    async def chat_completion(
        self,
        messages: list[dict[str, Any]],
        model: str = "auto",
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        stream: bool = False,
        api_key: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Send chat completion request to OmniRoute.
        
        Args:
            messages: Chat messages in OpenAI format
            model: Model name (default "auto" for smart routing)
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            stream: Whether to stream response
            api_key: OmniRoute API key (optional, can use env var)
        
        Returns:
            Response dict in OpenAI format
        """
        if not self.config.enabled:
            raise RuntimeError("OmniRoute is not enabled in config")
        
        # Get API key from parameter or environment
        if not api_key:
            import os
            api_key = os.environ.get("OMNIROUTE_API_KEY", "")
        
        payload = {
            "model": model or self.config.model,
            "messages": messages,
            "temperature": temperature,
        }
        
        if max_tokens:
            payload["max_tokens"] = max_tokens
        
        if stream:
            payload["stream"] = True
        
        headers = {
            "Content-Type": "application/json",
        }
        
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        
        try:
            response = await self.client.post(
                f"{self.config.base_url}/chat/completions",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            return response.json()
        
        except httpx.HTTPStatusError as e:
            log.error(f"OmniRoute HTTP error: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            log.error(f"OmniRoute request failed: {e}")
            raise
    
    async def list_models(self, api_key: Optional[str] = None) -> list[dict[str, Any]]:
        """
        List available models from OmniRoute.
        
        Args:
            api_key: OmniRoute API key (optional, can use env var)
        
        Returns:
            List of model dicts with id, name, provider info
        """
        if not self.config.enabled:
            return []
        
        # Get API key from parameter or environment
        if not api_key:
            import os
            api_key = os.environ.get("OMNIROUTE_API_KEY", "")
        
        headers = {
            "Content-Type": "application/json",
        }
        
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        
        try:
            response = await self.client.get(
                f"{self.config.base_url}/models",
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("data", [])
        
        except Exception as e:
            log.error(f"Failed to list OmniRoute models: {e}")
            return []
    
    async def get_free_tier_status(self) -> dict[str, Any]:
        """
        Get current free-tier status and quotas.
        
        Returns:
            Dict with provider status, quotas, and health info
        """
        if not self.config.enabled:
            return {"enabled": False}
        
        try:
            # Try OmniRoute's free-tier status endpoint if available
            response = await self.client.get(
                f"{self.config.base_url}/free-tier/status",
                headers={
                    "Content-Type": "application/json",
                },
            )
            if response.status_code == 200:
                return response.json()
            
            # Fallback: return basic status
            return {
                "enabled": True,
                "base_url": self.config.base_url,
                "model": self.config.model,
                "note": "Free-tier status endpoint not available",
            }
        
        except Exception as e:
            log.error(f"Failed to get free-tier status: {e}")
            return {
                "enabled": True,
                "error": str(e),
            }
    
    async def health_check(self) -> bool:
        """
        Check if OmniRoute is healthy and accessible.
        
        Returns:
            True if healthy, False otherwise
        """
        if not self.config.enabled:
            return False
        
        try:
            response = await self.client.get(
                f"{self.config.base_url}/health",
                timeout=5.0,
            )
            return response.status_code == 200
        except Exception:
            return False


def create_omniroute_client(cfg) -> Optional[OmniRouteClient]:
    """
    Create OmniRoute client from JARVIS config.
    
    Reads omniroute section from config.yaml:
    
    omniroute:
      enabled: true
      base_url: "https://api.omniroute.ai/v1"
      fallback_to_paid: true
      model: "auto"
    
    Returns:
        OmniRouteClient instance or None if not configured
    """
    omniroute_cfg = getattr(cfg, "omniroute", None)
    
    if not omniroute_cfg or not getattr(omniroute_cfg, "enabled", False):
        return None
    
    config = OmniRouteConfig(
        enabled=getattr(omniroute_cfg, "enabled", True),
        base_url=getattr(omniroute_cfg, "base_url", "https://api.omniroute.ai/v1"),
        fallback_to_paid=getattr(omniroute_cfg, "fallback_to_paid", True),
        max_retries=getattr(omniroute_cfg, "max_retries", 3),
        timeout=getattr(omniroute_cfg, "timeout", 30.0),
        model=getattr(omniroute_cfg, "model", "auto"),
    )
    
    return OmniRouteClient(config)
