"""Multi-Key Pool and Rotation Manager for JARVIS.

Inspired by free-claude-code's credential admission, multi-key rotation,
and non-generating credential checks.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

log = logging.getLogger("jarvis.keys")


from enum import StrEnum


class KeyStatus(StrEnum):
    ACTIVE = "active"
    COOLDOWN = "cooldown"
    INVALID = "invalid"


@dataclass
class KeyState:
    key: str
    status: str = "active"  # "active", "cooldown", "invalid"
    cooldown_until: float = 0.0
    failure_count: int = 0
    success_count: int = 0
    last_used: float = 0.0
    last_error: str | None = None

    def is_available(self) -> bool:
        if self.status == KeyStatus.INVALID or self.status == "invalid":
            return False
        if self.status == KeyStatus.COOLDOWN or self.status == "cooldown":
            if time.time() >= self.cooldown_until:
                self.status = "active"
                return True
            return False
        return True


@dataclass
class ProviderKeyPool:
    provider: str
    keys: list[KeyState] = field(default_factory=list)


def mask_key(key: str) -> str:
    """Mask key for safe logging and UI display."""
    if not key:
        return ""
    stripped = key.strip()
    if len(stripped) <= 8:
        return "••••••••"
    # Consistent with _mask_sensitive_value: show first 4 + *** + last 4
    return stripped[:4] + "***" + stripped[-4:]


class KeyManager:
    """Manages pools of API keys per provider, handling rotation and health tracking."""

    def __init__(self, initial_keys: dict[str, list[str] | str] | None = None):
        # provider -> list of KeyState
        self._pools: dict[str, list[KeyState]] = {}
        # provider -> current rotation index
        self._indices: dict[str, int] = {}
        if initial_keys:
            self.load_keys(initial_keys)

    def load_keys(self, keys_map: dict[str, list[str] | str]) -> None:
        """Load keys from config or dict, maintaining existing states when possible."""
        import os
        for provider, raw in keys_map.items():
            provider = provider.lower().strip()
            key_list: list[str] = []
            if isinstance(raw, str):
                cleaned = raw.strip()
                if cleaned:
                    key_list = [cleaned]
            elif isinstance(raw, (list, tuple)):
                key_list = [str(k).strip() for k in raw if str(k).strip()]

            # Resolve any ${VAR} references and expand comma-separated values
            expanded_keys: list[str] = []
            for k in key_list:
                if k.startswith("${") and k.endswith("}"):
                    var_name = k[2:-1].split(":-")[0].strip()
                    val = os.environ.get(var_name, "").strip()
                    if val:
                        for sub_k in val.split(","):
                            sub_clean = sub_k.strip()
                            if sub_clean and not sub_clean.startswith(":::"):
                                expanded_keys.append(sub_clean)
                elif not k.startswith(":::") and not (k.startswith("${") and k.endswith("}")):
                    expanded_keys.append(k)

            # Preserve states if already known
            existing = {ks.key: ks for ks in self._pools.get(provider, [])}
            new_pool: list[KeyState] = []
            seen = set()
            for k in expanded_keys:
                if k in seen:
                    continue
                seen.add(k)
                if k in existing:
                    new_pool.append(existing[k])
                else:
                    new_pool.append(KeyState(key=k))
            self._pools[provider] = new_pool
            if provider not in self._indices:
                self._indices[provider] = 0

    def add_key(self, provider: str, key: str) -> bool:
        """Add a key to provider's pool if not already present."""
        provider = provider.lower().strip()
        key = key.strip()
        if not key:
            return False
        pool = self._pools.setdefault(provider, [])
        if any(ks.key == key for ks in pool):
            return False
        pool.append(KeyState(key=key))
        return True

    def remove_key(self, provider: str, key: str) -> bool:
        """Remove a key from provider's pool."""
        provider = provider.lower().strip()
        key = key.strip()
        pool = self._pools.get(provider, [])
        for i, ks in enumerate(pool):
            if ks.key == key or mask_key(ks.key) == key:
                pool.pop(i)
                return True
        return False

    def get_keys(self, provider: str) -> list[str]:
        """Return all raw keys for a provider."""
        return [ks.key for ks in self._pools.get(provider.lower().strip(), [])]

    def get_masked_keys(self, provider: str) -> list[dict[str, Any]]:
        """Return masked keys with health and stats for UI."""
        provider = provider.lower().strip()
        pool = self._pools.get(provider, [])
        now = time.time()
        result = []
        for ks in pool:
            # Refresh cooldown if expired
            if ks.status == "cooldown" and now >= ks.cooldown_until:
                ks.status = "active"
            result.append({
                "masked": mask_key(ks.key),
                "status": ks.status,
                "cooldown_remaining": max(0, int(ks.cooldown_until - now)) if ks.status == "cooldown" else 0,
                "failures": ks.failure_count,
                "successes": ks.success_count,
                "last_error": ks.last_error,
            })
        return result

    def get_active_key(self, provider: str) -> str | None:
        """Select the next available key for provider using round-robin rotation.
        
        Prioritizes healthy active keys, rotating across available keys.
        """
        provider = provider.lower().strip()
        pool = self._pools.get(provider, [])
        if not pool:
            return None

        now = time.time()
        # Find all available keys
        available_indices = []
        for i, ks in enumerate(pool):
            if ks.is_available():
                available_indices.append(i)

        if not available_indices:
            # All keys are cooling down or invalid. If any in cooldown has shortest remaining time, return it as last resort
            cooldowns = [ks for ks in pool if ks.status == "cooldown"]
            if cooldowns:
                cooldowns.sort(key=lambda x: x.cooldown_until)
                best = cooldowns[0]
                log.warning(f"All keys for {provider} cooling down; choosing shortest cooldown (expires in {int(best.cooldown_until - now)}s)")
                return best.key
            return None

        # Round-robin among available keys
        cur_idx = self._indices.get(provider, 0)
        # Find next index in available_indices >= cur_idx
        chosen_idx = available_indices[0]
        for idx in available_indices:
            if idx >= cur_idx:
                chosen_idx = idx
                break
        self._indices[provider] = (chosen_idx + 1) % len(pool)
        selected = pool[chosen_idx]
        selected.last_used = now
        return selected.key

    def mark_rate_limited(self, provider: str, key: str, cooldown_seconds: float = 60.0, reason: str = "Rate limited (429)") -> str | None:
        """Mark key as cooling down and return the NEXT available key in the pool, or None if none left."""
        provider = provider.lower().strip()
        pool = self._pools.get(provider, [])
        for ks in pool:
            if ks.key == key:
                ks.status = "cooldown"
                ks.cooldown_until = time.time() + cooldown_seconds
                ks.failure_count += 1
                ks.last_error = reason
                log.warning(f"Key {mask_key(key)} for {provider} marked as cooldown for {cooldown_seconds}s. Reason: {reason}")
                break

        # Attempt to get next available key
        next_key = self.get_active_key(provider)
        if next_key and next_key != key:
            log.info(f"Successfully rotated to next key {mask_key(next_key)} for {provider}")
            return next_key
        return None

    def mark_invalid(self, provider: str, key: str, reason: str = "Auth failed (401/403)") -> None:
        """Mark key as permanently invalid."""
        provider = provider.lower().strip()
        for ks in self._pools.get(provider, []):
            if ks.key == key:
                ks.status = "invalid"
                ks.last_error = reason
                log.warning(f"Key {mask_key(key)} for {provider} marked as invalid. Reason: {reason}")
                break

    def mark_success(self, provider: str, key: str) -> None:
        """Record successful invocation for key."""
        provider = provider.lower().strip()
        for ks in self._pools.get(provider, []):
            if ks.key == key:
                ks.status = "active"
                ks.success_count += 1
                ks.failure_count = 0
                ks.last_error = None
                break

    def to_dict(self) -> dict[str, list[str]]:
        """Export raw keys for serialization to config.yaml."""
        return {provider: [ks.key for ks in pool] for provider, pool in self._pools.items() if pool}

    def load_keys_from_vault(self, project_root: Path) -> int:
        """Load additional keys from the secure vault.
        
        Args:
            project_root: Project root directory
            
        Returns:
            Number of keys loaded from vault
        """
        try:
            from .keyring_vault import get_vault
            vault = get_vault(project_root)
            loaded = 0
            
            # Known providers to check
            providers = [
                "groq", "gemini", "openai", "anthropic", "openrouter", "deepseek",
                "mistral", "cerebras", "nvidia", "cohere", "sambanova", "together",
                "huggingface", "genrelay", "omniroute"
            ]
            
            for provider in providers:
                i = 0
                while True:
                    username = f"{provider}_key_{i}"
                    key = vault.get_password("api_keys", username)
                    if key is None:
                        break
                    if self.add_key(provider, key):
                        loaded += 1
                    i += 1
            
            if loaded > 0:
                log.info(f"Loaded {loaded} additional keys from secure vault")
            
            return loaded
        except Exception as e:
            log.warning(f"Failed to load keys from vault: {e}")
            return 0
