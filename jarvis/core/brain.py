"""LLM brain.

Supports two providers, both via httpx:
  - "anthropic"           : POST <endpoint>/v1/messages
  - "openai_compatible"   : POST <endpoint>/chat/completions   (LM Studio, Ollama, vLLM, OpenAI)

Two tool-calling strategies:
  - native_tool_calls=True  : use the provider's tool / function-calling API
  - native_tool_calls=False : ReAct-style XML tags in plain text (works with any model)

The orchestrator does NOT see the difference — both paths return a list of
`ToolCall` objects (possibly empty) plus a final text reply.

Resilience (merged from audit/fixes, layered ON TOP of the Phase 2-4
retry logic — the dispatch methods below are unchanged apart from an
optional per-attempt ``api_key`` override):
  - Multi-key rotation: :class:`KeyManager` pools keys per provider
    (config ``model.api_keys_pool`` + provider env vars). On HTTP 429
    the key is cooled down and the next key is tried; on 401/403 the
    key is marked invalid.
  - Provider failover cascade: :meth:`LLMBrain.get_cascade_tiers`
    builds Tier 0 (configured primary) → Tier 1 (fastest verified
    cloud model from ``data/models.db``, when it exists) → Tier 2
    (configured fallback provider/model) → Tier 3 (OmniRoute/9Router
    local aggregator). A tier is skipped while offline unless it is
    local. Non-transient 4xx errors (400/404/422, …) do NOT cascade —
    the primary's answer is returned immediately, preserving the
    Phase 4 retry tests' "1 call on HTTP 400" contract.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Callable
from urllib.parse import urlparse

import httpx

from ..config import Config
from .key_manager import KeyManager, mask_key
from .providers_catalog import get_provider_spec

log = logging.getLogger("jarvis.brain")

# Phase 4 — error recovery: transient LLM failures (connection errors,
# timeouts, HTTP 429 / 5xx) are retried with exponential backoff instead
# of failing the turn on the first blip. Non-transient 4xx errors are
# returned immediately. Tests monkeypatch LLM_RETRY_BASE_S to 0.
LLM_MAX_ATTEMPTS = 3
LLM_RETRY_BASE_S = 0.5


def _is_transient_llm_error(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code if exc.response is not None else 0
        return code == 429 or code >= 500
    return isinstance(exc, (httpx.TransportError, httpx.TimeoutException))


async def _retry_sleep(attempt: int) -> None:
    await asyncio.sleep(LLM_RETRY_BASE_S * (2 ** attempt))


TOOL_CALL_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.DOTALL)
XML_TOOL_RE = re.compile(
    r"<(?P<name>[a-zA-Z_][\w-]*)>\s*(?P<body>.*?)\s*</(?P=name)>",
    re.DOTALL,
)
THOUGHT_RE = re.compile(r"<thinking>.*?</thinking>", re.DOTALL | re.IGNORECASE)
_BRAIN_ERROR_STATUS_RE = re.compile(r"\[brain error\] HTTP (\d+)")


def _brain_error_status(reply: "BrainReply") -> int | None:
    """HTTP status parsed from a ``[brain error] HTTP <code>`` reply, or
    None for timeouts / connection errors / other failures."""
    m = _BRAIN_ERROR_STATUS_RE.search(reply.text or "")
    return int(m.group(1)) if m else None


def _is_local_endpoint(endpoint: str) -> bool:
    """True for localhost / loopback endpoints (Ollama, LM Studio,
    OmniRoute proxy). Such tiers stay reachable when the internet
    probe reports offline."""
    try:
        host = (urlparse(endpoint or "").hostname or "").lower()
    except Exception:
        return False
    return host in {"localhost", "127.0.0.1", "::1"}


@dataclass
class CascadeTier:
    """A prioritized tier in the adaptive failover cascade."""
    name: str
    provider: str
    endpoint: str
    model: str
    is_local: bool = False
    timeout: float = 14.0
    ttft_timeout: float = 5.0


@dataclass
class ToolCall:
    name: str
    args: dict[str, Any]
    raw: str = ""              # original text (for logging)
    call_id: str | None = None # provider id when native
    extra_content: dict[str, Any] | None = None  # Gemini thought_signature / vendor extensions


@dataclass
class BrainReply:
    text: str                       # cleaned final text (no tool tags)
    tool_calls: list[ToolCall] = field(default_factory=list)
    raw: str = ""                   # untouched assistant message
    finish_reason: str | None = None


REACT_INSTRUCTIONS = """\
You have access to tools. To call a tool, output a single block:

<tool_call>
{"name": "<tool_name>", "args": {<json-args>}}
</tool_call>

Never invent tags like <web_search> or <shell_command>. The only valid tool
syntax is the JSON <tool_call> block above.

