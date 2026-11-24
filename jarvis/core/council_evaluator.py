"""Automated Multi-Provider Model Inspection, Benchmarking, Quota Probing, and Dynamic AI Council Election.

Enables JARVIS to:
1. Discover active providers & candidate models from KeyManager and live /models endpoints.
2. Run micro-benchmarks measuring Latency (ms), Throughput (TPS), and Reasoning Accuracy.
3. Capture HTTP rate-limit and quota headers (x-ratelimit-remaining-*, anthropic-ratelimit-*).
4. Dynamically elect and assign models to AI Council seats based on empirical performance.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import asdict, dataclass
from typing import Any

import httpx

from .brain import LLMBrain
from .council import CouncilMember
from .key_manager import mask_key
from .providers_catalog import PROVIDER_CATALOG, get_provider_spec

log = logging.getLogger("jarvis.council_evaluator")

# Standardized micro-probe prompt testing reasoning + instruction following
BENCHMARK_PROMPT = "Calculate: 19 * 23 + 47. Write FINAL: <number>"
EXPECTED_ANSWER = "484"


@dataclass
class ModelBenchmarkResult:
    provider: str
    model: str
    status: str  # "operational", "rate_limited", "rejected", "unreachable", "error"
    latency_ms: float
    tps: float
    reasoning_score: float  # 1.0 = correct, 0.0 = incorrect
    quota_remaining_requests: str
    quota_remaining_tokens: str
    quota_reset: str
    assigned_seat: str | None = None
    seat_role: str | None = None
    seat_icon: str | None = None
    error_message: str | None = None
    timestamp: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# Default candidate models per provider to test when discovering
CANDIDATE_MODELS: dict[str, list[str]] = {
    "gemini": [
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
    ],
    "groq": [
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "qwen-qwq-32b",
    ],
    "deepseek": [
        "deepseek-chat",
        "deepseek-reasoner",
    ],
    "openrouter": [
        "meta-llama/llama-3.3-70b-instruct",
        "anthropic/claude-3.5-sonnet",
        "deepseek/deepseek-r1",
    ],
    "openai": [
        "gpt-4o-mini",
        "gpt-4o",
        "o3-mini",
    ],
    "anthropic": [
        "claude-3-5-sonnet-20241022",
        "claude-3-5-haiku-20241022",
    ],
    "mistral": [
        "mistral-small-latest",
        "codestral-latest",
    ],
    "cerebras": [
        "llama-3.3-70b",
        "llama3.1-8b",
    ],
    "nvidia": [
        "meta/llama-3.3-70b-instruct",
    ],
    "openai_compatible": [
        "default",
    ],
}


class CouncilEvaluator:
    """Probes providers, benchmarks performance, and elects the optimal AI Council."""

    def __init__(self, brain: LLMBrain):
        self.brain = brain
        self.last_results: list[ModelBenchmarkResult] = []
        self.last_elected_council: list[CouncilMember] = []

    async def probe_model(
        self,
        provider: str,
        model: str,
        api_key: str,
        endpoint: str | None = None,
        timeout: float = 12.0,
    ) -> ModelBenchmarkResult:
        """Benchmark a single model's latency, speed, accuracy, and quota status."""
        spec = get_provider_spec(provider)
        base_url = (endpoint or (spec.default_base_url if spec else "http://localhost:11434/v1")).rstrip("/")
        
        url = f"{base_url}/chat/completions"
        headers: dict[str, str] = {
            "Content-Type": "application/json",
            "User-Agent": "JARVIS-CouncilEvaluator/1.0",
        }
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        if "openrouter.ai" in base_url:
            headers["HTTP-Referer"] = "http://localhost:7341"
            headers["X-Title"] = "JARVIS_Council"

        payload: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "user", "content": BENCHMARK_PROMPT},
            ],
            "max_tokens": 200,
            "temperature": 0.0,
        }

        # Special handling for Anthropic API protocol
        if provider == "anthropic" or (spec and spec.protocol == "anthropic"):
            url = f"{base_url}/v1/messages"
            headers = {
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            }
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": BENCHMARK_PROMPT}],
                "max_tokens": 200,
                "temperature": 0.0,
            }

        t0 = time.perf_counter()
        remaining_req = "Unknown"
        remaining_tok = "Unknown"
        reset_time = "Unknown"

        try:
            async with httpx.AsyncClient(timeout=timeout, trust_env=True) as client:
                resp = await client.post(url, json=payload, headers=headers)
            t1 = time.perf_counter()
            latency_ms = round((t1 - t0) * 1000, 1)

            # Extract quota & rate limit headers
            for k, v in resp.headers.items():
                k_low = k.lower()
                if "ratelimit-remaining-requests" in k_low or "ratelimit-requests-remaining" in k_low:
                    remaining_req = str(v)
                elif "ratelimit-remaining-tokens" in k_low or "ratelimit-tokens-remaining" in k_low:
                    remaining_tok = str(v)
                elif "ratelimit-reset" in k_low:
                    reset_time = str(v)

            if resp.status_code == 200:
                data = resp.json()
                if provider == "anthropic" or (spec and spec.protocol == "anthropic"):
                    content_blocks = data.get("content", [])
                    raw_text = "".join(b.get("text", "") for b in content_blocks if b.get("type") == "text")
                    usage = data.get("usage", {})
                    out_tokens = usage.get("output_tokens", max(1, len(raw_text.split())))
                else:
                    choices = data.get("choices", [{}])
                    raw_text = (choices[0].get("message", {}).get("content") or "") if choices else ""
                    usage = data.get("usage", {})
                    out_tokens = usage.get("completion_tokens", max(1, len(raw_text.split())))

                duration = max(t1 - t0, 0.001)
                tps = round(out_tokens / duration, 1)
                reasoning_score = 1.0 if EXPECTED_ANSWER in raw_text else 0.5 if "484" in raw_text else 0.0

                return ModelBenchmarkResult(
                    provider=provider,
                    model=model,
                    status="operational",
                    latency_ms=latency_ms,
                    tps=tps,
                    reasoning_score=reasoning_score,
                    quota_remaining_requests=remaining_req,
                    quota_remaining_tokens=remaining_tok,
                    quota_reset=reset_time,
                    timestamp=time.time(),
                )

            elif resp.status_code == 429:
                err_text = resp.text[:200]
                return ModelBenchmarkResult(
                    provider=provider,
                    model=model,
                    status="rate_limited",
                    latency_ms=latency_ms,
                    tps=0.0,
                    reasoning_score=0.0,
                    quota_remaining_requests="0 (Exceeded)",
                    quota_remaining_tokens="0 (Exceeded)",
                    quota_reset=reset_time,
                    error_message=f"HTTP 429 Rate Limit: {err_text}",
                    timestamp=time.time(),
                )

            elif resp.status_code in (401, 403):
                return ModelBenchmarkResult(
                    provider=provider,
                    model=model,
                    status="rejected",
                    latency_ms=latency_ms,
                    tps=0.0,
                    reasoning_score=0.0,
                    quota_remaining_requests="Denied",
                    quota_remaining_tokens="Denied",
                    quota_reset="N/A",
                    error_message=f"Auth Failed ({resp.status_code}): {resp.text[:120]}",
                    timestamp=time.time(),
                )

            else:
                return ModelBenchmarkResult(
                    provider=provider,
                    model=model,
                    status="error",
                    latency_ms=latency_ms,
                    tps=0.0,
                    reasoning_score=0.0,
                    quota_remaining_requests="Error",
                    quota_remaining_tokens="Error",
                    quota_reset="N/A",
                    error_message=f"HTTP {resp.status_code}: {resp.text[:120]}",
                    timestamp=time.time(),
                )

        except (httpx.ConnectError, httpx.NetworkError) as ce:
            return ModelBenchmarkResult(
                provider=provider,
                model=model,
                status="unreachable",
                latency_ms=0.0,
                tps=0.0,
                reasoning_score=0.0,
                quota_remaining_requests="Offline",
                quota_remaining_tokens="Offline",
                quota_reset="N/A",
                error_message="Connection refused / offline",
                timestamp=time.time(),
            )
        except httpx.TimeoutException:
            return ModelBenchmarkResult(
                provider=provider,
                model=model,
                status="unreachable",
                latency_ms=timeout * 1000,
                tps=0.0,
                reasoning_score=0.0,
                quota_remaining_requests="Timeout",
                quota_remaining_tokens="Timeout",
                quota_reset="N/A",
                error_message=f"Timeout after {timeout}s",
                timestamp=time.time(),
            )
        except Exception as e:
            return ModelBenchmarkResult(
                provider=provider,
                model=model,
                status="error",
                latency_ms=0.0,
                tps=0.0,
                reasoning_score=0.0,
                quota_remaining_requests="Error",
                quota_remaining_tokens="Error",
                quota_reset="N/A",
                error_message=str(e)[:120],
                timestamp=time.time(),
            )

    async def _fetch_live_models(
        self,
        provider: str,
        api_key: str,
        timeout: float = 10.0,
    ) -> list[str]:
        """Fetch real live model IDs from the provider's /models endpoint.

        Returns a deduplicated list of chat-capable model IDs, or an empty list
        if the fetch fails (caller should fall back to _STATIC_MODELS).
        """
        from jarvis.server.routes import _PROVIDER_MODELS_URL  # avoid circular at module level

        models_url = _PROVIDER_MODELS_URL.get(provider)
        if not models_url:
            return []

        headers: dict[str, str] = {"User-Agent": "JARVIS-CouncilEvaluator/1.0"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        # Anthropic uses a different auth header
        if provider == "anthropic":
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "User-Agent": "JARVIS-CouncilEvaluator/1.0",
            }

        try:
            async with httpx.AsyncClient(timeout=timeout, trust_env=True) as client:
                resp = await client.get(models_url, headers=headers)
            if resp.status_code != 200:
                log.warning("[%s] /models returned HTTP %d", provider, resp.status_code)
                return []
            data = resp.json()
            # OpenAI-compatible: {"data": [{"id": "...", "object": "model"}]}
            items = data.get("data") or data.get("models") or []
            if not isinstance(items, list):
                return []

            # Collect IDs — filter out obvious non-chat models
            _SKIP_KEYWORDS = (
                "embed", "embedding", "whisper", "tts", "transcribe",
                "vision-only", "image", "dall-e", "audio", "search",
                "instruct-lite",  # keep instruct but skip lite variants if needed
            )
            model_ids: list[str] = []
            for item in items:
                if isinstance(item, dict):
                    mid = item.get("id") or item.get("name") or ""
                elif isinstance(item, str):
                    mid = item
                else:
                    continue
                mid = str(mid).strip()
                if not mid:
                    continue
                ml = mid.lower()
                if any(kw in ml for kw in _SKIP_KEYWORDS):
                    continue
                model_ids.append(mid)

            log.info("[%s] Live models fetched: %d models", provider, len(model_ids))
            return model_ids

        except Exception as exc:
            log.warning("[%s] Failed to fetch live models: %s", provider, exc)
            return []

    async def benchmark_all_candidates(self) -> list[ModelBenchmarkResult]:
        """Discover configured providers, fetch their REAL live models, then benchmark in parallel."""
        from jarvis.server.routes import _STATIC_MODELS  # avoid circular at module level

        tasks: list = []
        configured_providers: set[str] = set()

        # Find all providers with active API keys
        for prov_id in PROVIDER_CATALOG.keys():
            keys = self.brain.key_manager.get_keys(prov_id)
            active_key = self.brain.key_manager.get_active_key(prov_id)
            if active_key or (keys and len(keys) > 0):
                configured_providers.add(prov_id)

        # Always include the primary brain provider
        configured_providers.add(self.brain.mc.provider)

        log.info("Benchmarking real live models from providers: %s", configured_providers)

        for prov_id in configured_providers:
            keys = self.brain.key_manager.get_keys(prov_id)
            active_key = self.brain.key_manager.get_active_key(prov_id) or (keys[0] if keys else "")

            # Step 1: Fetch REAL live models from the provider's API
            live_models = await self._fetch_live_models(prov_id, active_key)

            # Step 2: Fallback to static list if live fetch failed or returned nothing
            if not live_models:
                live_models = _STATIC_MODELS.get(prov_id, [])
                if live_models:
                    log.info("[%s] Using static fallback (%d models)", prov_id, len(live_models))
                else:
                    # Last resort: use the brain's current model for this provider
                    live_models = [self.brain.mc.model]

            # Step 3: Cap to top-N models per provider to keep benchmark fast
            #  - Prefer suggested models if available, otherwise take first N from live list
            spec = get_provider_spec(prov_id)
            if spec and spec.suggested_models:
                # Pick suggested models that actually exist in the live list
                candidates = [m for m in spec.suggested_models if m in live_models]
                # If none of the suggested are in live list, take first 4 live models
                if not candidates:
                    candidates = live_models[:4]
            else:
                candidates = live_models[:4]

            log.info("[%s] Will benchmark %d candidates: %s", prov_id, len(candidates), candidates)

            for model in candidates:
                tasks.append(self.probe_model(prov_id, model, active_key))

        if not tasks:
            log.warning("No benchmark tasks assembled — no configured providers found.")
            return []

        results: list[ModelBenchmarkResult] = await asyncio.gather(*tasks, return_exceptions=False)
        self.last_results = results
        return results

    def elect_council(self, benchmark_results: list[ModelBenchmarkResult]) -> list[CouncilMember]:
        """Elect dynamic council members matching frontier roles from benchmarked candidates."""
        operational = [r for r in benchmark_results if r.status == "operational"]
        if not operational:
            log.warning("No operational models found during council election. Falling back to default brain model.")
            default_member = CouncilMember(
                id="default_fallback",
                name="JARVIS Primary Brain",
                provider=self.brain.mc.provider,
                model=self.brain.mc.model,
                icon="🤖",
                role="الرئيس التنفيذي والمستشار الشامل",
                specialty="النموذج النشط الأساسي في النظام",
                system_prompt="أنت ممثل الذكاء الأساسي في مجلس J.A.R.V.I.S.",
            )
            self.last_elected_council = [default_member]
            return [default_member]

        elected: list[CouncilMember] = []

        # Sort operational models by speed (TPS desc, latency asc)
        by_speed = sorted(operational, key=lambda r: (r.tps, -r.latency_ms), reverse=True)
        # Sort by reasoning score and context capability
        by_reasoning = sorted(operational, key=lambda r: (r.reasoning_score, -r.latency_ms), reverse=True)

        assigned_models: set[str] = set()

        # 1. SEAT 1: Fast Proposer (أسرع نموذج استجابة واقتراح أولي)
        fastest = by_speed[0]
        fastest.assigned_seat = "Seat 1: Speed & Fast Proposer"
        fastest.seat_role = "المستشار السريع ومقترح الحلول الفوري"
        fastest.seat_icon = "⚡"
        assigned_models.add(f"{fastest.provider}:{fastest.model}")
        elected.append(
            CouncilMember(
                id=f"council_{fastest.provider}_{fastest.model.replace('-', '_').replace('.', '_')}",
                name=f"{fastest.model} ({fastest.provider.capitalize()})",
                provider=fastest.provider,
                model=fastest.model,
                icon="⚡",
                role="المستشار السريع ومقترح الحلول الفوري",
                specialty=f"أعلى سرعة استجابة ({fastest.latency_ms}ms, {fastest.tps} tps)",
                system_prompt=(
                    f"أنت عضو مقعد السرعة الفائقة في مجلس الذكاء الاصطناعي (تم انتخابك لتحقيق سرعة {fastest.tps} tps). "
                    "دورك: تقديم مقترحات أولية مباشرة وحلول برمجية سريعة قابلة للتطبيق الفوري دون تعقيد."
                ),
            )
        )

        # 2. SEAT 2: Deep Reasoner & Architect (كبير مستشاري الاستدلال والمنطق العميق)
        reasoners = [r for r in by_reasoning if f"{r.provider}:{r.model}" not in assigned_models]
        architect = reasoners[0] if reasoners else operational[0]
        architect.assigned_seat = "Seat 2: Deep Reasoner & Architect"
        architect.seat_role = "كبير مستشاري الاستدلال العميق والمعمارية"
        architect.seat_icon = "🔮"
        assigned_models.add(f"{architect.provider}:{architect.model}")
        elected.append(
            CouncilMember(
                id=f"council_{architect.provider}_{architect.model.replace('-', '_').replace('.', '_')}",
                name=f"{architect.model} ({architect.provider.capitalize()})",
                provider=architect.provider,
                model=architect.model,
                icon="🔮",
                role="كبير مستشاري الاستدلال العميق والمعمارية",
                specialty=f"التحليل المنطقي العميق (دقة استدلال {int(architect.reasoning_score * 100)}%)",
                system_prompt=(
                    "أنت كبير مستشاري الاستدلال والمنطق المعماري في مجلس الذكاء الاصطناعي. "
                    "دورك: تفكيك المسألة برصانة منطقية، فحص القيود المعمارية، وتقديم نقد هندسي عميق ومتزن."
                ),
            )
        )

        # 3. SEAT 3: Software & Code Engineer (مهندس البرمجيات والخوارزميات)
        code_candidates = [
            r for r in operational
            if f"{r.provider}:{r.model}" not in assigned_models
            and any(kw in r.model.lower() for kw in ("flash", "code", "chat", "pro", "sonnet"))
        ]
        coder = code_candidates[0] if code_candidates else (
            [r for r in operational if f"{r.provider}:{r.model}" not in assigned_models] or [operational[0]]
        )[0]
        coder.assigned_seat = "Seat 3: Software & Algorithm Engineer"
        coder.seat_role = "كبير مهندسي البرمجيات والخوارزميات"
        coder.seat_icon = "💻"
        assigned_models.add(f"{coder.provider}:{coder.model}")
        elected.append(
            CouncilMember(
                id=f"council_{coder.provider}_{coder.model.replace('-', '_').replace('.', '_')}",
                name=f"{coder.model} ({coder.provider.capitalize()})",
                provider=coder.provider,
                model=coder.model,
                icon="💻",
                role="كبير مهندسي البرمجيات والخوارزميات",
                specialty="جودة الشيفرة، معالجة حالات الحافة، وحساب التعقيد الحسابي O(n)",
                system_prompt=(
                    "أنت كبير مهندسي البرمجيات في مجلس الذكاء الاصطناعي. "
                    "دورك: فحص الجوانب البرمجية المباشرة، متانة الشيفرة، ومعالجة حالات الخطأ وحالات الحافة."
                ),
            )
        )

        # 4. SEAT 4: Skeptic & Fact Verifier (المدقق المعماري الصارم وخبير الأمان)
        skeptic_candidates = [
            r for r in operational
            if f"{r.provider}:{r.model}" not in assigned_models
        ]
        if skeptic_candidates:
            skeptic = skeptic_candidates[0]
            skeptic.assigned_seat = "Seat 4: Skeptic & Fact Verifier"
            skeptic.seat_role = "المدقق الصارم وخبير الأمان والتحقق"
            skeptic.seat_icon = "🛡️"
            elected.append(
                CouncilMember(
                    id=f"council_{skeptic.provider}_{skeptic.model.replace('-', '_').replace('.', '_')}",
                    name=f"{skeptic.model} ({skeptic.provider.capitalize()})",
                    provider=skeptic.provider,
                    model=skeptic.model,
                    icon="🛡️",
                    role="المدقق الصارم وخبير الأمان والتحقق",
                    specialty="كشف الهلوسات والافتراضات الخاطئة وضمان الأمان",
                    system_prompt=(
                        "أنت المدقق الصارم وخبير الأمان في مجلس الذكاء الاصطناعي. "
                        "دورك: مراجعة كافة الآراء بعين الشك والتدقيق، فحص الأمان وخلو الحلول من الهلوسات."
                    ),
                )
            )

        self.last_elected_council = elected
        log.info("AI Council dynamically elected with %d members.", len(elected))
        return elected
