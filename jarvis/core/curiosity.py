"""JARVIS — Autonomous Curiosity & Closed-Loop Self-Learning Engine.

Unites existing subsystems into ONE complete, continuous closed loop:
1. Gathers context from existing databases (CyberLab DB, memory.db, project_notes).
2. Autonomously formulates high-impact strategic inquiries.
3. Convenes the Multi-Model AI Council (DeepSeek V3, Llama 3.3 70B, Qwen 72B, GPT-OSS 120B, Gemini).
4. Distills the authoritative consensus directly into the local training dataset and memory.
5. Runs 24/7 in the background without requiring user prompts or intervention.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import sqlite3
import time
from dataclasses import dataclass
from typing import Any

from .council import AICouncil
from .dynamic_learning import DynamicLearningBridge
from .memory import Memory

log = logging.getLogger("jarvis.curiosity")


# Curated seed curriculum for frontier knowledge exploration
FRONTIER_CURRICULUM = [
    "كيف تصمم بنية أمان دفاعية متقدمة تكتشف وتمنع ثغرات Server-Side Request Forgery (SSRF) في بيئات السحاب الهجينة؟",
    "ما هي أفضل المعايير المعمارية لاستخدام eBPF لمراقبة الأداء واكتشاف التهديدات اللحظية على نواة Linux؟",
    "كيف تبني نظام استرجاع معلومات هجين (Hybrid Dense + Sparse RAG) مع إعادة الترتيب اللغوي المتقدم باللغة العربية؟",
    "ما هي استراتيجيات هندسة الصيد الأمني لاكتشاف كسر التخويل على مستوى الكائنات (Broken Object Level Authorization - BOLA) في واجهات REST وGraphQL؟",
    "كيف تحقق أقصى استفادة من تقنيات تقطير النماذج (Model Distillation) لنقل قدرات الاستدلال من نماذج 70B و 120B إلى نموذج محلي صغير (1B-3B)؟",
    "ما هي استراتيجيات هندسة الذاكرة طويلة المدى وتقليل الهلوسة في الأنظمة الذكية المستقلة متسلسلة التفكير (Chain-of-Thought Agents)؟",
    "كيفية بناء معمارية مصفوفة المفاتيح الموزعة المقاومة للأخطاء (Fault-Tolerant Key Rotation) لتفادي حدود الـ Rate Limits في السحابة؟",
    "ما هي الفروق الدقيقة والمفاهيم البلاغية والاصطلاحية التي يجب مراعاتها عند ترجمة المصطلحات التقنية المعقدة إلى العربية الفصحى المعاصرة؟",
    "كيف يمكن تحسين زمن وصول الذاكرة (Memory Latency) واستغلال تعليمات SIMD/AVX-512 في بيئات الحوسبة المصغرة على معالجات x86؟",
    "ما هي أحدث أساليب التحقق من أمان بروتوكول OAuth 2.0 والـ JWT لمنع هجمات التلاعب بالمفتاح العام (Key Confusion) وتزوير التوقيع؟",
]


@dataclass
class AutonomousInsight:
    id: str
    topic: str
    consensus: str
    agreement_score: float
    participating_models: list[str]
    timestamp: float
    source: str  # "cyberlab", "memory", "curriculum"


class AutonomousCuriosityEngine:
    """Orchestrates 24/7 autonomous curiosity, deliberation, and knowledge distillation."""

    def __init__(
        self,
        brain: Any,
        memory: Memory,
        learning: DynamicLearningBridge,
        interval_seconds: int = 1200,  # 20 minutes default
        enabled: bool = True,
    ):
        self.brain = brain
        self.memory = memory
        self.learning = learning
        self.interval_seconds = interval_seconds
        self.enabled = enabled
        self.council = AICouncil(brain)

        self._task: asyncio.Task | None = None
        self._running = False
        self._last_cycle_at: float | None = None
        self._next_cycle_at: float | None = None
        self._cycle_in_progress = False
        self._insights_history: list[AutonomousInsight] = []
        self._load_insights_history()

    def _load_insights_history(self) -> None:
        """Load stored autonomous insights from memory."""
        try:
            stored = self.memory.query_entities("autonomous_insights", limit=20)
            for item in stored:
                val = item.get("value", {})
                if isinstance(val, dict) and "topic" in val:
                    self._insights_history.append(
                        AutonomousInsight(
                            id=item.get("key", f"ai_{int(time.time())}"),
                            topic=val.get("topic", ""),
                            consensus=val.get("consensus", ""),
                            agreement_score=val.get("agreement_score", 0.95),
                            participating_models=val.get("participating_models", []),
                            timestamp=val.get("timestamp", time.time()),
                            source=val.get("source", "curriculum"),
                        )
                    )
        except Exception as e:
            log.warning("Could not load stored autonomous insights: %s", e)

    def start(self) -> None:
        """Start the autonomous curiosity background loop."""
        if self._running or (self._task and not self._task.done()):
            return
        self._running = True
        self._task = asyncio.create_task(self._main_loop())
        log.info("Autonomous Curiosity Engine started (interval=%ds, enabled=%s)", self.interval_seconds, self.enabled)

    def stop(self) -> None:
        """Stop the autonomous curiosity loop."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
        log.info("Autonomous Curiosity Engine stopped.")

    def set_enabled(self, enabled: bool) -> None:
        self.enabled = enabled
        log.info("Autonomous Curiosity Engine enabled set to: %s", enabled)

    async def _main_loop(self) -> None:
        """Continuous background execution cycle."""
        # Wait a gentle 30 seconds on initial boot before first check
        await asyncio.sleep(30)
        while self._running:
            self._next_cycle_at = time.time() + self.interval_seconds
            try:
                if self.enabled:
                    await self.run_study_cycle()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.error("Error during autonomous curiosity cycle: %s", e, exc_info=True)

            # Sleep until next scheduled cycle
            try:
                await asyncio.sleep(self.interval_seconds)
            except asyncio.CancelledError:
                break

    async def trigger_cycle_now(self) -> dict[str, Any]:
        """Manually trigger an immediate study cycle."""
        if self._cycle_in_progress:
            return {"ok": False, "message": "Cycle already in progress"}
        res = await self.run_study_cycle()
        return {"ok": True, "insight": res}

    async def run_study_cycle(self) -> dict[str, Any] | None:
        """Execute one complete autonomous curiosity -> council deliberation -> distillation loop."""
        if self._cycle_in_progress:
            log.info("Curiosity cycle already in progress, skipping.")
            return None

        # Verify internet connectivity before launching multi-model council
        if not await self.brain._probe_internet():
            log.info("Autonomous curiosity skipped: system is currently offline.")
            return None

        self._cycle_in_progress = True
        start_t = time.time()
        try:
            # 1. Discover or formulate a strategic inquiry from existing systems
            topic, source = await self._discover_strategic_inquiry()
            log.info("Autonomous Curiosity formulating inquiry [%s]: %s", source, topic[:80])

            # 2. Convene the Multi-Model AI Council across available frontier titan models
            deliberation = await self.council.deliberate(
                topic,
                context=(
                    "هذه جلسة استكشاف ودراسة ذاتية ومستقلة لمجلس الذكاء الاصطناعي (Autonomous Curiosity Loop). "
                    "المطلوب تحليل المسألة بأعلى درجات العمق الهندسي والمنطقي وصياغة قرار موحد ومرجعي "
                    "يُدرج مباشرة في الذاكرة المعرفية ويغذي النموذج المحلي الصغير."
                ),
                full=False,
            )

            if not deliberation or not deliberation.consensus_verdict:
                log.warning("Council produced empty consensus during autonomous cycle.")
                return None

            # 3. Distill consensus into the local learning dataset (dataset.jsonl)
            participating_names = [p.member_name for p in deliberation.proposals]
            member_tags = [f"model_{p.model}" for p in deliberation.proposals]
            self.learning.distill_interaction(
                user_input=topic,
                assistant_output=deliberation.consensus_verdict,
                provider="council_autonomous",
                is_cloud_distillation=True,
                tags=["autonomous", "curiosity", "council_consensus", f"src_{source}"] + member_tags[:4],
            )

            # 4. Save insight into persistent memory.db
            insight_id = f"auto_{int(time.time()*1000)}"
            insight_record = {
                "id": insight_id,
                "topic": topic,
                "consensus": deliberation.consensus_verdict,
                "agreement_score": deliberation.agreement_score,
                "participating_models": participating_names,
                "timestamp": time.time(),
                "source": source,
                "elapsed_seconds": round(time.time() - start_t, 1),
            }

            try:
                self.memory.store_entity("autonomous_insights", insight_id, insight_record, tags=["autonomous", "curiosity", source])
                self.memory.add_note(
                    "curiosity",
                    f"🤖 استكشاف ذاتي مستقل — {topic}\nإجماع النماذج ({int(deliberation.agreement_score*100)}%):\n{deliberation.consensus_verdict[:350]}...",
                    tags=["autonomous", "curiosity"],
                )
            except Exception as me:
                log.warning("Could not persist autonomous insight to memory.db: %s", me)

            insight_obj = AutonomousInsight(
                id=insight_id,
                topic=topic,
                consensus=deliberation.consensus_verdict,
                agreement_score=deliberation.agreement_score,
                participating_models=participating_names,
                timestamp=time.time(),
                source=source,
            )
            self._insights_history.insert(0, insight_obj)
            self._insights_history = self._insights_history[:30]

            self._last_cycle_at = time.time()
            log.info("✓ Autonomous Curiosity cycle completed in %.1fs: '%s'", time.time() - start_t, topic[:60])
            return insight_record

        finally:
            self._cycle_in_progress = False

    async def _discover_strategic_inquiry(self) -> tuple[str, str]:
        """Inspect existing databases (CyberLab, memory, project notes) to find strategic inquiries."""
        choice = random.random()

        # A. CyberLab Assets & Security Vulnerabilities
        if choice < 0.40:
            query_cyber = await self._inquiry_from_cyberlab()
            if query_cyber:
                return query_cyber, "cyberlab"

        # B. Memory DB past notes or frequent commands
        if choice < 0.70:
            query_mem = await self._inquiry_from_memory()
            if query_mem:
                return query_mem, "memory"

        # C. Frontier Curriculum
        return random.choice(FRONTIER_CURRICULUM), "curriculum"

    async def _inquiry_from_cyberlab(self) -> str | None:
        """Inspect cyberlab_db for targets or subdomains."""
        try:
            import subprocess
            res = subprocess.run(
                ["psql", "-U", "postgres", "-d", "cyberlab_db", "-t", "-A", "-c",
                 "SELECT name FROM programs ORDER BY RANDOM() LIMIT 1;"],
                capture_output=True,
                text=True,
                timeout=2,
            )
            if res.returncode == 0 and res.stdout.strip():
                prog_name = res.stdout.strip()
                return f"ما هي منهجية الفحص والاستطلاع الهجومي المتقدم (Asset Reconnaissance & Attack Surface Mapping) لبرنامج صيد ثغرات بحجم «{prog_name}» وما هي أكثر الثغرات شيوعاً فيه؟"
        except Exception:
            pass

        return (
            "ما هي أفضل الممارسات المنهجية لاكتشاف ثغرات الـ Subdomain Takeover وسلاسل الاستغلال المرتبطة بخدمات السحاب المهملة؟"
        )

    async def _inquiry_from_memory(self) -> str | None:
        """Inspect memory.db for past notes."""
        try:
            notes = self.memory.list_notes(limit=10)
            if notes:
                recent_note = random.choice(notes)
                content = recent_note.get("content", "")
                if content and len(content) > 15:
                    return f"تحليل وتطوير معماري معمق مبني على ملاحظات النظام السابقة: «{content[:120]}» — ما هي التوصيات المتقدمة لتطوير هذه الجزئية بأعلى موثوقية؟"
        except Exception:
            pass
        return None

    def get_status(self) -> dict[str, Any]:
        """Return current status of the autonomous curiosity engine."""
        now = time.time()
        time_to_next = max(0, int(self._next_cycle_at - now)) if self._next_cycle_at else None
        last_ago = int(now - self._last_cycle_at) if self._last_cycle_at else None

        return {
            "enabled": self.enabled,
            "running": self._running,
            "in_progress": self._cycle_in_progress,
            "interval_seconds": self.interval_seconds,
            "last_cycle_ago_seconds": last_ago,
            "next_cycle_in_seconds": time_to_next,
            "total_insights_count": len(self._insights_history),
            "recent_insights": [
                {
                    "id": i.id,
                    "topic": i.topic,
                    "consensus_snippet": i.consensus[:250] + ("…" if len(i.consensus) > 250 else ""),
                    "agreement_score": i.agreement_score,
                    "participating_models": i.participating_models,
                    "timestamp": i.timestamp,
                    "source": i.source,
                }
                for i in self._insights_history[:8]
            ],
        }
