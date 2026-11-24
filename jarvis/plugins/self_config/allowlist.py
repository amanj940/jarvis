"""Allowlist for self-configuration: the ONLY config.yaml keys JARVIS may
change about itself, with the type and range of every value.

Closed allowlist — anything not listed here is rejected, no exceptions.
In particular the allowlist can never contain:

- ``permissions.*`` — the permission mode is never self-editable.
- Anything secret-shaped: keys, tokens, passwords, endpoints that carry
  credentials, ``api_keys_pool``.
- Paths that move data, logs, or the sandbox (``memory.db_path``,
  ``logging.file``, ``code_execution.workdir``, ``mission.project_path``).
- Whole integration sections (``integrations.*`` hold tokens).
- ``model.endpoint`` / ``model.fallback_endpoint`` — pointing the brain at
  a new server is not a safe self-change.

Dotted keys use the config.yaml layout (``model.temperature``,
``voice.edge_voice``). ``plugins.<name>.enabled`` is the one dynamic
pattern: only the boolean ``enabled`` flag of a named plugin.
"""
from __future__ import annotations

import re

# key -> validation spec. "kind" is one of bool/int/float/str.
# "min"/"max" bound numbers and string length; "choices" restricts strings.
SAFE_CONFIG_KEYS: dict[str, dict] = {
    # — model (brain) ————————————————————————————————————————————
    "model.temperature": {"kind": "float", "min": 0.0, "max": 2.0},
    "model.max_tokens": {"kind": "int", "min": 1, "max": 131072},
    "model.request_timeout_seconds": {"kind": "int", "min": 5, "max": 600},
    "model.model": {"kind": "str", "min": 1, "max": 200},
    "model.fallback_model": {"kind": "str", "min": 1, "max": 200},
    "model.fallback_provider": {"kind": "str", "min": 1, "max": 64},
    "model.frequency_penalty": {"kind": "float", "min": -2.0, "max": 2.0},
    "model.presence_penalty": {"kind": "float", "min": -2.0, "max": 2.0},
    "model.native_tool_calls": {"kind": "bool"},
    "model.key_cooldown_seconds": {"kind": "float", "min": 0.0, "max": 3600.0},
    "model.reasoning_effort": {
        "kind": "str",
        "choices": ["low", "medium", "high", "none"],
    },
    # — voice ————————————————————————————————————————————————————
    "voice.provider": {
        "kind": "str",
        "choices": ["auto", "piper", "edge_tts", "nvidia_riva"],
    },
    "voice.edge_voice": {"kind": "str", "min": 1, "max": 120},
    "voice.edge_rate": {"kind": "str", "min": 1, "max": 16},
    "voice.edge_pitch": {"kind": "str", "min": 1, "max": 16},
    "voice.stt_language": {"kind": "str", "choices": ["ar", "en", "auto"]},
    "voice.chat_language": {"kind": "str", "choices": ["ar", "en"]},
    "voice.wake_word": {"kind": "str", "min": 1, "max": 64},
    "voice.piper_enabled": {"kind": "bool"},
    "voice.piper_length_scale": {"kind": "float", "min": 0.25, "max": 2.0},
    "voice.pyttsx3_enabled": {"kind": "bool"},
    "voice.pyttsx3_rate": {"kind": "int", "min": 50, "max": 400},
    "voice.pyttsx3_volume": {"kind": "float", "min": 0.0, "max": 1.0},
    "voice.preload_models": {"kind": "bool"},
    "voice.stt_provider": {
        "kind": "str",
        "choices": ["auto", "web_speech", "groq", "openai", "custom", "local"],
    },
    "voice.stt_model": {"kind": "str", "min": 1, "max": 120},
    # — assistant / ui ———————————————————————————————————————————
    "A.name": {"kind": "str", "min": 1, "max": 64},
    "A.persona_file": {"kind": "str", "min": 1, "max": 200},
    "ui.theme": {"kind": "str", "min": 1, "max": 64},
    "ui.emoji": {"kind": "bool"},
    "ui.show_status_bar": {"kind": "bool"},
    "ui.refresh_interval_ms": {"kind": "int", "min": 100, "max": 10000},
    # — logging / backups / image ————————————————————————————————
    "logging.level": {
        "kind": "str",
        "choices": ["DEBUG", "INFO", "WARNING", "ERROR"],
    },
    "backups.enabled": {"kind": "bool"},
    "backups.keep_last": {"kind": "int", "min": 1, "max": 500},
    "image_model.selected": {"kind": "str", "min": 1, "max": 120},
    # — ultimate feature toggles —————————————————————————————————
    "ultimate.enabled": {"kind": "bool"},
    "ultimate.semantic_memory": {"kind": "bool"},
    "ultimate.auto_remember": {"kind": "bool"},
    "ultimate.proactive_suggestions": {"kind": "bool"},
    "ultimate.reactive_visuals": {"kind": "bool"},
    "ultimate.autonomous_planning": {"kind": "bool"},
    "ultimate.context_compaction": {"kind": "bool"},
    "ultimate.recall_k": {"kind": "int", "min": 1, "max": 20},
    "ultimate.recall_min_score": {"kind": "float", "min": 0.0, "max": 1.0},
    # — voice activity detection ————————————————————————————————
    "vad.silence_threshold": {"kind": "float", "min": 0.0, "max": 1.0},
    "vad.silence_timeout_ms": {"kind": "int", "min": 100, "max": 5000},
    "vad.min_recording_ms": {"kind": "int", "min": 100, "max": 5000},
    "vad.max_recording_ms": {"kind": "int", "min": 1000, "max": 30000},
    "vad.silero_threshold": {"kind": "float", "min": 0.0, "max": 1.0},
    "vad.hallucination_filter_enabled": {"kind": "bool"},
    "vad.filler_filter_enabled": {"kind": "bool"},
}

