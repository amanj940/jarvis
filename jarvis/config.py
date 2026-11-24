"""Configuration loader.

Reads `config.yaml` from the project root, merges in environment variables
from `.env`, validates with Pydantic, and exposes a typed `Config` object.

Source of truth: `config.yaml` wins whenever it is present. The Pydantic
defaults below deliberately mirror `config.yaml`, so a missing or partial
config file behaves exactly like the shipped one. If you change a value in
`config.yaml`, update the matching default here too.

The assistant persona is NOT stored here: it lives in `persona/jarvis-ar.md`
and is loaded by `load_config` (see `AssistantConfig.persona_file`). An
inline `persona:` in `config.yaml` still works and takes precedence.
"""
from __future__ import annotations

import os
import re
import threading
from pathlib import Path
from typing import Any, Optional

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field, field_validator

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config.yaml"
DEFAULT_ENV_PATH = PROJECT_ROOT / ".env"


class ModelConfig(BaseModel):
    provider: str = "openai_compatible"
    endpoint: str = "http://localhost:11434/v1"  # mirrors config.yaml
    model: str = "gemma4:31b-cloud"  # mirrors config.yaml
    api_key_env: str = "OLLAMA_API_KEY"  # mirrors config.yaml
    temperature: float = 0.3
    max_tokens: int = 16384  # mirrors config.yaml
    request_timeout_seconds: int = 180  # mirrors config.yaml
    native_tool_calls: bool = True  # mirrors config.yaml
    reasoning_effort: str | None = None
    # Anti-repetition — light touch. Higher values degrade fluency and can
    # paradoxically push the model into longer loops. Ollama already
    # auto-translates `frequency_penalty` → repeat_penalty internally, so
    # we DO NOT also pass an `options.repeat_penalty` (double-penalty was
    # the cause of stream lag).
    frequency_penalty: float = 0.2
    presence_penalty: float = 0.0
    # Legacy Ollama-style repeat penalty. Kept for backward compat with any
    # cached bytecode that still references it; current brain.py does not
    # send it (frequency_penalty is auto-translated by Ollama server-side).
    repeat_penalty: float = 1.0
    # Multi-key rotation + provider failover cascade (audit/fixes, merged
    # into the Phase 2 brain). All optional; defaults keep single-provider
    # behaviour. api_keys_pool maps provider -> list of keys; ${VAR} refs
    # and comma-separated values are expanded by KeyManager.
    api_keys_pool: dict[str, list[str]] = Field(default_factory=dict)
    # Tier 2 of the cascade: tried when the primary provider (and the
    # fastest verified cloud model, when data/models.db exists) fail.
    fallback_provider: str = "openrouter"  # mirrors config.yaml
    fallback_model: str = "deepseek/deepseek-chat"  # mirrors config.yaml
    fallback_endpoint: str = ""  # blank → provider catalog default
    # How long a 429 rate-limited key stays in cooldown before reuse.
    key_cooldown_seconds: float = 60.0  # mirrors config.yaml
    # af-only (audit/fixes). No reader in the merged tree uses these yet;
    # they preserve the af config surface so an af config.yaml keeps
    # parsing instead of being silently dropped.
    # Multi-key support: list of env var names or empty for single key mode.
    api_key_envs: list[str] = Field(default_factory=list)
    # Fallback provider chain (e.g., ["groq", "gemini", "openai_compatible"]).
    fallback_providers: list[str] = Field(default_factory=list)
    # Key rotation settings.
    key_rotation_enabled: bool = True

    @property
    def api_key(self) -> str:
        return os.environ.get(self.api_key_env, "")

    @property
    def api_keys(self) -> list[str]:
        """Get all API keys for this provider (multi-key support, af)."""
        # 1. From explicit pool in config
        prov = self.provider.lower().strip()
        if self.api_keys_pool and prov in self.api_keys_pool:
            pool_keys: list[str] = []
            for k in self.api_keys_pool[prov]:
                k_str = str(k).strip()
                if not k_str or k_str.startswith(":::"):
                    continue
                if k_str.startswith("${") and k_str.endswith("}"):
                    var_name = k_str[2:-1].split(":-")[0].strip()
                    val = os.environ.get(var_name, "").strip()
                    if val:
                        for sub_k in val.split(","):
                            sub_clean = sub_k.strip()
                            if sub_clean and not sub_clean.startswith(":::"):
                                pool_keys.append(sub_clean)
                else:
                    pool_keys.append(k_str)
            if pool_keys:
                return pool_keys

        # 2. From multiple env vars if configured
        if self.api_key_envs:
            keys = []
            for env_var in self.api_key_envs:
                key = os.environ.get(env_var, "").strip()
                if key:
                    keys.append(key)
            if keys:
                return keys

        # 3. From single key env (supports single key, comma-separated keys, or json array)
        raw = os.environ.get(self.api_key_env, "").strip()
        if not raw:
            return []
        if raw.startswith("[") and raw.endswith("]"):
            import json
            try:
                arr = json.loads(raw)
                return [str(k).strip() for k in arr if str(k).strip()]
            except Exception:
                pass
        if "," in raw:
            return [k.strip() for k in raw.split(",") if k.strip()]
        return [raw]


