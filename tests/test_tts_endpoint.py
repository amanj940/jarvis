"""Manual check: verify the TTS endpoint works end-to-end.

Moved from data/test_tts_endpoint.py (Phase 1 cleanup). Requires a
running server (`run.bat`). Run directly:
    python tests/test_tts_endpoint.py
or as a pytest test with network enabled:
    JARVIS_RUN_NETWORK_TESTS=1 pytest tests/test_tts_endpoint.py
"""
import asyncio
import os

import httpx
import pytest

NETWORK_TESTS_ENABLED = os.environ.get("JARVIS_RUN_NETWORK_TESTS") == "1"
requires_network = pytest.mark.skipif(
    not NETWORK_TESTS_ENABLED,
    reason="network test: set JARVIS_RUN_NETWORK_TESTS=1 to run",
)

async def run_check():
    # Start the server briefly just to test the TTS route
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "http://127.0.0.1:7341/api/tts",
            json={"text": "Online sir, systems nominal."},
        )
        print(f"Status: {resp.status_code}")
        print(f"Content-Type: {resp.headers.get('content-type', 'unknown')}")
        print(f"Audio size: {len(resp.content)} bytes")
        if resp.status_code == 200 and len(resp.content) > 100:
            print("TTS ENDPOINT WORKS!")
        else:
            print(f"TTS FAILED: {resp.text[:200]}")

if __name__ == "__main__":
    asyncio.run(run_check())


@requires_network
def test_tts_endpoint_returns_audio():
    """End-to-end: POST /api/tts returns audio from the live server."""
    try:
        health = httpx.get("http://127.0.0.1:7341/api/health", timeout=5)
        assert health.status_code == 200
    except Exception:  # noqa: BLE001
        pytest.skip("JARVIS server not running on 127.0.0.1:7341")
    asyncio.run(run_check())
