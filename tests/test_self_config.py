"""Unit tests for the JARVIS self-configuration system.

Covers the allowlist (rejection of permissions/secrets/unknown keys and
out-of-range values), snapshot+rollback on a failing change, and the
audit log. Health is injected via ``verify_fn`` so no live backend is
needed: ("unreachable", ...) simulates the backend not running,
("unhealthy", ...) simulates a live-but-broken backend.
"""
import unittest
from pathlib import Path

import yaml

from jarvis.config import load_config
from jarvis.plugins import self_config, self_healing_tools
from jarvis.plugins.registry import PluginRegistry
from jarvis.plugins.self_config import audit as audit_mod
from jarvis.plugins.self_config import guard as guard_mod
from jarvis.plugins.self_config.allowlist import is_allowed, validate_value
from jarvis.plugins.self_config.core import apply_config_change

MINIMAL_CONFIG = """\
model:
  temperature: 0.3
  max_tokens: 16384
voice:
  edge_voice: ar-SA-HamedNeural
ui:
  theme: jarvis
"""


def _unreachable():
    return "unreachable", "http://127.0.0.1:7341/api/health unreachable: refused"


def _unhealthy():
    return "unhealthy", "http://127.0.0.1:7341/api/health returned HTTP 500"


def _healthy():
    return "ok", "http://127.0.0.1:7341/api/health returned 200"


class TestAllowlist(unittest.TestCase):
    def test_rejects_permissions_mode(self):
        ok, _ = is_allowed("permissions.mode")
        self.assertFalse(ok)

    def test_rejects_secrets_and_endpoints(self):
        for key in (
            "model.api_key_env",
            "model.api_keys_pool",
            "model.endpoint",
            "model.fallback_endpoint",
            "integrations.telegram.bot_token",
            "integrations.youtube.client_secret",
            "voice.stt_custom_api_key",
        ):
            ok, _ = is_allowed(key)
            self.assertFalse(ok, key)

    def test_rejects_unknown_keys(self):
        for key in ("model.nonexistent", "frobnicate", "memory.db_path",
                    "code_execution.workdir", "mission.project_path"):
            ok, _ = is_allowed(key)
            self.assertFalse(ok, key)

    def test_allows_safe_keys(self):
        for key in ("model.temperature", "voice.edge_voice", "ui.theme",
                    "logging.level", "ultimate.recall_k",
                    "plugins.shell_tools.enabled"):
            ok, _ = is_allowed(key)
            self.assertTrue(ok, key)

    def test_rejects_out_of_range_and_wrong_types(self):
        with self.assertRaises(ValueError):
            validate_value("model.temperature", 5.0)
        with self.assertRaises(ValueError):
            validate_value("model.temperature", "hot")
        with self.assertRaises(ValueError):
            validate_value("model.max_tokens", True)  # bool is not an int
        with self.assertRaises(ValueError):
            validate_value("voice.provider", "skynet")
        with self.assertRaises(ValueError):
            validate_value("ui.emoji", "yes please")

    def test_accepts_valid_values(self):
        self.assertEqual(validate_value("model.temperature", 0.5), 0.5)
        self.assertEqual(validate_value("ui.emoji", "true"), True)
        self.assertEqual(validate_value("voice.provider", "edge_tts"), "edge_tts")