class ImageModelConfig(BaseModel):
    selected: str = "flux2-klein"


class PermissionsConfig(BaseModel):
    # NOTE: config.yaml sets mode: bypass. The code default stays
    # "confirm" on purpose — a missing config.yaml must never silently
    # auto-allow every tool. The yaml value wins when the file is present.
    mode: str = "confirm"
    denylist: list[str] = Field(default_factory=list)


class UIConfig(BaseModel):
    theme: str = "jarvis"
    emoji: bool = True
    show_status_bar: bool = True
    refresh_interval_ms: int = 1500


class MemoryConfig(BaseModel):
    db_path: str = "data/memory.db"
    auto_remember_user_preferences: bool = True


class LoggingConfig(BaseModel):
    level: str = "INFO"
    file: str = "data/logs/jarvis.log"
    action_log: str = "data/logs/actions.jsonl"


class BackupConfig(BaseModel):
    enabled: bool = True
    dir: str = "data/backups"
    keep_last: int = 50


class CodeExecConfig(BaseModel):
    max_retries: int = 3
    timeout_seconds: int = 60
    workdir: str = "data/sandbox"
    allowed_runtimes: list[str] = Field(default_factory=lambda: ["python", "node"])


class ProjectConfig(BaseModel):
    watch_dirs: list[str] = Field(default_factory=list)
    ignore_patterns: list[str] = Field(default_factory=list)


class PluginToggle(BaseModel):
    model_config = ConfigDict(extra="allow")
    enabled: bool = False
    provider: str | None = None


class AssistantConfig(BaseModel):
    name: str = "JARVIS"
    # Short fallback used only when neither an inline `persona:` in
    # config.yaml nor the persona file below can be found.
    persona: str = "You are JARVIS, a calm, precise, proactive local AI assistant."
    # Single source of truth for the full persona text. Relative paths are
    # resolved against the config file's directory, then the project root.
    # Default is the Arabic persona; set A.persona_file: persona/jarvis.md
    # for English.
    persona_file: str = "persona/jarvis-ar.md"
    # Domain doctrines (af) injected into the system prompt ONLY when the
    # user turn matches the domain — keeps the base persona lean. No
    # reader in the merged tree uses these yet.
    cyberlab_doctrine: str = ""
    model_ops_doctrine: str = ""


class MissionConfig(BaseModel):
    enabled: bool = False
    project_path: str = ""