After you receive the tool result (as a user message), you may call another
tool or write a final reply to the user. Do NOT wrap your final reply in
<tool_call>. Only emit one tool_call per turn. Think briefly inside
<thinking>...</thinking> if you need to plan; that block will be hidden
from the user. Keep replies short and concrete.
"""


class LLMBrain:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.mc = cfg.model
        self._client = httpx.AsyncClient(timeout=self.mc.request_timeout_seconds)
        # Multi-key rotation (audit/fixes). Keys come from config
        # model.api_keys_pool, then _sync_env_keys() below, then the
        # secure vault when keyring_vault is available (guarded inside
        # KeyManager — returns 0 when the vault module is absent).
        self.key_manager = KeyManager(getattr(self.mc, "api_keys_pool", None) or {})
        self._sync_env_keys()
        try:
            self.key_manager.load_keys_from_vault(cfg.project_root)
        except Exception as e:  # noqa: BLE001 — vault is best-effort
            log.warning("Failed to load keys from vault: %s", e)
        self._last_probe_time: float = 0.0
        self._last_probe_result: bool = True

    def _sync_env_keys(self) -> None:
        """Populate KeyManager from provider env vars + legacy api_key.

        Deliberate deviation from audit/fixes: the audit version also
        read ``~/.fcc/.env`` directly. That path is specific to one
        machine's tooling and is not part of this repo; env vars and
        ``model.api_keys_pool`` cover the same keys portably.
        """
        def _parse_keys_val(raw_val: str) -> list[str]:
            v = str(raw_val).strip()
            if not v:
                return []
            try:
                decoded = json.loads(v)
                if isinstance(decoded, str):
                    decoded = json.loads(decoded)
                if isinstance(decoded, list):
                    return [str(x).strip() for x in decoded if str(x).strip()]
                if isinstance(decoded, str) and decoded.strip():
                    return [decoded.strip()]
            except Exception:
                pass
            v_clean = v.strip("\"'")
            try:
                decoded = json.loads(v_clean)
                if isinstance(decoded, list):
                    return [str(x).strip() for x in decoded if str(x).strip()]
            except Exception:
                pass
            if "," in v_clean:
                return [x.strip() for x in v_clean.split(",") if x.strip()]
            return [v_clean]

        _ALT_ENVS = {
            "nvidia": ["NVIDIA_NIM_API_KEY", "NVIDIA_API_KEY"],
            "gemini": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
            "anthropic": ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
            "cerebras": ["CEREBRAS_API_KEY"],
            "sambanova": ["SAMBANOVA_API_KEY"],
            "cohere": ["COHERE_API_KEY"],
            "mistral": ["MISTRAL_API_KEY", "CODESTRAL_API_KEY"],
            "together": ["TOGETHER_API_KEY"],
            "deepseek": ["DEEPSEEK_API_KEY"],
            "groq": ["GROQ_API_KEY"],
            "openrouter": ["OPENROUTER_API_KEY"],
        }
        from .providers_catalog import PROVIDER_CATALOG

        for prov, spec in PROVIDER_CATALOG.items():
            candidate_envs = list(_ALT_ENVS.get(prov, []))
            if spec.credential_env and spec.credential_env not in candidate_envs:
                candidate_envs.append(spec.credential_env)
            for env_var in candidate_envs:
                val = os.environ.get(env_var, "").strip()
                if val:
                    for k in _parse_keys_val(val):
                        self.key_manager.add_key(prov, k)

        if self.mc.api_key and self.mc.provider not in {"ollama", "lmstudio"}:
            self.key_manager.add_key(self.mc.provider, self.mc.api_key)

    async def aclose(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------
    # Adaptive multi-tier cascade & key rotation (audit/fixes)
    # ------------------------------------------------------------------
    async def _probe_internet(self, host: str = "1.1.1.1", port: int = 53, timeout: float = 0.8) -> bool:
        """Fast TCP probe to detect internet connectivity (~70ms on live link)."""
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=timeout
            )
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            return True
        except Exception:
            return False

    async def probe_internet_cached(self, ttl: float = 12.0) -> bool:
        """Cached internet check with short TTL to avoid probing on every message.

        Uses getattr/setattr defaults so brains built via ``__new__``
        (as in the Phase 4 retry tests, which bypass ``__init__``)
        still work.
        """
        now = time.time()
        last = getattr(self, "_last_probe_time", 0.0)
        if (now - last) < ttl:
            return getattr(self, "_last_probe_result", True)
        res = await self._probe_internet(timeout=0.8)
        self._last_probe_time = now
        self._last_probe_result = res
        return res

    def _get_fastest_verified_cloud_model(self, exclude: set[str]) -> dict[str, str] | None:
        """Find the fastest verified working cloud model from models.db."""
        db_path = Path(__file__).resolve().parent.parent.parent / "data" / "models.db"
        if not db_path.exists():
            return None
        DISALLOWED_PATTERNS = (
            "prompt-guard", "safeguard", "guardrail", "moderation",
            "embedding", "rerank", "whisper", "tts", "stt", "classifier"
        )
        try:
            import sqlite3
            conn = sqlite3.connect(db_path, timeout=1.0)
            cur = conn.cursor()
            cur.execute("""
                SELECT m.provider, m.model_name,
                       (SELECT latency_ms FROM test_results WHERE model_id = m.id AND test_result = 'success' ORDER BY id DESC LIMIT 1) as lat
                FROM models m
                WHERE m.status = 'active' AND m.provider NOT IN ('ollama', 'lmstudio')
                ORDER BY lat ASC
                LIMIT 25
            """)
            rows = cur.fetchall()
            conn.close()
            for prov, name, lat in rows:
                key = f"{prov}/{name}"
                name_lower = name.lower()
                if any(sub in name_lower for sub in DISALLOWED_PATTERNS):
                    continue
                if key not in exclude:
                    spec = get_provider_spec(prov)
                    ep = spec.default_base_url if spec else ""
                    return {"provider": prov, "model_name": name, "endpoint": ep}
        except Exception as e:
            log.debug("Failed to query fastest model from models.db: %s", e)
        return None

    def get_cascade_tiers(self) -> list[CascadeTier]:
        """Construct the prioritized multi-tier failover cascade:
        Tier 0: Primary configured model
        Tier 1: Fastest verified cloud model from models.db
        Tier 2: Resilient configured fallback model
        Tier 3: 9Router / OmniRoute local aggregation proxy (localhost:20128)

        A tier counts as local when its provider is ollama/lmstudio OR
        its endpoint is a loopback address — the audit version only
        checked the provider name, which would have skipped a primary
        Ollama reached via the default ``openai_compatible`` provider
        whenever the internet probe flaked.
        """
        mc = self.mc
        tiers: list[CascadeTier] = []
        seen: set[str] = set()

        # 1. Tier 0: Primary
        p0 = mc.provider or "gemini"
        m0 = mc.model or "gemini-2.5-flash"
        e0 = mc.endpoint
        is_p0_local = p0 in ("ollama", "lmstudio") or _is_local_endpoint(e0)
        tiers.append(CascadeTier(
            name="Tier 0 (Primary)",
            provider=p0,
            endpoint=e0,
            model=m0,
            is_local=is_p0_local,
            timeout=15.0 if not is_p0_local else 60.0,
            ttft_timeout=6.0 if not is_p0_local else 25.0,
        ))
        seen.add(f"{p0}/{m0}")

        # 2. Tier 1: Fastest verified cloud model from models.db
        fast_cloud = self._get_fastest_verified_cloud_model(exclude=seen)
        if fast_cloud:
            tiers.append(CascadeTier(
                name="Tier 1 (Fast Cloud)",
                provider=fast_cloud["provider"],
                endpoint=fast_cloud["endpoint"],
                model=fast_cloud["model_name"],
                is_local=False,
                timeout=12.0,
                ttft_timeout=5.0,
            ))
            seen.add(f"{fast_cloud['provider']}/{fast_cloud['model_name']}")

        # 3. Tier 2: Resilient fallback
        fb_p = getattr(mc, "fallback_provider", None) or "openrouter"
        fb_m = getattr(mc, "fallback_model", None) or "deepseek/deepseek-chat"
        fb_spec = get_provider_spec(fb_p)
        fb_e = getattr(mc, "fallback_endpoint", None) or (fb_spec.default_base_url if fb_spec else "")
        if f"{fb_p}/{fb_m}" not in seen:
            is_fb_local = fb_p in ("ollama", "lmstudio") or _is_local_endpoint(fb_e)
            tiers.append(CascadeTier(
                name="Tier 2 (Resilient Cloud)",
                provider=fb_p,
                endpoint=fb_e,
                model=fb_m,
                is_local=is_fb_local,
                timeout=20.0,
                ttft_timeout=6.0,
            ))
            seen.add(f"{fb_p}/{fb_m}")

        # 4. Tier 3: 9Router / OmniRoute local aggregation proxy (localhost:20128).
        # Aggregates free-tier providers behind one OpenAI-compatible endpoint.
        # Marked is_local so it is still attempted when the internet probe
        # flakes — the proxy itself is on localhost.
        omni_spec = get_provider_spec("omniroute")
        omni_model = os.environ.get("JARVIS_OMNIROUTE_MODEL", "groq/openai/gpt-oss-120b")
        if f"omniroute/{omni_model}" not in seen and omni_spec:
            tiers.append(CascadeTier(
                name="Tier 3 (9Router Aggregate)",
                provider="omniroute",
                endpoint=omni_spec.default_base_url,
                model=omni_model,
                is_local=True,
                timeout=30.0,
                ttft_timeout=10.0,
            ))

        return tiers

    # -- key helpers (None-safe for brains built via __new__) ------------
    def _key_manager(self) -> KeyManager | None:
        return getattr(self, "key_manager", None)

    def _resolve_key(self, provider: str) -> str | None:
        km = self._key_manager()
        if km is not None:
            key = km.get_active_key(provider)
            if key:
                return key
        if provider == self.mc.provider and self.mc.api_key:
            return self.mc.api_key
        return None

    def _mark_key(self, method: str, provider: str, key: str | None, **kw: Any) -> None:
        km = self._key_manager()
        if km is not None and key:
            getattr(km, method)(provider, key, **kw)

    async def _dispatch_tier(
        self,
        tier: CascadeTier,
        messages: list[dict],
        tool_schemas: list[dict],
        stream: bool = False,
        on_delta: Callable[[str], None] | None = None,
    ) -> tuple[BrainReply, str]:
        """One tier, with up to 2 key-rotation attempts.

        Returns ``(reply, action)`` where action is:
          ``"ok"``      — success, stop cascading
          ``"stop"``    — non-transient 4xx: return the reply as-is, do not cascade
          ``"cascade"`` — transient / auth-exhausted failure: try the next tier
        """
        spec = get_provider_spec(tier.provider)
        endpoint = tier.endpoint or (spec.default_base_url if spec else "")
        is_anthropic = tier.provider == "anthropic" or (
            spec is not None and spec.protocol == "anthropic"
        )
        km = self._key_manager()
        n_keys = len(km.get_keys(tier.provider)) if km is not None else 0
        max_attempts = min(2, max(1, n_keys))
        last_reply: BrainReply | None = None

        for _attempt in range(max_attempts):
            active_key = self._resolve_key(tier.provider)
            if is_anthropic:
                reply = await self._chat_anthropic(
                    messages, tool_schemas, api_key=active_key,
                    endpoint=endpoint, model=tier.model,
                )
            elif stream:
                reply = await self._chat_openai_compatible_stream(
                    messages, tool_schemas, on_delta=on_delta, api_key=active_key,
                    endpoint=endpoint, model=tier.model,
                )
            else:
                reply = await self._chat_openai_compatible(
                    messages, tool_schemas, api_key=active_key,
                    endpoint=endpoint, model=tier.model,
                )

            status = _brain_error_status(reply)
            if status is None and not reply.text.startswith("[brain error]"):
                self._mark_key("mark_success", tier.provider, active_key)
                return reply, "ok"
            if status == 200:  # pragma: no cover - defensive
                self._mark_key("mark_success", tier.provider, active_key)
                return reply, "ok"

            last_reply = reply
            if status in (429, 413):
                log.warning(
                    "Rate limit / quota %s on %s (key: %s). Rotating key...",
                    status, tier.provider, mask_key(active_key or ""),
                )
                cooldown = float(getattr(self.mc, "key_cooldown_seconds", 60.0) or 60.0)
                self._mark_key("mark_rate_limited", tier.provider, active_key,
                               cooldown_seconds=cooldown)
                continue
            if status in (401, 403):
                log.warning(
                    "Auth error %s on %s (key: %s). Disabling key...",
                    status, tier.provider, mask_key(active_key or ""),
                )
                self._mark_key("mark_invalid", tier.provider, active_key,
                               reason=f"Auth failed {status}")
                continue
            if status is not None and 400 <= status < 500:
                # Non-transient client error (400/404/422, ...): the
                # request itself is wrong — another provider will not
                # fix it, and the Phase 4 retry tests require exactly
                # one call for HTTP 400. Do not cascade.
                return reply, "stop"
            # 5xx / timeout / connection error (status None or >= 500):
            # cascade to the next tier.
            return reply, "cascade"

        return last_reply or BrainReply(
            text=f"[brain error] {tier.provider} failed all {max_attempts} attempts",
            raw="",
        ), "cascade"

    # ------------------------------------------------------------------
    def build_system_prompt(self, persona: str, tools_doc: str) -> str:
        parts = [persona.strip()]
        if not self.mc.native_tool_calls:
            parts.append(REACT_INSTRUCTIONS)
        if tools_doc:
            parts.append("Available tools:\n" + tools_doc)
        return "\n\n".join(parts)

    # ------------------------------------------------------------------
    async def chat(
        self,
        messages: list[dict[str, str]],
        tool_schemas: list[dict] | None = None,
    ) -> BrainReply:
        schemas = tool_schemas or []
        online = await self.probe_internet_cached()
        last_reply: BrainReply | None = None
        for tier in self.get_cascade_tiers():
            if not online and not tier.is_local:
                log.info("[cascade:offline] Skipping %s (%s) — no internet connection",
                         tier.name, tier.provider)
                continue
            log.info("[cascade] Attempting %s: %s / %s", tier.name, tier.provider, tier.model)
            reply, action = await self._dispatch_tier(
                tier, messages, schemas, stream=False,
            )
            if action == "ok":
                tag = f"[{'offline:' if tier.is_local and not online else 'tier:'}{tier.provider}/{tier.model}] "
                reply.raw = tag + reply.raw
                return reply
            if action == "stop":
                return reply
            log.warning("[cascade] %s (%s/%s) failed: %s. Cascading to next tier...",
                        tier.name, tier.provider, tier.model, reply.text)
            last_reply = reply
        return last_reply or BrainReply(
            text="[brain error] All multi-tier LLM providers and local fallbacks failed.",
            raw="",
        )

    async def chat_stream(
        self,
        messages: list[dict],
        tool_schemas: list[dict] | None = None,
        on_delta: Callable[[str], None] | None = None,
    ) -> BrainReply:
        """Streaming chat — invokes `on_delta(text_chunk)` for each token.

        Tool-call arguments are accumulated transparently. Returns the same
        `BrainReply` shape as `chat()` once the stream finishes.

        Falls back to non-stream on Anthropic provider or when the server
        returns a non-stream response. Cascades across tiers like
        `chat()`; a tier that already delivered tokens is never retried
        (re-running would duplicate deltas already shown to the user).
        """
        schemas = tool_schemas or []
        online = await self.probe_internet_cached()
        last_reply: BrainReply | None = None
        for tier in self.get_cascade_tiers():
            if not online and not tier.is_local:
                log.info("[cascade:stream:offline] Skipping %s (%s) — offline",
                         tier.name, tier.provider)
                continue
            log.info("[cascade:stream] Attempting %s: %s / %s", tier.name, tier.provider, tier.model)
            delivered = 0

            def _counting(piece: str, _on_delta: Callable[[str], None] | None = on_delta) -> None:
                nonlocal delivered
                if piece:
                    delivered += 1
                if _on_delta:
                    _on_delta(piece)

            reply, action = await self._dispatch_tier(
                tier, messages, schemas, stream=True,
                on_delta=_counting if on_delta else None,
            )
            if action == "ok":
                tag = f"[{'offline:' if tier.is_local and not online else 'tier:'}{tier.provider}/{tier.model}] "
                reply.raw = tag + reply.raw
                return reply
            if delivered:
                log.warning("[cascade:stream] Partial stream delivered from %s before failure",
                            tier.name)
                return reply
            if action == "stop":
                return reply
            log.warning("[cascade:stream] %s (%s/%s) failed or stalled. Cascading to next tier...",
                        tier.name, tier.provider, tier.model)
            last_reply = reply
        return last_reply or BrainReply(
            text="[brain error] All streaming cascade tiers failed.", raw="",
        )

    # ------------------------------------------------------------------
    async def _chat_openai_compatible(
        self,
        messages: list[dict[str, str]],
        tool_schemas: list[dict],
        api_key: str | None = None,
        endpoint: str | None = None,
        model: str | None = None,
    ) -> BrainReply:
        url = (endpoint or self.mc.endpoint).rstrip("/") + "/chat/completions"
        headers = {"Content-Type": "application/json"}
        key = api_key if api_key is not None else self.mc.api_key
        if key:
            headers["Authorization"] = f"Bearer {key}"
        # OpenRouter requires these headers for proper routing.
        if "openrouter.ai" in (endpoint or self.mc.endpoint):
            headers["HTTP-Referer"] = "http://localhost:7341"
            headers["X-Title"] = "JARVIS_LOCAL"

        norm_msgs = _normalise_messages(messages)

        payload: dict[str, Any] = {
            "model": model or self.mc.model,
            "messages": norm_msgs,
            "temperature": self.mc.temperature,
            "max_tokens": self.mc.max_tokens,
            "stream": False,
            "frequency_penalty": self.mc.frequency_penalty,
            "presence_penalty":  self.mc.presence_penalty,
        }
        if self.mc.reasoning_effort not in (None, "none", ""):
            payload["reasoning_effort"] = self.mc.reasoning_effort
        if self.mc.native_tool_calls and tool_schemas:
            payload["tools"] = [
                {"type": "function", "function": s} for s in tool_schemas
            ]

        resp = None
        for attempt in range(LLM_MAX_ATTEMPTS):
            try:
                resp = await self._client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                break
            except httpx.HTTPStatusError as e:
                if _is_transient_llm_error(e) and attempt + 1 < LLM_MAX_ATTEMPTS:
                    log.warning("LLM HTTP %s — retry %d/%d", e.response.status_code, attempt + 1, LLM_MAX_ATTEMPTS)
                    await _retry_sleep(attempt)
                    continue
                body = e.response.text[:500] if e.response else ""
                log.error("LLM HTTP %s: %s — %s", e.response.status_code, e, body)
                return BrainReply(text=f"[brain error] HTTP {e.response.status_code}: {body}", raw=str(e))
            except httpx.HTTPError as e:
                if _is_transient_llm_error(e) and attempt + 1 < LLM_MAX_ATTEMPTS:
                    log.warning("LLM %s — retry %d/%d", type(e).__name__, attempt + 1, LLM_MAX_ATTEMPTS)
                    await _retry_sleep(attempt)
                    continue
                log.error("LLM HTTP error: %s", e)
                return BrainReply(text=f"[brain error] {e}", raw=str(e))
        assert resp is not None

        data = resp.json()
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message", {}) or {}
        raw_text: str = msg.get("content") or ""
        finish = choice.get("finish_reason")

        tool_calls: list[ToolCall] = []

        # native tool calls (OpenAI style)
        for tc in msg.get("tool_calls") or []:
            fn = tc.get("function", {})
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            tool_calls.append(
                ToolCall(
                    name=fn.get("name", ""),
                    args=args,
                    raw=json.dumps(fn),
                    call_id=tc.get("id"),
                    extra_content=tc.get("extra_content"),
                )
            )

        # ReAct fallback parse
        if not tool_calls:
            tool_calls = _parse_react_tool_calls(raw_text)

        clean_text = _strip_artifacts(raw_text)
        return BrainReply(text=clean_text, tool_calls=tool_calls, raw=raw_text, finish_reason=finish)

    # ------------------------------------------------------------------
    async def _chat_openai_compatible_stream(
        self,
        messages: list[dict[str, Any]],
        tool_schemas: list[dict],
        on_delta: Callable[[str], None] | None = None,
        api_key: str | None = None,
        endpoint: str | None = None,
        model: str | None = None,
    ) -> BrainReply:
        """Retry wrapper: re-runs the stream only when it failed BEFORE
        any token was delivered (a mid-stream failure keeps the partial
        text — re-running would duplicate deltas already shown to the user).
        """
        for attempt in range(LLM_MAX_ATTEMPTS):
            delivered = 0

            def _counting(piece: str) -> None:
                nonlocal delivered
                if piece:
                    delivered += 1
                if on_delta:
                    on_delta(piece)

            reply = await self._chat_openai_compatible_stream_once(
                messages, tool_schemas, on_delta=_counting if on_delta else None,
                api_key=api_key, endpoint=endpoint, model=model,
            )
            if not reply.text.startswith("[brain error]") or delivered:
                return reply
            if attempt + 1 >= LLM_MAX_ATTEMPTS:
                return reply
            log.warning("LLM stream failed before first token — retry %d/%d",
                        attempt + 1, LLM_MAX_ATTEMPTS)
            await _retry_sleep(attempt)
        return reply  # pragma: no cover - loop always returns above

    async def _chat_openai_compatible_stream_once(
        self,
        messages: list[dict[str, Any]],
        tool_schemas: list[dict],
        on_delta: Callable[[str], None] | None = None,
        api_key: str | None = None,
        endpoint: str | None = None,
        model: str | None = None,
    ) -> BrainReply:
        url = (endpoint or self.mc.endpoint).rstrip("/") + "/chat/completions"
        headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
        key = api_key if api_key is not None else self.mc.api_key
        if key:
            headers["Authorization"] = f"Bearer {key}"
        if "openrouter.ai" in (endpoint or self.mc.endpoint):
            headers["HTTP-Referer"] = "http://localhost:7341"
            headers["X-Title"] = "JARVIS_LOCAL"

        norm_msgs = _normalise_messages(messages)
        payload: dict[str, Any] = {
            "model": model or self.mc.model,
            "messages": norm_msgs,
            "temperature": self.mc.temperature,
            "max_tokens": self.mc.max_tokens,
            "stream": True,
            "frequency_penalty": self.mc.frequency_penalty,
            "presence_penalty":  self.mc.presence_penalty,
        }
        if self.mc.reasoning_effort not in (None, "none", ""):
            payload["reasoning_effort"] = self.mc.reasoning_effort
        if self.mc.native_tool_calls and tool_schemas:
            payload["tools"] = [{"type": "function", "function": s} for s in tool_schemas]

        text_parts: list[str] = []
        # Accumulate streaming tool_calls keyed by index.
        tc_acc: dict[int, dict[str, Any]] = {}
        finish_reason: str | None = None
        loop_truncated = False

        try:
            async with self._client.stream("POST", url, json=payload, headers=headers) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", "replace")[:500]
                    log.error("LLM stream HTTP %s: %s", resp.status_code, body)
                    return BrainReply(text=f"[brain error] HTTP {resp.status_code}: {body}", raw=body)
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    if not line or line == "[DONE]":
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    choice = (chunk.get("choices") or [{}])[0]
                    delta = choice.get("delta", {}) or {}
                    if choice.get("finish_reason"):
                        finish_reason = choice["finish_reason"]
                    # Text delta
                    piece = delta.get("content")
                    if piece:
                        text_parts.append(piece)
                        if on_delta:
                            try:
                                on_delta(piece)
                            except Exception:  # noqa: BLE001
                                pass
                        # Loop watchdog: abort if we detect ≥3-fold back-to-back
                        # repetition in the last 240 chars.
                        cut = _detect_repetition_loop("".join(text_parts))
                        if cut is not None:
                            loop_truncated = True
                            full = "".join(text_parts)
                            text_parts = [full[:cut]]
                            finish_reason = finish_reason or "repetition_loop"
                            log.warning("stream aborted: repetition loop at offset %d", cut)
                            break
                    # Tool call deltas
                    for tc in delta.get("tool_calls") or []:
                        idx = tc.get("index", 0)
                        slot = tc_acc.setdefault(idx, {"id": "", "name": "", "args": "", "extra_content": None})
                        if tc.get("id"):
                            slot["id"] = tc["id"]
                        if tc.get("extra_content"):
                            slot["extra_content"] = tc["extra_content"]
                        fn = tc.get("function") or {}
                        if fn.get("name"):
                            slot["name"] = fn["name"]
                        if fn.get("arguments"):
                            slot["args"] += fn["arguments"]
        except httpx.HTTPError as e:
            log.error("LLM stream HTTP error: %s", e)
            return BrainReply(text=f"[brain error] {e}", raw=str(e))

        if loop_truncated and on_delta:
            # Tell the consumer we cut. Optional — the UI already has the text.
            try:
                on_delta("")  # marker no-op
            except Exception:
                pass

        raw_text = "".join(text_parts)
        tool_calls: list[ToolCall] = []
        for idx in sorted(tc_acc.keys()):
            slot = tc_acc[idx]
            try:
                args = json.loads(slot["args"] or "{}")
            except json.JSONDecodeError:
                args = {}
            tool_calls.append(ToolCall(
                name=slot["name"],
                args=args,
                raw=json.dumps(slot),
                call_id=slot["id"] or None,
                extra_content=slot.get("extra_content"),
            ))

        # ReAct fallback if no native tool calls came through
        if not tool_calls:
            tool_calls = _parse_react_tool_calls(raw_text)

        return BrainReply(
            text=_strip_artifacts(raw_text),
            tool_calls=tool_calls,
            raw=raw_text,
            finish_reason=finish_reason,
        )

    # ------------------------------------------------------------------
    async def _chat_anthropic(
        self,
        messages: list[dict[str, str]],
        tool_schemas: list[dict],
        api_key: str | None = None,
        endpoint: str | None = None,
        model: str | None = None,
    ) -> BrainReply:
        url = (endpoint or self.mc.endpoint).rstrip("/") + "/v1/messages"
        headers = {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
        }
        key = api_key if api_key is not None else self.mc.api_key
        if key:
            headers["x-api-key"] = key

        # Anthropic separates system message from messages
        system_text = ""
        conv: list[dict[str, Any]] = []
        for m in messages:
            if m["role"] == "system":
                system_text += ("\n" if system_text else "") + m["content"]
            else:
                conv.append({"role": m["role"], "content": m["content"]})

        payload: dict[str, Any] = {
            "model": model or self.mc.model,
            "system": system_text,
            "messages": conv,
            "max_tokens": self.mc.max_tokens,
            "temperature": self.mc.temperature,
        }
        if self.mc.native_tool_calls and tool_schemas:
            payload["tools"] = [
                {
                    "name": s["name"],
                    "description": s.get("description", ""),
                    "input_schema": s.get("parameters", {"type": "object"}),
                }
                for s in tool_schemas
            ]

        resp = None
        for attempt in range(LLM_MAX_ATTEMPTS):
            try:
                resp = await self._client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                break
            except httpx.HTTPStatusError as e:
                if _is_transient_llm_error(e) and attempt + 1 < LLM_MAX_ATTEMPTS:
                    log.warning("Anthropic %s — retry %d/%d", type(e).__name__, attempt + 1, LLM_MAX_ATTEMPTS)
                    await _retry_sleep(attempt)
                    continue
                body = e.response.text[:500] if e.response else ""
                log.error("Anthropic HTTP %s: %s", e.response.status_code, body)
                return BrainReply(text=f"[brain error] HTTP {e.response.status_code}: {body}", raw=str(e))
            except httpx.HTTPError as e:
                if _is_transient_llm_error(e) and attempt + 1 < LLM_MAX_ATTEMPTS:
                    log.warning("Anthropic %s — retry %d/%d", type(e).__name__, attempt + 1, LLM_MAX_ATTEMPTS)
                    await _retry_sleep(attempt)
                    continue
                log.error("Anthropic HTTP error: %s", e)
                return BrainReply(text=f"[brain error] {e}", raw=str(e))
        assert resp is not None

        data = resp.json()
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for block in data.get("content", []):
            t = block.get("type")
            if t == "text":
                text_parts.append(block.get("text", ""))
            elif t == "tool_use":
                tool_calls.append(
                    ToolCall(
                        name=block.get("name", ""),
                        args=block.get("input", {}) or {},
                        raw=json.dumps(block),
                        call_id=block.get("id"),
                    )
                )

        raw_text = "".join(text_parts)
        if not tool_calls:
            tool_calls = _parse_react_tool_calls(raw_text)

        return BrainReply(
            text=_strip_artifacts(raw_text),
            tool_calls=tool_calls,
            raw=raw_text,
            finish_reason=data.get("stop_reason"),
        )


def _detect_repetition_loop(text: str) -> int | None:
    """Return the cut index (keep text[:cut]) if back-to-back repetition is
    detected in the last 240 chars, else None.

    Examples that trigger:
      "it appears you are holding, it appears you are holding, it appears you are holding"
      "abc abc abc abc"
    """
    # Frequency-count detector. Strict back-to-back matching misses real
    # loops because the last repetition is often truncated mid-phrase
    # ("X, X, X, X" — last X has no trailing punctuation). Instead, count
    # how many times each candidate substring from early-in-the-tail
    # appears anywhere in the tail. ≥4 → loop.
    n = len(text)
    if n < 60:
        return None
    tail = text[-400:]
    base = n - len(tail)
    # Try medium-length probes first; tighter probes catch shorter loops.
    for size in (40, 30, 24, 20, 17, 14):
        if size * 4 > len(tail):
            continue
        # Sample candidate segs from the first ~120 chars of the tail in
        # 5-char steps. Anything that repeats 4+ times anywhere in tail
        # is a clear degenerate loop.
        for start in range(0, min(120, len(tail) - size * 3), 5):
            seg = tail[start:start + size]
            if not seg.strip():
                continue
            tokens = seg.split()
            if len(tokens) < 2 or sum(len(t) for t in tokens) < 8:
                continue
            if tail.count(seg) >= 4:
                # Keep first instance — cut right after it ends.
                first = tail.find(seg)
                return base + first + size


def _normalise_messages(messages: list[dict]) -> list[dict[str, Any]]:
    """Pass through `tool_calls`, `tool_call_id`, `name`, and multimodal
    `content` arrays (text + image_url parts) so multi-hop and vision both
    work with strict OpenAI-compatible servers (Ollama, vLLM, OpenAI)."""
    out: list[dict[str, Any]] = []
    for m in messages:
        entry: dict[str, Any] = {"role": m.get("role", "user")}
        if "content" in m:
            entry["content"] = m["content"]
        # If caller attached images, lift into OpenAI multimodal format.
        attach = m.get("attachments") or []
        if attach:
            parts: list[dict[str, Any]] = []
            if isinstance(entry.get("content"), str) and entry["content"]:
                parts.append({"type": "text", "text": entry["content"]})
            for a in attach:
                if not isinstance(a, dict):
                    continue
                if a.get("type") == "image" and a.get("data_url"):
                    parts.append({"type": "image_url", "image_url": {"url": a["data_url"]}})
            if parts:
                entry["content"] = parts
        for k in ("tool_calls", "tool_call_id", "name"):
            if k in m:
                entry[k] = m[k]
        out.append(entry)
    return out


def _parse_react_tool_calls(text: str) -> list[ToolCall]:
    calls: list[ToolCall] = []
    for m in TOOL_CALL_RE.finditer(text or ""):
        payload = m.group(1).strip()
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            continue
        name = obj.get("name") or obj.get("tool")
        args = obj.get("args") or obj.get("arguments") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {"_raw": args}
        if name:
            calls.append(ToolCall(name=name, args=args, raw=m.group(0)))
    if calls:
        return calls

    for m in XML_TOOL_RE.finditer(text or ""):
        name = m.group("name").strip()
        if name.lower() in {"thinking", "tool_call"}:
            continue
        body = m.group("body").strip()
        args: dict[str, Any]
        try:
            parsed = json.loads(body)
            args = parsed if isinstance(parsed, dict) else {"_raw": parsed}
        except json.JSONDecodeError:
            args = _args_from_legacy_tool_tag(name, body)
        calls.append(ToolCall(name=name, args=args, raw=m.group(0)))
    return calls


def _args_from_legacy_tool_tag(name: str, body: str) -> dict[str, Any]:
    if name == "web_search":
        return {"query": body, "max_results": 5}
    if name == "web_fetch":
        return {"url": body}
    if name in {"read_file", "list_dir", "scan_project"}:
        return {"path": body}
    if name in {"shell", "run_shell", "shell_command"}:
        return {"command": body}
    return {"_raw": body}


def _strip_artifacts(text: str) -> str:
    if not text:
        return ""
    text = TOOL_CALL_RE.sub("", text)
    text = XML_TOOL_RE.sub(
        lambda m: "" if m.group("name").lower() != "thinking" else m.group(0),
        text,
    )
    text = THOUGHT_RE.sub("", text)
    return text.strip()
