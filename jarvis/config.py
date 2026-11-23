"""Configuration loader.

Reads `config.yaml` from the project root, merges in environment variables
from `.env`, validates with Pydantic, and exposes a typed `Config` object.

Source of truth: `config.yaml` wins whenever it is present. The Pydantic
defaults below deliberately mirror `config.yaml`, so a missing or partial
config file behaves exactly like the shipped one. If you change a value in
`config.yaml`, update the matching default here too.

The assistant persona is NOT stored here: it lives in `persona/jarvis.md`
and is loaded by `load_config` (see `AssistantConfig.persona_file`). An
inline `persona:` in `config.yaml` still works and takes precedence.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

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

    @property
    def api_key(self) -> str:
        return os.environ.get(self.api_key_env, "")


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
    persona_file: str = "persona/jarvis.md"


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

    # — Intuitive —
    proactive_suggestions: bool = True

    # — Gorgeous (frontend reads these via /health) —
    reactive_visuals: bool = True


class VoiceConfig(BaseModel):
    wake_word: str = "Hey JARVIS"

    @field_validator("wake_word")
    @classmethod
    def normalize_wake_word(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("wake_word must not be blank")
        return value

    provider: str = "auto"  # auto | piper | edge_tts | nvidia_riva
    edge_voice: str = "en-GB-ThomasNeural"
    edge_rate: str = "-6%"
    edge_pitch: str = "+0Hz"
    # Piper (community JARVIS model, closest to Paul Bettany)
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
    ultimate: UltimateConfig = Field(default_factory=UltimateConfig)

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
