"""Dynamic Learning Bridge for JARVIS.

Handles continuous learning, knowledge distillation, and Arabic/English
language handling only.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Optional

from ..config import Config
from .memory import Memory, redact_sensitive_data

log = logging.getLogger("jarvis.learning")

ARABIC_CHAR_REGEX = re.compile(r"[\u0600-\u06FF]")


class DynamicLearningBridge:
    def __init__(self, cfg: Config, memory: Memory):
        self.cfg = cfg
        self.memory = memory
        self.learning_dir = Path(cfg.project_root) / "data" / "learning"
        self.learning_dir.mkdir(parents=True, exist_ok=True)
        self.dataset_path = self.learning_dir / "dataset.jsonl"

    # ------------------------------------------------------------------
    # 1. Language Detection & Handling
    # ------------------------------------------------------------------
    def detect_language(self, text: str) -> str:
        """Detect language: 'arabic' or 'english' only."""
        if not text or not text.strip():
            return "arabic"

        arabic_chars = len(ARABIC_CHAR_REGEX.findall(text))
        if arabic_chars > len(text) * 0.25:
            return "arabic"
        return "english"

    def get_language_directive(self, text: str) -> str:
        """Return dynamic language directive based on detected language."""
        return ""

    # ------------------------------------------------------------------
    # 2. Knowledge Distillation & Storing
    # ------------------------------------------------------------------
    def distill_interaction(
        self,
        user_input: str,
        assistant_output: str,
        provider: str = "local",
        is_cloud_distillation: bool = False,
        tags: list[str] | None = None,
    ) -> None:
        """Extract actionable learning nuggets and store in memory.db and jsonl."""
        if not user_input or not assistant_output:
            return
        if "[brain error]" in assistant_output:
            return

        lang = self.detect_language(user_input)
        cleaned_user = redact_sensitive_data(user_input.strip())
        cleaned_reply = redact_sensitive_data(assistant_output.strip())

        entry = {
            "instruction": cleaned_user,
            "output": cleaned_reply,
            "language": lang,
            "provider": provider,
            "timestamp": time.time(),
            "is_distilled": is_cloud_distillation,
            "tags": tags or [lang],
        }

        record_key = f"{int(time.time())}_{abs(hash(cleaned_user)) % 100000}"
        self.memory.store_entity(
            collection="distilled_knowledge",
            key=record_key,
            data=entry,
            tags=["learning", lang] + (["cloud_distilled"] if is_cloud_distillation else []),
        )

        try:
            with self.dataset_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception as e:
            log.warning("Could not append to learning dataset %s: %s", self.dataset_path, e)

    # ------------------------------------------------------------------
    # 3. Dynamic Context Retrieval
    # ------------------------------------------------------------------
    def get_dynamic_context(self, query: str) -> str:
        """Retrieve relevant distilled facts and rules for Arabic/English."""
        blocks: list[str] = []
        try:
            recent_distilled = self.memory.query_entities("distilled_knowledge", limit=4)
            relevant_facts: list[str] = []
            query_words = set(re.findall(r"\w+", query.lower()))
            for item in recent_distilled:
                d = item.get("data", {})
                instr = d.get("instruction", "")
                out = d.get("output", "")
                instr_words = set(re.findall(r"\w+", instr.lower()))
                if len(query_words & instr_words) >= 2 or d.get("is_distilled"):
                    relevant_facts.append(f"Q: {instr[:100]}...\n  A: {out[:150]}...")
            if relevant_facts:
                blocks.append("DISTILLED KNOWLEDGE (قواعد وخلاصات مستفادة سابقاً):\n" + "\n".join(relevant_facts[:3]))
        except Exception as e:
            log.debug("Error querying dynamic context: %s", e)
        return "\n\n".join(blocks)

    # ------------------------------------------------------------------
    # 4. 24/7 Background Daemon Consolidation
    # ------------------------------------------------------------------
    async def start_background_loop(self) -> None:
        """Run periodic memory consolidation."""
        log.info("24/7 Dynamic Learning & Distillation Daemon activated.")
        while True:
            try:
                await asyncio.sleep(1800)
                await self.consolidate_memories()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.warning("Background learning loop error: %s", e)
                await asyncio.sleep(60)

    async def consolidate_memories(self) -> dict[str, Any]:
        """Consolidate recent memories and report simple metrics."""
        stats = {"pruned_chatter": 0, "distilled_pairs": 0}
        try:
            if self.dataset_path.exists():
                with self.dataset_path.open("r", encoding="utf-8") as f:
                    stats["distilled_pairs"] = sum(1 for _ in f)
            self.memory.set_pref("last_learning_consolidation", str(time.time()))
        except Exception as e:
            log.warning("Memory consolidation error: %s", e)
        return stats

    def get_status(self) -> dict[str, Any]:
        """Return status metrics for the learning bridge."""
        total_distilled = 0
        if self.dataset_path.exists():
            try:
                with self.dataset_path.open("r", encoding="utf-8") as f:
                    total_distilled = sum(1 for _ in f)
            except Exception:
                pass
        return {
            "status": "active_24_7",
            "total_distilled_records": total_distilled,
            "supported_languages": ["arabic", "english"],
            "last_consolidation": self.memory.get_pref("last_learning_consolidation") or "Never",
            "dataset_path": str(self.dataset_path),
        }
