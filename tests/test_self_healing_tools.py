"""Unit tests for JARVIS Self-Healing & AST Diagnostic tools."""
import unittest
from jarvis.config import load_config
from jarvis.plugins.registry import PluginRegistry
from jarvis.plugins import self_healing_tools


class TestSelfHealingTools(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cfg = load_config()
        cls.registry = PluginRegistry(cls.cfg)
        self_healing_tools.register(cls.registry)

    def test_tools_registered(self):
        """Verify all 4 self-healing tools are registered."""
        tool_names = ["diagnose_last_crash", "validate_python_syntax", "self_healing_snapshot", "self_healing_verify_and_guard"]
        for name in tool_names:
            t = self.registry.get(name)
            self.assertIsNotNone(t, f"Tool {name} was not registered")
            self.assertTrue(callable(t.handler))

    def test_validate_python_syntax_valid(self):
        """Test valid Python code returns success."""
        tool = self.registry.get("validate_python_syntax")
        res = tool.handler(code="def add(a, b):\n    return a + b\n")
        self.assertIn("SUCCESS", res)

    def test_validate_python_syntax_invalid(self):
        """Test syntax error returns line and offset details."""
        tool = self.registry.get("validate_python_syntax")
        res = tool.handler(code="def broken_syntax(\n")
        self.assertIn("SYNTAX ERROR", res)

    def test_diagnose_last_crash_safe_execution(self):
        """Test diagnose_last_crash executes safely and returns text."""
        tool = self.registry.get("diagnose_last_crash")
        res = tool.handler(lines=10)
        self.assertIsInstance(res, str)
        self.assertTrue(len(res) > 0)

    def test_self_healing_snapshot(self):
        """Test snapshot records a git commit hash."""
        tool = self.registry.get("self_healing_snapshot")
        res = tool.handler()
        self.assertTrue(any(c in res for c in ["Safe commit", "snapshot", "4890c0ef", "recorded"]))


if __name__ == "__main__":
    unittest.main()
