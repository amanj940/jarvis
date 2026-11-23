"""Manual check: verify Edge TTS synthesis works.

Moved from data/test_tts.py (Phase 1 cleanup). Run directly:
    python tests/test_tts.py
or as a pytest test with network enabled:
    JARVIS_RUN_NETWORK_TESTS=1 pytest tests/test_tts.py
"""
import asyncio
import os

import pytest

edge_tts = pytest.importorskip("edge_tts")

NETWORK_TESTS_ENABLED = os.environ.get("JARVIS_RUN_NETWORK_TESTS") == "1"
requires_network = pytest.mark.skipif(
    not NETWORK_TESTS_ENABLED,
    reason="network test: set JARVIS_RUN_NETWORK_TESTS=1 to run",
)

async def run_check():
    c = edge_tts.Communicate("Test audio from JARVIS", voice="en-GB-RyanNeural", rate="-8%", pitch="-10Hz")
    data = b""
    async for chunk in c.stream():
        if chunk["type"] == "audio":
            data += chunk["data"]
    print(f"Audio generated: {len(data)} bytes")
    if len(data) > 0:
        print("TTS OK - edge_tts is working")
    else:
        print("TTS FAIL - no audio data generated")

if __name__ == "__main__":
    asyncio.run(run_check())


@requires_network
def test_edge_tts_synthesizes_audio():
    """End-to-end: Edge TTS returns non-empty audio bytes."""
    asyncio.run(run_check())
