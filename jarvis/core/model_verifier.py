"""JARVIS Model Verification & Sanitization Engine.

Concurrently tests candidate models across all providers using real API keys
with automatic rotation. Updates SQLite models.db so only verified working
models are active, with support for purging non-functional models.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import httpx

log = logging.getLogger("jarvis.verifier")

MODEL_DB_PATH = Path("/home/kozer/AI/JARVIS/data/models.db")
VERIFIED_CATALOG_PATH = Path("/home/kozer/AI/JARVIS/data/verified_models.json")
MODEL_CATALOG_PATH = Path("/home/kozer/AI/JARVIS/data/model_catalog.json")

PROVIDER_ENDPOINTS = {
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
    "groq": "https://api.groq.com/openai/v1/chat/completions",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "cerebras": "https://api.cerebras.ai/v1/chat/completions",
    "nvidia": "https://integrate.api.nvidia.com/v1/chat/completions",
    "deepseek": "https://api.deepseek.com/chat/completions",
    "mistral": "https://api.mistral.ai/v1/chat/completions",
    "cohere": "https://api.cohere.ai/compatibility/v1/chat/completions",
    "deepinfra": "https://api.deepinfra.com/v1/openai/chat/completions",
    "genrelay": "https://genrelay.ai/v1/chat/completions",
    "pollinations": "https://text.pollinations.ai/openai/chat/completions",
    "kilo": "https://api.kilo.ai/api/gateway/chat/completions",
    "llm7": "https://api.llm7.io/v1/chat/completions",
}


@dataclass
class VerifyProgress:
    is_running: bool = False
    provider: Optional[str] = None
    total: int = 0
    tested: int = 0
    active: int = 0
    failed: int = 0
    current_model: str = ""
    start_time: float = 0.0
    elapsed_seconds: float = 0.0
    last_message: str = ""


class ModelVerificationEngine:
    def __init__(self, key_manager: Any = None):
        self.key_manager = key_manager
        self.progress = VerifyProgress()
        self._cancel_flag = False
        self._provider_key_index: Dict[str, int] = {}

    def _get_keys_for_provider(self, provider: str) -> List[str]:
        """Fetch all available keys for a provider from KeyManager or config."""
        keys: List[str] = []
        if self.key_manager:
            try:
                keys = self.key_manager.get_keys(provider)
            except Exception:
                pass
        if not keys:
            # Fallback to config.yaml
            try:
                import yaml
                cfg_file = Path("/home/kozer/AI/JARVIS/config.yaml")
                if cfg_file.exists():
                    with open(cfg_file) as f:
                        data = yaml.safe_load(f)
                    pool = data.get("model", {}).get("api_keys_pool", {})
                    raw = pool.get(provider, [])
                    if isinstance(raw, list):
                        keys = [k.strip() for k in raw if isinstance(k, str) and k.strip() and not k.startswith(":")]
                    elif isinstance(raw, str) and raw.strip():
                        keys = [raw.strip()]
            except Exception as e:
                log.warning(f"Failed to read keys for {provider}: {e}")
        return [k for k in keys if k and not k.startswith(":") and "@" not in k and "localhost" not in k]

    def _next_key(self, provider: str) -> Optional[str]:
        keys = self._get_keys_for_provider(provider)
        if not keys:
            return None
        idx = self._provider_key_index.get(provider, 0)
        key = keys[idx % len(keys)]
        self._provider_key_index[provider] = idx + 1
        return key

    async def test_single_model(
        self,
        provider: str,
        model_name: str,
        timeout: float = 12.0,
    ) -> Dict[str, Any]:
        """Test a model with a real minimal chat completion request, rotating keys on 429."""
        ep = PROVIDER_ENDPOINTS.get(provider)
        if not ep:
            return {
                "success": False,
                "provider": provider,
                "model": model_name,
                "error": f"Unsupported provider: {provider}",
                "latency_ms": None,
            }

        keys = self._get_keys_for_provider(provider)
        if not keys and provider not in ("pollinations", "kilo", "llm7"):
            return {
                "success": False,
                "provider": provider,
                "model": model_name,
                "error": f"No active API keys found for {provider}",
                "latency_ms": None,
            }

        max_attempts = min(3, len(keys)) if keys else 1
        last_error = ""
        last_latency = None

        for attempt in range(max_attempts):
            key = self._next_key(provider)
            headers = {"Content-Type": "application/json"}
            if key:
                headers["Authorization"] = f"Bearer {key}"
                if provider == "openrouter":
                    headers["HTTP-Referer"] = "https://jarvis.local"
                    headers["X-Title"] = "JARVIS"

            payload = {
                "model": model_name,
                "messages": [{"role": "user", "content": "1+1="}],
                "max_tokens": 5,
                "temperature": 0.1,
            }

            start = time.time()
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    resp = await client.post(ep, headers=headers, json=payload)
                    latency_ms = round((time.time() - start) * 1000, 1)
                    last_latency = latency_ms

                    if resp.status_code == 200:
                        data = resp.json()
                        choices = data.get("choices", [])
                        content = ""
                        if choices:
                            msg = choices[0].get("message", {})
                            content = msg.get("content", "") or ""
                        return {
                            "success": True,
                            "provider": provider,
                            "model": model_name,
                            "latency_ms": latency_ms,
                            "sample_response": content.strip()[:60],
                            "error": None,
                        }
                    elif resp.status_code == 429 and attempt < max_attempts - 1:
                        # Rotate to next key and retry shortly
                        last_error = f"HTTP 429: Rate limited on key, retrying with next key..."
                        await asyncio.sleep(0.4)
                        continue
                    else:
                        last_error = f"HTTP {resp.status_code}: {resp.text[:140]}"
                        break
            except Exception as exc:
                last_latency = round((time.time() - start) * 1000, 1)
                last_error = str(exc)[:140]
                break

        return {
            "success": False,
            "provider": provider,
            "model": model_name,
            "latency_ms": last_latency,
            "error": last_error,
        }

    async def verify_models_list(
        self,
        candidate_models: List[tuple[str, str]],  # [(provider, model_name), ...]
        concurrency: int = 4,
        on_progress: Optional[Callable[[VerifyProgress], None]] = None,
        only_record_active: bool = False,
    ) -> Dict[str, Any]:
        """Test candidate models concurrently, updating SQLite models.db."""
        self.progress.is_running = True
        self.progress.total = len(candidate_models)
        self.progress.tested = 0
        self.progress.active = 0
        self.progress.failed = 0
        self.progress.start_time = time.time()
        self._cancel_flag = False

        verified_active: List[Dict[str, Any]] = []
        verified_failed: List[Dict[str, Any]] = []

        sem = asyncio.Semaphore(concurrency)

        async def _check(provider: str, model_name: str):
            if self._cancel_flag:
                return
            async with sem:
                self.progress.current_model = f"{provider}/{model_name}"
                res = await self.test_single_model(provider, model_name)

                # Record in database
                self._record_result_in_db(res, only_record_active=only_record_active)

                self.progress.tested += 1
                self.progress.elapsed_seconds = round(time.time() - self.progress.start_time, 1)

                if res["success"]:
                    self.progress.active += 1
                    verified_active.append(res)
                    self.progress.last_message = f"✓ {provider}/{model_name} active ({res['latency_ms']}ms)"
                    log.info(self.progress.last_message)
                else:
                    self.progress.failed += 1
                    verified_failed.append(res)
                    self.progress.last_message = f"✗ {provider}/{model_name} failed: {res.get('error')}"
                    log.debug(self.progress.last_message)

                if on_progress:
                    try:
                        on_progress(self.progress)
                    except Exception:
                        pass

        tasks = [_check(p, m) for p, m in candidate_models]
        await asyncio.gather(*tasks, return_exceptions=True)

        self.progress.is_running = False
        self.progress.elapsed_seconds = round(time.time() - self.progress.start_time, 1)

        # Update JSON catalogs
        self._sync_catalogs_from_db()

        return {
            "total_tested": self.progress.tested,
            "active_count": self.progress.active,
            "failed_count": self.progress.failed,
            "elapsed_seconds": self.progress.elapsed_seconds,
            "active_models": verified_active,
            "failed_models": verified_failed,
        }

    def _record_result_in_db(self, res: Dict[str, Any], only_record_active: bool = False):
        """Update or insert test result into SQLite models.db."""
        MODEL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        provider = res["provider"]
        model_name = res["model"]
        model_key = f"{provider}/{model_name}"
        now = datetime.now().isoformat()
        is_active = res["success"]
        status = "active" if is_active else "unavailable"
        latency = res.get("latency_ms")
        err = res.get("error")

        try:
            conn = sqlite3.connect(MODEL_DB_PATH, timeout=10.0)
            cur = conn.cursor()

            if only_record_active and not is_active:
                # If only_record_active requested, remove from models table if present
                cur.execute("DELETE FROM models WHERE model_key = ?", (model_key,))
            else:
                cur.execute("SELECT id FROM models WHERE model_key = ?", (model_key,))
                row = cur.fetchone()
                if row:
                    model_id = row[0]
                    cur.execute(
                        "UPDATE models SET status = ?, last_tested = ?, last_updated = ? WHERE id = ?",
                        (status, now, now, model_id),
                    )
                else:
                    cur.execute(
                        "INSERT INTO models (provider, model_name, model_key, status, discovered_at, last_tested, last_updated) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (provider, model_name, model_key, status, now, now, now),
                    )
                    model_id = cur.lastrowid

                # Record in test_results
                cur.execute(
                    "INSERT INTO test_results (model_id, test_type, test_result, test_time, latency_ms, error_message) "
                    "VALUES (?, 'inference_ping', ?, ?, ?, ?)",
                    (model_id, "success" if is_active else "failure", now, latency, err),
                )

                if is_active and latency:
                    cur.execute(
                        "INSERT INTO performance (model_id, metric_name, metric_value, metric_unit, measured_at) "
                        "VALUES (?, 'latency_ms', ?, 'ms', ?)",
                        (model_id, latency, now),
                    )

            conn.commit()
            conn.close()
        except Exception as e:
            log.warning(f"DB update failed for {model_key}: {e}")

    def purge_non_working_models(self) -> int:
        """Deletes all models that are NOT marked 'active' from models.db.
        Returns count of purged models.
        """
        try:
            conn = sqlite3.connect(MODEL_DB_PATH, timeout=10.0)
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM models WHERE status != 'active'")
            count = cur.fetchone()[0]
            cur.execute("DELETE FROM models WHERE status != 'active'")
            conn.commit()
            conn.close()
            log.info(f"Purged {count} non-working models from models.db")
            self._sync_catalogs_from_db()
            return count
        except Exception as e:
            log.error(f"Failed to purge models: {e}")
            return 0

    def get_verified_models(self, provider: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns list of all active verified models from models.db with latency."""
        try:
            conn = sqlite3.connect(MODEL_DB_PATH, timeout=10.0)
            cur = conn.cursor()
            query = """
                SELECT m.id, m.provider, m.model_name, m.model_key, m.status, m.last_tested,
                       (SELECT latency_ms FROM test_results WHERE model_id = m.id AND test_result = 'success' ORDER BY id DESC LIMIT 1) as latency
                FROM models m
                WHERE m.status = 'active'
            """
            params = []
            if provider:
                query += " AND m.provider = ?"
                params.append(provider)
            query += " ORDER BY m.provider, m.model_name"
            cur.execute(query, params)
            rows = cur.fetchall()
            conn.close()

            results = []
            for r in rows:
                results.append({
                    "id": r[0],
                    "provider": r[1],
                    "model_name": r[2],
                    "model_key": r[3],
                    "status": r[4],
                    "last_tested": r[5],
                    "latency_ms": r[6],
                })
            return results
        except Exception as e:
            log.error(f"Failed to fetch verified models: {e}")
            return []

    def _sync_catalogs_from_db(self):
        """Generates verified_models.json and updates model_catalog.json."""
        verified = self.get_verified_models()
        by_prov: Dict[str, List[Dict[str, Any]]] = {}
        for m in verified:
            by_prov.setdefault(m["provider"], []).append(m)

        # Write verified_models.json
        payload = {
            "total_verified": len(verified),
            "updated_at": datetime.now().isoformat(),
            "providers_count": len(by_prov),
            "providers": by_prov,
        }
        try:
            with open(VERIFIED_CATALOG_PATH, "w") as f:
                json.dump(payload, f, indent=2)
        except Exception as e:
            log.warning(f"Failed to save verified_models.json: {e}")

        # Update model_catalog.json providers active list
        try:
            if MODEL_CATALOG_PATH.exists():
                with open(MODEL_CATALOG_PATH) as f:
                    cat = json.load(f)
            else:
                cat = {"providers": {}}

            cat["total_models"] = len(verified)
            cat["active_models"] = len(verified)
            cat["verified_at"] = datetime.now().isoformat()

            for prov, models in by_prov.items():
                if prov not in cat.get("providers", {}):
                    cat.setdefault("providers", {})[prov] = {"models": []}
                cat["providers"][prov]["active_count"] = len(models)
                cat["providers"][prov]["verified_models"] = models

            with open(MODEL_CATALOG_PATH, "w") as f:
                json.dump(cat, f, indent=2)
        except Exception as e:
            log.warning(f"Failed to sync model_catalog.json: {e}")

    def stop(self):
        self._cancel_flag = True
        self.progress.is_running = False
