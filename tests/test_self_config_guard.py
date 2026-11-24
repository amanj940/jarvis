"""Unit tests for the safe self-edit loop and its guard rails.

Covers: syntax-failure rejection (file never written), snapshot+rollback
when the affected tests fail or the backend is unhealthy, protected
paths (guard code, self-healing foundation, watchdog, permissions,
config, secrets, own tests), ambiguous patches, and the kill-switch.
One test runs the REAL pytest subprocess path end to end.
"""
import tempfile
import unittest
from pathlib import Path

from jarvis.plugins.self_config import guard as guard_mod
from jarvis.plugins.self_config.core import apply_self_edit

DEMO_MODULE = '''"""Demo module for self-edit tests."""


def add(a, b):
    return a + b
'''

DEMO_TEST = '''"""Test for the demo module (imported via PYTHONPATH=root)."""
import demo_mod


def test_add():
    assert demo_mod.add(1, 1) == 2
'''


def _unreachable():
    return "unreachable", "health unreachable: refused"


def _unhealthy():
    return "unhealthy", "health returned HTTP 500"


def _tests_pass():
    return True, "pytest test_demo_mod.py: exit=0"


def _tests_fail():
    return False, "pytest test_demo_mod.py: exit=1 :: FAILED test_add"


class TestSelfEditGuard(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        (self.root / "demo_mod.py").write_text(DEMO_MODULE, encoding="utf-8")
        (self.root / "tests").mkdir()
        (self.root / "tests" / "test_demo_mod.py").write_text(
            DEMO_TEST, encoding="utf-8"
        )

    def tearDown(self):
        self._tmp.cleanup()

    def _read_demo(self):
        return (self.root / "demo_mod.py").read_text()

    def test_valid_patch_kept(self):
        res = apply_self_edit(
            self.root, "demo_mod.py",
            "    return a + b\n", "    return a + b  # self-edit test\n",
            reason="test", verify_fn=_unreachable, test_fn=_tests_pass,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["outcome"], "kept_unverified_health")
        self.assertIn("# self-edit test", self._read_demo())

    def test_syntax_failure_rejected_and_file_untouched(self):
        res = apply_self_edit(
            self.root, "demo_mod.py",
            "    return a + b\n", "    return a + b + (\n",
            reason="test", verify_fn=_unreachable, test_fn=_tests_pass,
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["outcome"], "rejected")
        self.assertEqual(self._read_demo(), DEMO_MODULE)

    def test_failing_tests_trigger_rollback(self):
        res = apply_self_edit(
            self.root, "demo_mod.py",
            "    return a + b\n", "    return a + b + 1\n",
            reason="test", verify_fn=_unreachable, test_fn=_tests_fail,
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["outcome"], "rolled_back")
        self.assertEqual(self._read_demo(), DEMO_MODULE)

    def test_unhealthy_backend_triggers_rollback(self):
        res = apply_self_edit(
            self.root, "demo_mod.py",
            "    return a + b\n", "    return a + b  # ok\n",
            reason="test", verify_fn=_unhealthy, test_fn=_tests_pass,
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["outcome"], "rolled_back")
        self.assertEqual(self._read_demo(), DEMO_MODULE)

    def test_real_pytest_path_rolls_back_on_real_failure(self):
        # No injected test_fn: the real pytest subprocess runs
        # tests/test_demo_mod.py, which fails for `a + b + 1`.
        res = apply_self_edit(
            self.root, "demo_mod.py",
            "    return a + b\n", "    return a + b + 1\n",
            reason="test", verify_fn=_unreachable,
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["outcome"], "rolled_back")
        self.assertEqual(self._read_demo(), DEMO_MODULE)
        self.assertIn("tests", res["verification"])

    def test_real_pytest_path_keeps_good_patch(self):
        res = apply_self_edit(
            self.root, "demo_mod.py",
            "    return a + b\n", "    return a + b  # real pytest\n",
            reason="test", verify_fn=_unreachable,
        )
        self.assertTrue(res["ok"])
        self.assertIn("exit=0", res["verification"]["tests"])

    def test_protected_paths_rejected(self):
        for path in (
            "jarvis/plugins/self_config/guard.py",
            "jarvis/plugins/self_config/core.py",
            "jarvis/plugins/self_healing_tools.py",
            "scripts/jarvis_watchdog.sh",
            "jarvis/core/permissions.py",
            "jarvis/config.py",
            "config.yaml",
            ".env",
            "tests/test_self_config.py",
            "tests/test_self_healing_tools.py",
        ):
            res = apply_self_edit(
                self.root, path, "x", "y", reason="test",
                verify_fn=_unreachable, test_fn=_tests_pass,
            )
            self.assertFalse(res["ok"], path)
            self.assertEqual(res["outcome"], "rejected", path)

    def test_ambiguous_old_text_rejected(self):
        (self.root / "demo_mod.py").write_text(
            "x = 1\nx = 1\n", encoding="utf-8"
        )
        res = apply_self_edit(
            self.root, "demo_mod.py", "x = 1\n", "x = 2\n",
            reason="test", verify_fn=_unreachable, test_fn=_tests_pass,
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["outcome"], "rejected")

    def test_missing_file_and_non_python_rejected(self):
        res = apply_self_edit(
            self.root, "nope.py", "x", "y", reason="test",
            verify_fn=_unreachable, test_fn=_tests_pass,
        )
        self.assertEqual(res["outcome"], "rejected")
        res = apply_self_edit(
            self.root, "demo_mod.py", "x", "y", reason="test",
            verify_fn=_unreachable, test_fn=_tests_pass,
        )
        # "x" is not in the demo module -> rejected (old_text not found)
        self.assertEqual(res["outcome"], "rejected")

    def test_kill_switch_blocks_self_edits(self):
        guard_mod.save_state(
            self.root, {"config_changes_enabled": True,
                        "self_code_edits_enabled": False}
        )
        res = apply_self_edit(
            self.root, "demo_mod.py",
            "    return a + b\n", "    return a + b\n",
            reason="test", verify_fn=_unreachable, test_fn=_tests_pass,
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["outcome"], "rejected")
        self.assertEqual(self._read_demo(), DEMO_MODULE)

    def test_audit_log_records_rollback(self):
        from jarvis.plugins.self_config import audit as audit_mod

        apply_self_edit(
            self.root, "demo_mod.py",
            "    return a + b\n", "    return a + b + 1\n",
            reason="bad patch", verify_fn=_unreachable, test_fn=_tests_fail,
        )
        entries = audit_mod.read_audit(self.root, limit=5)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["kind"], "self_edit")
        self.assertEqual(entries[0]["outcome"], "rolled_back")
        self.assertIn("tests", entries[0]["verification"])


if __name__ == "__main__":
    unittest.main()
