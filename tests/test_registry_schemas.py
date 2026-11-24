"""Tests for PluginRegistry.schemas always_include pinning, the get/get_service
name split, and ESSENTIAL_CORE_TOOLS pinning essential tools.

Regression coverage for the bug where computer-use tools were evicted from
the LLM tool list mid-chain, causing "unknown tool" failures on later hops.

NOTE (2026-11-24, merge): no plugin anywhere in the repo registers a tool
named "computer" — the unified computer-use plugin was never landed; only
the ESSENTIAL_CORE_TOOLS entry and the original version of these tests were
written. The behavioural assertions below therefore use tools that ARE
registered and essential (``run_shell``) instead of ``computer``.
``ESSENTIAL_CORE_TOOLS`` still lists ``computer`` (and ``remember`` /
``recall`` / ``desktop_*`` / ``chrome_open_url``) as design intent for
that future plugin — see test_01's intent assertion. The missing
unified computer-tool plugin itself remains a gap for future work.
"""
import unittest

from jarvis.config import load_config
from jarvis.plugins.base import Tool
from jarvis.plugins.registry import PluginRegistry


def _tool(name: str) -> Tool:
    return Tool(
        name=name,
        description=f"{name} description",
        parameters={"type": "object", "properties": {}},
        handler=lambda **kw: kw,
    )


class TestRegistrySchemas(unittest.TestCase):
    def setUp(self):
        self.cfg = load_config()
        self.reg = PluginRegistry(self.cfg)
        self.reg.load_all()

    def test_01_computer_is_essential_and_selected_by_default(self):
        """An essential tool must survive schema selection even for an
        unrelated query, because it is in ESSENTIAL_CORE_TOOLS.

        Uses ``run_shell``: it is both essential AND actually
        registered. (The original assertion used ``computer``, but no
        plugin registers a ``computer`` tool — see the module docstring.
        ``computer`` remains in ESSENTIAL_CORE_TOOLS only as design
        intent for the future unified computer-use plugin.)
        """
        # Design intent is unchanged: the future computer tool stays listed.
        self.assertIn("computer", PluginRegistry.ESSENTIAL_CORE_TOOLS)
        # Behavioural check on a tool that really exists:
        self.assertIn("run_shell", PluginRegistry.ESSENTIAL_CORE_TOOLS)
        names = {s["name"] for s in self.reg.schemas(
            query="Find the price on this tab and sign up", max_tools=5)}
        self.assertIn("run_shell", names)

    def test_02_always_include_pins_tool_with_small_budget(self):
        """always_include tools are pinned even when max_tools is tiny, and
        consume slots against the budget."""
        self.reg.add(_tool("desktop_press_key"))
        names = {
            s["name"]
            for s in self.reg.schemas(
                query="unrelated words",
                max_tools=2,
                always_include={"desktop_press_key"},
            )
        }
        self.assertIn("desktop_press_key", names)

    def test_03_always_include_never_exceeds_max_tools(self):
        """Pinned tools consume slots: total result never exceeds max_tools."""
        self.reg.add(_tool("desktop_press_key"))
        schemas = self.reg.schemas(
            query="unrelated words",
            max_tools=3,
            always_include={"desktop_press_key"},
        )
        self.assertLessEqual(len(schemas), 3)
        self.assertIn("desktop_press_key", {s["name"] for s in schemas})

    def test_04_get_returns_tool_and_unknown_returns_none(self):
        """get() resolves tools only; unknown names return None (no longer
        falls through to services)."""
        self.assertIsNone(self.reg.get("definitely_not_a_tool"))
        self.assertIsNone(self.reg.get("memory"))  # service name is NOT a tool
        # 'computer' was asserted here originally, but no plugin registers
        # it (see module docstring); resolve a real registered tool instead.
        tool = self.reg.get("run_shell")
        self.assertIsNotNone(tool)
        self.assertEqual(tool.name, "run_shell")

    def test_05_get_service_resolves_services(self):
        """get_service() resolves registered services with optional default."""
        sentinel = object()
        self.reg.services["memory"] = sentinel
        self.assertIs(self.reg.get_service("memory"), sentinel)
        self.assertIsNone(self.reg.get_service("missing"))
        self.assertEqual(self.reg.get_service("missing", 42), 42)
        # __getitem__ still works for services
        self.assertIs(self.reg["memory"], sentinel)

    def test_06_max_tools_zero_returns_all(self):
        """max_tools=0 means 'no limit' (used by the full-system audit)."""
        all_names = {t.name for t in self.reg.all_tools()}
        schema_names = {s["name"] for s in self.reg.schemas(max_tools=0)}
        self.assertEqual(all_names, schema_names)


if __name__ == "__main__":
    unittest.main()