class TestSelfConfigChange(unittest.TestCase):
    def setUp(self):
        import tempfile

        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        (self.root / "config.yaml").write_text(MINIMAL_CONFIG, encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def _read(self):
        return yaml.safe_load((self.root / "config.yaml").read_text())

    def test_change_kept_when_health_unreachable_but_schema_ok(self):
        # Backend not running: the change is kept, but the outcome says
        # plainly that no live health check ran (no hallucination).
        res = apply_config_change(
            self.root, "model.temperature", 0.5,
            reason="test", verify_fn=_unreachable,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["outcome"], "kept_unverified_health")
        self.assertEqual(self._read()["model"]["temperature"], 0.5)

    def test_change_kept_when_health_ok(self):
        res = apply_config_change(
            self.root, "voice.edge_voice", "en-GB-ThomasNeural",
            reason="test", verify_fn=_healthy,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["outcome"], "kept")
        self.assertEqual(
            self._read()["voice"]["edge_voice"], "en-GB-ThomasNeural"
        )

    def test_rollback_on_unhealthy_backend(self):
        res = apply_config_change(
            self.root, "model.temperature", 0.9,
            reason="test", verify_fn=_unhealthy,
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["outcome"], "rolled_back")
        # The old value is back — the rollback actually restored the file.
        self.assertEqual(self._read()["model"]["temperature"], 0.3)

    def test_rejected_keys_leave_file_untouched(self):
        before = (self.root / "config.yaml").read_text()
        for key, value in (
            ("permissions.mode", "auto"),
            ("model.api_key_env", "EVIL_KEY"),
            ("model.temperature", 99.0),
        ):
            res = apply_config_change(
                self.root, key, value, reason="test", verify_fn=_healthy
            )
            self.assertFalse(res["ok"], key)
            self.assertEqual(res["outcome"], "rejected", key)
        self.assertEqual((self.root / "config.yaml").read_text(), before)

    def test_persona_file_must_exist(self):
        res = apply_config_change(
            self.root, "A.persona_file", "persona/does-not-exist.md",
            reason="test", verify_fn=_healthy,
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["outcome"], "rejected")

    def test_kill_switch_blocks_config_changes(self):
        guard_mod.save_state(
            self.root, {"config_changes_enabled": False,
                        "self_code_edits_enabled": True}
        )
        res = apply_config_change(
            self.root, "model.temperature", 0.5,
            reason="test", verify_fn=_healthy,
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["outcome"], "rejected")
        self.assertEqual(self._read()["model"]["temperature"], 0.3)

    def test_audit_log_records_kept_and_rolled_back(self):
        apply_config_change(
            self.root, "model.temperature", 0.5, reason="kept one",
            verify_fn=_unreachable,
        )
        apply_config_change(
            self.root, "model.temperature", 0.9, reason="rolled one",
            verify_fn=_unhealthy,
        )
        entries = audit_mod.read_audit(self.root, limit=10)
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["outcome"], "kept_unverified_health")
        self.assertEqual(entries[1]["outcome"], "rolled_back")
        self.assertEqual(entries[0]["kind"], "config_change")
        self.assertIn("kept one", entries[0]["reason"])


class TestSelfConfigToolsRegistered(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cfg = load_config()
        cls.registry = PluginRegistry(cls.cfg)
        self_healing_tools.register(cls.registry)
        self_config.register(cls.registry)

    def test_new_tools_registered(self):
        for name in (
            "self_config_change",
            "self_config_status",
            "self_config_set_enabled",
            "self_edit_propose",
            "self_config_audit_log",
        ):
            tool = self.registry.get(name)
            self.assertIsNotNone(tool, f"Tool {name} was not registered")
            self.assertTrue(callable(tool.handler))

    def test_existing_self_healing_tools_still_registered(self):
        for name in (
            "diagnose_last_crash",
            "validate_python_syntax",
            "self_healing_snapshot",
            "self_healing_verify_and_guard",
            "self_healing_guard_status",
        ):
            self.assertIsNotNone(self.registry.get(name), name)

    def test_status_tool_reports_kill_switch(self):
        tool = self.registry.get("self_config_status")
        res = tool.handler()
        self.assertIn("config_changes_enabled: True", res)
        self.assertIn("self_code_edits_enabled: True", res)

    def test_guard_status_tool_is_read_only(self):
        tool = self.registry.get("self_healing_guard_status")
        res = tool.handler()
        self.assertIn("watchdog:", res)
        self.assertIn("safe_commit:", res)
        self.assertIn("health:", res)

    def test_plugin_discovered_by_load_all(self):
        registry = PluginRegistry(load_config())
        registry.load_all()
        self.assertIsNotNone(registry.get("self_config_change"))
        self.assertIsNotNone(registry.get("self_edit_propose"))


if __name__ == "__main__":
    unittest.main()
