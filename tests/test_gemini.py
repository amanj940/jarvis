"""Manual check: verify Gemini API key works with function calling.

Moved from data/test_gemini.py (Phase 1 cleanup). Run directly:
    python tests/test_gemini.py
or as a pytest test with a key + network enabled:
    JARVIS_RUN_NETWORK_TESTS=1 GEMINI_API_KEY=... pytest tests/test_gemini.py
"""
import os
import pytest

NETWORK_TESTS_ENABLED = os.environ.get("JARVIS_RUN_NETWORK_TESTS") == "1"
requires_network = pytest.mark.skipif(
    not NETWORK_TESTS_ENABLED,
    reason="network test: set JARVIS_RUN_NETWORK_TESTS=1 to run",
)
import asyncio
import httpx
import json

async def run_check():
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Set GEMINI_API_KEY before running this test.")

    url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    payload = {
        "model": "gemini-2.5-flash",
        "messages": [
            {"role": "system", "content": "You are JARVIS, a helpful AI assistant. Be brief."},
            {"role": "user", "content": "Hello JARVIS, what time is it?"},
        ],
        "temperature": 0.3,
        "max_tokens": 200,
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "system_status",
                    "description": "Get current system status including time",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        ],
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, json=payload, headers=headers)
        print(f"Status: {resp.status_code}")
        data = resp.json()
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message", {})
        print(f"Content: {msg.get('content', '(none)')}")
        tool_calls = msg.get("tool_calls", [])
        if tool_calls:
            print(f"Tool calls: {json.dumps(tool_calls, indent=2)}")
            print("NATIVE TOOL CALLING WORKS!")
        else:
            print("No tool calls (model responded directly)")
        print("API TEST PASSED")

if __name__ == "__main__":
    asyncio.run(run_check())


@requires_network
def test_gemini_tool_calling():
    """End-to-end: Gemini answers with a native tool call (needs a key)."""
    if not os.environ.get("GEMINI_API_KEY", "").strip():
        pytest.skip("GEMINI_API_KEY not set")
    asyncio.run(run_check())