class UltimateConfig(BaseModel):
    """Master switch + per-feature toggles for the ULTIMATE upgrade.

    Every subsystem added by the upgrade checks its flag here, so the whole
    thing can be reversed at runtime by editing config.yaml — no git needed.
    Set `enabled: false` to fall back to baseline JARVIS behaviour entirely.
    """
    enabled: bool = True

    # — Intelligence —
    semantic_memory: bool = True
    embed_model: str = "nomic-embed-text"  # mirrors config.yaml
    # Blank → reuse the main model endpoint. Point elsewhere (e.g. a local
    # Ollama/LM-Studio embeddings server) to decouple embeddings from chat.
    embed_endpoint: str = ""
    recall_k: int = 5
    recall_min_score: float = 0.22
    auto_remember: bool = True
    context_compaction: bool = True
    compaction_trigger_messages: int = 28
    compaction_keep_recent: int = 12
    autonomous_planning: bool = True
    plan_min_chars: int = 60          # only plan for non-trivial requests
    # Phase 3: when True, planning ALSO requires a multi-step / goal-shaped
    # request (sequencing words, multiple clauses, goal verbs) — a long
    # single question no longer spends an extra LLM call on a plan.
    # False restores the old length-only heuristic.
    plan_require_complexity: bool = True

    # — Intuitive —
    proactive_suggestions: bool = True

    # — Hop Budget & Loop Control (audit/fixes) —
    max_tool_hops: int = 30
    max_planned_tool_hops: int = 50
    stagnation_threshold: int = 3

    # — Gorgeous (frontend reads these via /health) —
    reactive_visuals: bool = True


class HomeAssistantConfig(BaseModel):
    url: str = ""
    token: str = ""


class EmailConfig(BaseModel):
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_pass: str = ""


class TelegramConfig(BaseModel):
    bot_token: str = ""
    chat_id: str = ""
    default_chat_id: str = ""
    enabled: bool = False


class FacebookConfig(BaseModel):
    page_id: str = ""
    page_access_token: str = ""
    enabled: bool = False


class YouTubeConfig(BaseModel):
    client_id: str = ""
    client_secret: str = ""
    refresh_token: str = ""
    channel_id: str = ""
    enabled: bool = False


class CalendarConfig(BaseModel):
    ical_url: str = ""


class InstagramConfig(BaseModel):
    access_token: str = ""
    user_id: str = ""          # Instagram Business/Creator user ID
    enabled: bool = False


class TikTokConfig(BaseModel):
    client_key: str = ""
    client_secret: str = ""
    access_token: str = ""
    open_id: str = ""          # TikTok user open_id from OAuth
    enabled: bool = False


class IntegrationsConfig(BaseModel):
    home_assistant: HomeAssistantConfig = Field(default_factory=HomeAssistantConfig)
    email: EmailConfig = Field(default_factory=EmailConfig)
    telegram: TelegramConfig = Field(default_factory=TelegramConfig)
    facebook: FacebookConfig = Field(default_factory=FacebookConfig)
    youtube: YouTubeConfig = Field(default_factory=YouTubeConfig)
    instagram: InstagramConfig = Field(default_factory=InstagramConfig)
    tiktok: TikTokConfig = Field(default_factory=TikTokConfig)
    social_platforms: dict = Field(default_factory=dict)
    calendar: CalendarConfig = Field(default_factory=CalendarConfig)


