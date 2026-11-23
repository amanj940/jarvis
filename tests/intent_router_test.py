"""Fixtures for the deterministic intent router (jarvis/core/intent_router.py).

Scaffolded in Phase 1 cleanup — the router's module docstring promised this
file ("Add a fixture under `tests/intent_router_test.py` (todo: scaffold)").
These tests pin the routing contract the LLM must not override: information
needs go to `web_search`, pictures to `image_search`, videos to
`video_search`, and so on. They import only the router (via brain.ToolCall),
so they run with no model, no network, and no server.
"""
import unittest

from jarvis.core.intent_router import classify, classify_multi, list_intents


class IntentRouterTests(unittest.TestCase):
    def assert_routes(self, text, intent, tool):
        match = classify(text)
        self.assertIsNotNone(match, f"expected {intent} for: {text!r}")
        self.assertEqual(match.name, intent)
        self.assertEqual(match.tool_call.name, tool)

    def test_web_search_wins_for_information_needs(self):
        # The router's founding example: never a visible browser for info.
        self.assert_routes("search for the latest news on Elon Musk", "web_search", "web_search")
        self.assert_routes("populate the latest news on Elon Musk", "web_search", "web_search")

    def test_image_search(self):
        self.assert_routes("show me pictures of cats", "image_search", "image_search")
        self.assert_routes("find photos of a chrome helmet", "image_search", "image_search")

    def test_video_search(self):
        self.assert_routes("show me videos of cats", "video_search", "video_search")
        self.assert_routes("play a video of the moon landing", "video_search", "video_search")

    def test_image_generation_is_not_image_search(self):
        self.assert_routes("generate an image of a chrome helmet", "image_generate", "image_generate")
        self.assert_routes("draw a picture of a robot", "image_generate", "image_generate")

    def test_system_and_file_intents(self):
        self.assert_routes("system status", "system_status", "system_status")
        self.assert_routes("create a folder called test", "create_folder", "mkdir")
        self.assert_routes("list desktop", "list_desktop", "list_dir")

    def test_memory_and_vision_intents(self):
        self.assert_routes("show me my memory galaxy", "memory_galaxy", "memory_galaxy")
        self.assert_routes("look at me", "webcam_see", "webcam_see")

    def test_no_match_returns_none(self):
        for text in ["", "   ", "hello there, how are you", "good morning"]:
            with self.subTest(text=text):
                self.assertIsNone(classify(text))

    def test_compound_requests_fan_out(self):
        matches = classify_multi("1: search for cats\n2: show me pictures of dogs")
        self.assertIsNotNone(matches)
        self.assertEqual([m.name for m in matches], ["web_search", "image_search"])

    def test_single_command_is_not_multi(self):
        self.assertIsNone(classify_multi("search for cats"))

    def test_list_intents_is_unique_and_described(self):
        intents = list_intents()
        self.assertGreater(len(intents), 10)
        names = [i["name"] for i in intents]
        self.assertEqual(len(names), len(set(names)), "intent names must be unique")
        for intent in intents:
            self.assertTrue(intent["pattern"], intent["name"])
            self.assertTrue(intent["description"], intent["name"])


if __name__ == "__main__":
    unittest.main()
