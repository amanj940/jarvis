"""Arabic voice defaults — Hamed Neural (ar-SA-HamedNeural).

Regression tests for the Arabic voice install (2026-11-24):
- config.yaml + code defaults agree: Edge voice is ar-SA-HamedNeural,
  STT language is "ar", and the Arabic persona is the default.
- Arabic text is never routed to the English-only Piper model in auto
  mode; it goes to Edge-TTS (Hamed). English text still may use Piper.
- POST /api/tts no longer has a request-body default that overrides
  config.yaml: resolve_edge_voice() lets config win.

No network, no models, no server: everything here is pure config +
string logic (edge-tts is only exercised by tests/test_tts.py behind
JARVIS_RUN_NETWORK_TESTS=1).
"""
from pathlib import Path

from jarvis.config import Config, load_config
from jarvis.models.tts import (
    JARVIS_TTS_VOICE,
    is_arabic_text,
    resolve_edge_voice,
    should_try_piper,
    should_try_riva,
)

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_default_voice_is_hamed_arabic():
    assert JARVIS_TTS_VOICE == "ar-SA-HamedNeural"


def test_shipped_config_is_arabic():
    cfg = load_config(REPO_ROOT / "config.yaml")
    assert cfg.voice.edge_voice == "ar-SA-HamedNeural"
    assert cfg.voice.stt_language == "ar"
    assert cfg.A.persona_file == "persona/jarvis-ar.md"
    # The Arabic persona file must exist and actually be Arabic.
    persona_path = REPO_ROOT / cfg.A.persona_file
    assert persona_path.exists(), f"missing persona file: {persona_path}"
    assert is_arabic_text(persona_path.read_text(encoding="utf-8"))


def test_code_defaults_mirror_config():
    cfg = Config()  # no config.yaml: Pydantic defaults must match it
    assert cfg.voice.edge_voice == "ar-SA-HamedNeural"
    assert cfg.voice.stt_language == "ar"
    assert cfg.A.persona_file == "persona/jarvis-ar.md"


def test_is_arabic_text():
    assert is_arabic_text("مرحبا جارفيس، كيف حالك؟")
    assert is_arabic_text("Hello مرحبا")  # mixed still counts as Arabic
    assert not is_arabic_text("Good morning, sir.")
    assert not is_arabic_text("")
    assert not is_arabic_text("123 !?. ")


def test_resolve_edge_voice_prefers_config_over_body_default():
    cfg = load_config(REPO_ROOT / "config.yaml")
    # No voice requested (the /api/tts default) → configured Hamed voice.
    assert resolve_edge_voice(None, cfg) == "ar-SA-HamedNeural"
    assert resolve_edge_voice("", cfg) == "ar-SA-HamedNeural"
    assert resolve_edge_voice("   ", cfg) == "ar-SA-HamedNeural"
    # An explicit per-request voice still overrides config.
    assert resolve_edge_voice("en-GB-ThomasNeural", cfg) == "en-GB-ThomasNeural"
    # Empty config value falls back to the Arabic default constant.
    cfg.voice.edge_voice = ""
    assert resolve_edge_voice(None, cfg) == "ar-SA-HamedNeural"


def test_arabic_text_skips_english_only_piper_in_auto_mode():
    cfg = load_config(REPO_ROOT / "config.yaml")
    assert cfg.voice.provider == "auto"
    assert cfg.voice.piper_enabled is True
    # Arabic → Piper must NOT be tried (English-only model).
    assert should_try_piper(cfg, "مرحبا جارفيس") is False
    # English → Piper may still be tried (unchanged behaviour).
    assert should_try_piper(cfg, "Good morning, sir.") is True
    # Explicit provider=piper is a deliberate user override: respected.
    cfg.voice.provider = "piper"
    assert should_try_piper(cfg, "مرحبا جارفيس") is True


def test_arabic_text_skips_english_riva_in_auto_mode():
    cfg = load_config(REPO_ROOT / "config.yaml")
    cfg.voice.riva_enabled = True  # pretend Riva is enabled
    assert should_try_riva(cfg, "مرحبا جارفيس") is False
    assert should_try_riva(cfg, "Good morning, sir.") is True
    cfg.voice.provider = "nvidia_riva"
    assert should_try_riva(cfg, "مرحبا جارفيس") is True