class VoiceConfig(BaseModel):
    wake_word: str = "Hey JARVIS"

    @field_validator("wake_word")
    @classmethod
    def normalize_wake_word(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("wake_word must not be blank")
        return value

    # Phase 3: voice models (Whisper STT, Piper TTS) load LAZILY on first
    # use by default — no multi-GB model load at server startup. Set True
    # (or JARVIS_PRELOAD_MODELS=1) to restore the old background preload
    # for instant first STT/TTS at the cost of slower startup + VRAM held
    # from boot.
    # Phase 4: STT language. The user speaks Arabic, so the default is
    # "ar" — Whisper transcribes Arabic and the initial prompt biases it
    # toward assistant vocabulary in that language. Set to "en" (or pass
    # ?language=en to /api/stt) for English. "auto" lets Whisper detect.
    stt_language: str = "ar"
    # Override the Whisper initial_prompt. None → language-appropriate
    # default from jarvis/models/whisper.py (Arabic when stt_language
    # starts with "ar", English otherwise).
    stt_initial_prompt: str | None = None
    preload_models: bool = False
    provider: str = "auto"  # auto | piper | edge_tts | nvidia_riva
    edge_voice: str = "ar-SA-HamedNeural"  # Hamed Neural (Saudi Arabic) — default voice
    edge_rate: str = "-6%"
    edge_pitch: str = "+0Hz"
    # af-only voice fields (ui values kept where they conflict: provider
    # "auto", edge_rate "-6%", piper_enabled True, piper_length_scale 1.0).
    edge_voice_en: str = "en-GB-ThomasNeural"
    chat_language: str = "ar"  # "en" or "ar" - strict language for TTS & STT
    stt_provider: str = "auto"  # auto | web_speech | groq | openai | custom | local
    stt_model: str = "whisper-large-v3-turbo"
    stt_custom_endpoint: str = ""
    stt_custom_api_key: str = ""

    # pyttsx3 (System TTS - espeak/sapi)
    pyttsx3_enabled: bool = True
    pyttsx3_voice: Optional[str] = None
    pyttsx3_rate: int = 150
    pyttsx3_volume: float = 0.9
    # Piper (community JARVIS model, closest to Paul Bettany).
    # ENGLISH-ONLY model — Arabic text skips Piper (see jarvis/models/tts.py).
    piper_enabled: bool = True  # mirrors config.yaml
    piper_model: str = "data/voices/jarvis.onnx"
    piper_speaker: int = 0
    piper_length_scale: float = 1.0  # mirrors config.yaml
    piper_noise_scale: float = 0.55
    piper_noise_w_scale: float = 0.72
    piper_volume: float = 1.15
    riva_enabled: bool = False
    riva_server: str = "grpc.nvcf.nvidia.com:443"  # mirrors config.yaml
    riva_voice: str = "Magpie-Multilingual.EN-US.Leo"  # mirrors config.yaml
    riva_language_code: str = "en-US"
    riva_sample_rate_hz: int = 44100
    nvidia_waveglow_model_url: str = (
        "https://catalog.ngc.nvidia.com/orgs/nvidia/teams/tlt-jarvis/"
        "models/speechsynthesis_waveglow?version=deployable_v1.0"
    )


class VadConfig(BaseModel):
    """Voice Activity Detection (VAD) configuration.

    Controls both frontend (browser MediaRecorder) and backend (Silero VAD in faster-whisper)
    voice activity detection to reduce false positives from background noise.
    """
    # Frontend VAD parameters (JarvisMic in voice.ts)
    silence_threshold: float = 0.08           # Floor below which audio counts as silence (was 0.05)
    silence_timeout_ms: int = 700             # Silence this long = end of utterance (was 600)
    min_recording_ms: int = 600               # Ignore clips shorter than this (was 500)
    max_recording_ms: int = 8000              # Force-flush clips longer than this (was 6000)
    baseline_window_ms: int = 1200            # Learn ambient noise level over this window (was 800)
    baseline_multiplier: float = 2.2          # Require level > baseline * mult to count as voice (was 1.8)

    # Backend Silero VAD parameters (faster-whisper)
    silero_threshold: float = 0.5             # Silero VAD threshold 0-1 (was 0.45)
    silero_min_silence_duration_ms: int = 500 # Min silence duration for Silero (was 400)

    # Barge-in (interrupt JARVIS while speaking) parameters
    barge_in_multiplier: float = 3.5          # Voice must exceed baseline * this (was 3.2)
    barge_in_floor: float = 0.15              # And clear this absolute level (was 0.12)
    barge_in_sustain_ms: int = 250            # For this long continuously (was 180)

    # STT post-processing
    stt_coalesce_ms: int = 500                # Buffer submissions this long, join consecutive clips (was 350)

    # Hallucination filtering (applied both frontend and backend)
    hallucination_filter_enabled: bool = True
    filler_filter_enabled: bool = True


class Config(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, protected_namespaces=())

    A: AssistantConfig = Field(default_factory=AssistantConfig)
    model: ModelConfig = Field(default_factory=ModelConfig)
    image_model: ImageModelConfig = Field(default_factory=ImageModelConfig)
    permissions: PermissionsConfig = Field(default_factory=PermissionsConfig)
    ui: UIConfig = Field(default_factory=UIConfig)
    memory: MemoryConfig = Field(default_factory=MemoryConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)
    backups: BackupConfig = Field(default_factory=BackupConfig)
    code_execution: CodeExecConfig = Field(default_factory=CodeExecConfig)
    project: ProjectConfig = Field(default_factory=ProjectConfig)
    plugins: dict[str, PluginToggle] = Field(default_factory=dict)
    agents: dict[str, PluginToggle] = Field(default_factory=dict)
    mission: MissionConfig = Field(default_factory=MissionConfig)
    voice: VoiceConfig = Field(default_factory=VoiceConfig)
    vad: VadConfig = Field(default_factory=VadConfig)
    ultimate: UltimateConfig = Field(default_factory=UltimateConfig)
    integrations: IntegrationsConfig = Field(default_factory=IntegrationsConfig)

    project_root: Path = PROJECT_ROOT

    def abs_path(self, rel: str) -> Path:
        p = Path(rel)
        return p if p.is_absolute() else (self.project_root / p)


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in override.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _load_persona_text(cfg_path: Path, raw: dict[str, Any], cfg: Config) -> None:
    """Fill `cfg.A.persona` from `persona/jarvis.md` when no inline persona
    was given in the config file.

    Precedence: inline `A.persona:` in config.yaml > file named by
    `A.persona_file:` (resolved against the config file's directory, then
    the project root) > the short built-in fallback in `AssistantConfig`.
    A missing/unreadable file is not an error — the fallback stands.
    """
    raw_a = raw.get("A")
    if isinstance(raw_a, dict) and "persona" in raw_a:
        return
    candidate = Path((raw_a or {}).get("persona_file") or cfg.A.persona_file)
    bases = [cfg_path.parent, PROJECT_ROOT] if not candidate.is_absolute() else [Path("/")]
    for base in bases:
        persona_path = candidate if candidate.is_absolute() else base / candidate
        try:
            if persona_path.is_file():
                text = persona_path.read_text(encoding="utf-8").strip()
                if text:
                    cfg.A.persona = text
                return
        except OSError:
            continue


def load_config(path: Path | None = None) -> Config:
    if DEFAULT_ENV_PATH.exists():
        load_dotenv(DEFAULT_ENV_PATH)

    cfg_path = path or DEFAULT_CONFIG_PATH
    raw: dict[str, Any] = {}
    if cfg_path.exists():
        with cfg_path.open("r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}

    cfg = Config(**raw)
    _load_persona_text(cfg_path, raw, cfg)
    return cfg


# ── ${VAR} expansion (audit/fixes) ────────────────────────────────────
# Regex to match ${VAR} or ${VAR:-default} patterns
_ENV_VAR_PATTERN = re.compile(r"\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}")


def _expand_env_vars(value: Any, env: dict[str, str]) -> Any:
    """Recursively expand ${VAR} and ${VAR:-default} in strings using provided env dict.

    Missing variables resolve to empty string (or the provided default).
    Ported from audit/fixes; NOT wired into load_config — KeyManager
    already expands ${VAR} refs in model.api_keys_pool at brain init,
    and expanding every yaml string at load time would put resolved
    secrets into the Config object (visible to /api/config).
    """
    if isinstance(value, str):
        def repl(m: re.Match) -> str:
            var = m.group(1)
            default = m.group(2) if m.group(2) is not None else ""
            return env.get(var, default)
        # Apply repeatedly until no more matches (handles nested references)
        prev = None
        curr = value
        while prev != curr:
            prev = curr
            curr = _ENV_VAR_PATTERN.sub(repl, curr)
        return curr
    elif isinstance(value, dict):
        return {k: _expand_env_vars(v, env) for k, v in value.items()}
    elif isinstance(value, list):
        return [_expand_env_vars(v, env) for v in value]
    return value


# ── Atomic YAML persistence utility (audit/fixes) ─────────────────────
# In-process lock to prevent concurrent writes from corrupting the file.
# Note: This does NOT protect against multiple processes (e.g., running
# multiple JARVIS instances). For multi-process safety, a file lock or
# external coordination would be required.
_yaml_write_lock = threading.Lock()


def atomic_yaml_write(config_path: Path, data: dict) -> None:
    """Atomically write YAML data to a configuration file.

    This function provides:
    1. Atomic replacement: writes to a temp file, then renames over the target
    2. Data integrity: fsync before rename to ensure data is on disk
    3. In-process concurrency protection: threading.Lock prevents concurrent writes
    4. Permission preservation: copies permissions from the original file
    5. Cleanup: removes abandoned temp files on failure

    Args:
        config_path: Path to the target configuration file
        data: Dictionary to serialize as YAML

    Raises:
        OSError: If the write operation fails
        ValueError: If config_path does not exist

    Note:
        This does NOT protect against multiple processes. If you need
        multi-process safety, implement a file lock (e.g., fcntl.lockf
        on Unix, msvcrt.locking on Windows) or use an external coordination
        mechanism.
    """
    if not config_path.exists():
        raise ValueError(f"Configuration file does not exist: {config_path}")

    # Acquire in-process lock to prevent concurrent writes
    with _yaml_write_lock:
        # Get original file permissions if they exist
        try:
            original_mode = config_path.stat().st_mode
        except OSError:
            original_mode = None

        # Create temp file in the same directory (ensures same filesystem)
        temp_path = config_path.with_suffix(config_path.suffix + ".tmp")

        try:
            # Write to temp file
            with temp_path.open("w", encoding="utf-8") as f:
                yaml.dump(data, f, default_flow_style=False, allow_unicode=True)
                # Flush to ensure data is written to OS buffer
                f.flush()
                # fsync to ensure data is on physical disk
                os.fsync(f.fileno())

            # Preserve original permissions
            if original_mode is not None:
                temp_path.chmod(original_mode)

            # Atomic rename (POSIX guarantees this is atomic)
            temp_path.replace(config_path)

        except Exception as e:
            # Clean up temp file on failure
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except OSError:
                    pass
            raise OSError(f"Failed to atomically write {config_path}: {e}") from e


def atomic_text_write(target_path: Path, text: str, default_mode: int = 0o600) -> None:
    """Atomically write text data to a target file.

    Provides:
    1. Atomic replacement via rename over the target.
    2. fsync to physical storage before rename.
    3. Threading lock and fcntl lock for concurrency safety.
    4. Permission preservation (or default_mode 0600 for secrets).
    5. Clean error recovery and temp-file removal.
    """
    target_path = Path(target_path)
    parent = target_path.parent
    parent.mkdir(parents=True, exist_ok=True)

    with _yaml_write_lock:
        try:
            original_mode = target_path.stat().st_mode
        except OSError:
            original_mode = default_mode

        temp_path = parent / f".{target_path.name}.tmp.{os.getpid()}_{threading.get_ident()}"
        try:
            with temp_path.open("w", encoding="utf-8") as f:
                try:
                    import fcntl
                    fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                except (ImportError, OSError):
                    pass
                f.write(text)
                f.flush()
                os.fsync(f.fileno())

            if original_mode is not None:
                try:
                    temp_path.chmod(original_mode)
                except OSError:
                    pass

            temp_path.replace(target_path)
        except Exception as e:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except OSError:
                    pass
            raise OSError(f"Failed to atomically write {target_path}: {e}") from e
