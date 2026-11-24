"""OS Keyring Integration for Secure Credential Storage.

Provides secure storage of API keys, tokens, and secrets using the OS keyring:
- Linux: libsecret (GNOME Keyring, KWallet)
- macOS: Keychain
- Windows: Credential Manager

Falls back to encrypted file storage if keyring unavailable.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import threading
from pathlib import Path
from typing import Any, Optional

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

log = logging.getLogger("jarvis.keyring_vault")

# ─── Constants ───
SERVICE_NAME = "JARVIS"
VAULT_FILE = "data/vault.enc"
KEY_FILE = "data/vault.key"
SALT_FILE = "data/vault.salt"

# ─── Keyring Availability Check ───
_KEYRING_AVAILABLE = False
_KEYRING_ERROR = None

try:
    import keyring
    import keyring.errors
    _KEYRING_AVAILABLE = True
except ImportError as e:
    _KEYRING_ERROR = f"keyring not installed: {e}"
except Exception as e:
    _KEYRING_ERROR = f"keyring initialization failed: {e}"


def is_keyring_available() -> tuple[bool, str]:
    """Check if OS keyring is available."""
    if _KEYRING_AVAILABLE:
        try:
            # Test basic operation
            keyring.set_password(SERVICE_NAME, "_test_", "test")
            keyring.delete_password(SERVICE_NAME, "_test_")
            return True, "OK"
        except Exception as e:
            return False, f"Keyring test failed: {e}"
    return False, _KEYRING_ERROR or "Keyring not available"


# ─── Encrypted File Fallback ───
class EncryptedVault:
    """Encrypted file-based vault for when keyring is unavailable."""
    
    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.vault_path = project_root / VAULT_FILE
        self.key_path = project_root / KEY_FILE
        self.salt_path = project_root / SALT_FILE
        self._fernet: Optional[Fernet] = None
        self._lock = threading.Lock()
        self._ensure_initialized()
    
    def _ensure_initialized(self) -> None:
        """Initialize or load encryption key."""
        with self._lock:
            if self._fernet is not None:
                return
            
            # Create directory
            self.vault_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Load or generate salt
            if self.salt_path.exists():
                salt = self.salt_path.read_bytes()
            else:
                salt = os.urandom(16)
                self.salt_path.write_bytes(salt)
                self.salt_path.chmod(0o600)
            
            # Load or generate key
            if self.key_path.exists():
                key_data = self.key_path.read_bytes()
            else:
                # Derive key from a passphrase (in production, use a proper passphrase)
                # For local-only use, we derive from machine ID + user
                import getpass
                import platform
                machine_id = f"{platform.node()}-{getpass.getuser()}-JARVIS".encode()
                kdf = PBKDF2HMAC(
                    algorithm=hashes.SHA256(),
                    length=32,
                    salt=salt,
                    iterations=100000,
                )
                key_data = base64.urlsafe_b64encode(kdf.derive(machine_id))
                self.key_path.write_bytes(key_data)
                self.key_path.chmod(0o600)
            
            self._fernet = Fernet(key_data)
    
    def _load_vault(self) -> dict:
        """Load and decrypt vault."""
        if not self.vault_path.exists():
            return {}
        try:
            encrypted = self.vault_path.read_bytes()
            decrypted = self._fernet.decrypt(encrypted)
            return json.loads(decrypted.decode())
        except Exception as e:
            log.error(f"Failed to load vault: {e}")
            return {}
    
    def _save_vault(self, data: dict) -> None:
        """Encrypt and save vault."""
        try:
            encrypted = self._fernet.encrypt(json.dumps(data).encode())
            # Atomic write
            temp_path = self.vault_path.with_suffix(".tmp")
            temp_path.write_bytes(encrypted)
            temp_path.replace(self.vault_path)
            self.vault_path.chmod(0o600)
        except Exception as e:
            log.error(f"Failed to save vault: {e}")
            raise
    
    def set_password(self, username: str, password: str) -> bool:
        """Store a credential."""
        try:
            vault = self._load_vault()
            vault[username] = password
            self._save_vault(vault)
            return True
        except Exception:
            return False
    
    def get_password(self, username: str) -> Optional[str]:
        """Retrieve a credential."""
        try:
            vault = self._load_vault()
            return vault.get(username)
        except Exception:
            return None
    
    def delete_password(self, username: str) -> bool:
        """Delete a credential."""
        try:
            vault = self._load_vault()
            if username in vault:
                del vault[username]
                self._save_vault(vault)
                return True
            return False
        except Exception:
            return False
    
    def list_credentials(self) -> list[str]:
        """List all stored credential keys."""
        try:
            vault = self._load_vault()
            return list(vault.keys())
        except Exception:
            return []


# ─── Unified Vault Interface ───
class KeyringVault:
    """Unified interface for credential storage using keyring or encrypted file fallback."""
    
    def __init__(self, project_root: Path):
        self.project_root = project_root
        self._encrypted_vault = EncryptedVault(project_root)
        self._use_keyring, self._keyring_status = is_keyring_available()
        
        if self._use_keyring:
            log.info("Using OS keyring for credential storage")
        else:
            log.warning(f"OS keyring unavailable ({self._keyring_status}), using encrypted file fallback")
    
    def set_password(self, service: str, username: str, password: str) -> bool:
        """Store a credential."""
        key = f"{service}:{username}"
        
        if self._use_keyring:
            try:
                import keyring
                keyring.set_password(service, username, password)
                # Keep index in encrypted vault for enumeration
                self._encrypted_vault.set_password(key, password)
                return True
            except Exception as e:
                log.error(f"Keyring set_password failed: {e}, falling back to encrypted file")
                return self._encrypted_vault.set_password(key, password)
        else:
            return self._encrypted_vault.set_password(key, password)
    
    def get_password(self, service: str, username: str) -> Optional[str]:
        """Retrieve a credential."""
        key = f"{service}:{username}"
        
        if self._use_keyring:
            try:
                import keyring
                val = keyring.get_password(service, username)
                if val is not None:
                    return val
                return self._encrypted_vault.get_password(key)
            except Exception as e:
                log.error(f"Keyring get_password failed: {e}, trying encrypted file")
                return self._encrypted_vault.get_password(key)
        else:
            return self._encrypted_vault.get_password(key)
    
    def delete_password(self, service: str, username: str) -> bool:
        """Delete a credential."""
        key = f"{service}:{username}"
        
        deleted = False
        if self._use_keyring:
            try:
                import keyring
                keyring.delete_password(service, username)
                deleted = True
            except (keyring.errors.PasswordDeleteError, Exception) as e:
                log.debug(f"Keyring delete_password: {e}")
        
        enc_deleted = self._encrypted_vault.delete_password(key)
        return deleted or enc_deleted
    
    def list_credentials(self, service: str = "") -> list[tuple[str, str]]:
        """List all credentials for a service."""
        keys = self._encrypted_vault.list_credentials()
        results = []
        for k in keys:
            if ":" in k:
                svc, user = k.split(":", 1)
            else:
                svc, user = "general", k
            if not service or svc == service:
                results.append((svc, user))
        return results
    
    def migrate_from_config(self, config_dict: dict) -> int:
        """Migrate API keys from config.yaml to vault.
        
        Args:
            config_dict: The config.yaml data with api_keys_pool
            
        Returns:
            Number of keys migrated
        """
        migrated = 0
        api_keys_pool = config_dict.get("model", {}).get("api_keys_pool", {})
        
        for provider, keys in api_keys_pool.items():
            if isinstance(keys, list):
                for i, key in enumerate(keys):
                    if key and key.strip():
                        username = f"{provider}_key_{i}"
                        if self.set_password("api_keys", username, key.strip()):
                            migrated += 1
            elif isinstance(keys, str) and keys.strip():
                username = f"{provider}_key_0"
                if self.set_password("api_keys", username, keys.strip()):
                    migrated += 1
        
        # Also migrate integration secrets
        integrations = config_dict.get("integrations", {})
        for platform, config in integrations.items():
            if isinstance(config, dict):
                for field_name, value in config.items():
                    if any(secret in field_name.lower() for secret in ["token", "secret", "key", "password"]):
                        if value and str(value).strip():
                            username = f"{platform}_{field_name}"
                            self.set_password("integrations", username, str(value).strip())
                            migrated += 1
        
        return migrated


# ─── Global Instance ───
_vault_instance: Optional[KeyringVault] = None


def get_vault(project_root: Path = None) -> KeyringVault:
    """Get global vault instance."""
    global _vault_instance
    if _vault_instance is None:
        if project_root is None:
            project_root = Path(__file__).resolve().parent.parent.parent
        _vault_instance = KeyringVault(project_root)
    return _vault_instance


# ─── Integration with KeyManager ───
def enhance_key_manager_with_vault(key_manager, vault: KeyringVault) -> None:
    """Enhance KeyManager to load keys from vault on startup."""
    # This would be called during initialization
    # For now, we add a method to load keys from vault
    original_load_keys = key_manager.load_keys
    
    def load_keys_with_vault(keys_map: dict[str, list[str] | str]) -> None:
        # First load from config
        original_load_keys(keys_map)
        
        # Then supplement from vault
        # Vault stores keys as "provider_key_N"
        for provider in ["groq", "gemini", "openai", "anthropic", "openrouter", "deepseek", 
                         "mistral", "cerebras", "nvidia", "cohere", "sambanova", "together",
                         "huggingface", "genrelay"]:
            i = 0
            while True:
                username = f"{provider}_key_{i}"
                key = vault.get_password("api_keys", username)
                if key is None:
                    break
                key_manager.add_key(provider, key)
                i += 1
    
    key_manager.load_keys = load_keys_with_vault