_PLUGIN_ENABLED_RE = re.compile(r"^plugins\.[A-Za-z0-9_]+\.enabled$")

# Substrings that are never allowed anywhere in a key, even if a future
# allowlist entry were added carelessly.
FORBIDDEN_KEY_SUBSTRINGS = (
    "api_key",
    "api_keys",
    "token",
    "password",
    "secret",
    "endpoint",
    "permissions",
    "integrations",
)


def is_allowed(key: str) -> tuple[bool, str]:
    """Return (allowed, reason). Closed allowlist: unknown keys are denied."""
    if not isinstance(key, str) or not key or ".." in key:
        return False, f"invalid key: {key!r}"
    lowered = key.lower()
    for bad in FORBIDDEN_KEY_SUBSTRINGS:
        if bad in lowered:
            return False, (
                f"key {key!r} is forbidden (matches {bad!r}); "
                "secrets, endpoints and permissions are never self-editable"
            )
    if key in SAFE_CONFIG_KEYS:
        return True, "allowed"
    if _PLUGIN_ENABLED_RE.match(key):
        return True, "allowed (plugin enabled flag)"
    if "." not in key or key.split(".")[0] in {
        "permissions",
        "integrations",
        "memory",
        "code_execution",
        "project",
        "mission",
    }:
        return False, (
            f"key {key!r} is not on the self-config allowlist; "
            "the permissions, integrations, memory, code_execution, "
            "project and mission sections are never self-editable"
        )
    return False, f"key {key!r} is not on the self-config allowlist"


def spec_for(key: str) -> dict | None:
    """Validation spec for a key, or None if it is not a listed key."""
    if key in SAFE_CONFIG_KEYS:
        return SAFE_CONFIG_KEYS[key]
    if _PLUGIN_ENABLED_RE.match(key):
        return {"kind": "bool"}
    return None


def validate_value(key: str, value: object) -> object:
    """Coerce and range-check ``value`` for ``key``.

    Raises ValueError on any mismatch. Booleans are never accepted as
    ints (``True`` is an ``int`` in Python) and strings are never
    silently coerced into numbers, except plain ``"true"``/``"false"``
    for boolean keys, which is what a chat tool call usually produces.
    """
    spec = spec_for(key)
    if spec is None:
        raise ValueError(f"key {key!r} is not on the self-config allowlist")
    kind = spec["kind"]
    if kind == "bool":
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.strip().lower() in ("true", "false"):
            return value.strip().lower() == "true"
        raise ValueError(f"key {key!r} needs a boolean, got {value!r}")
    if kind == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"key {key!r} needs an integer, got {value!r}")
        if "min" in spec and value < spec["min"]:
            raise ValueError(f"key {key!r} must be >= {spec['min']}, got {value}")
        if "max" in spec and value > spec["max"]:
            raise ValueError(f"key {key!r} must be <= {spec['max']}, got {value}")
        return value
    if kind == "float":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"key {key!r} needs a number, got {value!r}")
        value = float(value)
        if "min" in spec and value < spec["min"]:
            raise ValueError(f"key {key!r} must be >= {spec['min']}, got {value}")
        if "max" in spec and value > spec["max"]:
            raise ValueError(f"key {key!r} must be <= {spec['max']}, got {value}")
        return value
    if kind == "str":
        if not isinstance(value, str):
            raise ValueError(f"key {key!r} needs a string, got {value!r}")
        if "min" in spec and len(value) < spec["min"]:
            raise ValueError(f"key {key!r} must not be empty")
        if "max" in spec and len(value) > spec["max"]:
            raise ValueError(f"key {key!r} must be <= {spec['max']} chars")
        if "choices" in spec and value not in spec["choices"]:
            raise ValueError(
                f"key {key!r} must be one of {spec['choices']}, got {value!r}"
            )
        return value
    raise ValueError(f"unknown spec kind {kind!r} for key {key!r}")
