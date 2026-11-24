"""JARVIS — Autonomous YouTube Channel Growth & Content Engine.

Bridges the JARVIS Multi-Model Brain, Business Agent, and YouTube Studio
to autonomously monitor channel performance, scout high-impact open-source
architectures, and plan/produce educational episodes for 'كود تشريح | Code Anatomy'.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .council import AICouncil
from .memory import Memory

log = logging.getLogger("jarvis.youtube_growth")

DATA_DIR = Path("/home/kozer/AI/JARVIS/data/github_episodes")
DECISIONS_FILE = DATA_DIR / "growth_decisions.json"
HISTORY_FILE = DATA_DIR / "history.json"

AUTHORIZED_ACCOUNT = "amanjrashidismael@gmail.com"
CHANNEL_NAME = "كود تشريح | Code Anatomy"
CHANNEL_ID = "UCuK0gMXVFNidxbLUMi3TG0w"


@dataclass
class YouTubeGrowthDecision:
    id: str
    timestamp: float
    action: str  # "produce_episode", "market_scan", "strategy_update"
    target_repo: str
    pillar: str
    title: str
    rationale: str
    expected_ctr: float
    status: str  # "recommended", "producing", "completed", "failed"
    video_path: str | None = None
    created_at_iso: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class YouTubeAutonomousGrowthEngine:
    """Autonomous engine connecting JARVIS Brain with YouTube Studio growth pipeline."""

    def __init__(
        self,
        brain: Any,
        memory: Memory,
        interval_seconds: int = 1800,  # 30 minutes cycle
        enabled: bool = True,
        auto_produce: bool = False,
    ):
        self.brain = brain
        self.memory = memory
        self.council = AICouncil(brain)
        self.interval_seconds = interval_seconds
        self.enabled = enabled
        self.auto_produce = auto_produce

        self._task: asyncio.Task | None = None
        self._running = False
        self._last_cycle_at: float | None = None
        self._next_cycle_at: float | None = None
        self._cycle_in_progress = False
        self._decisions_history: list[YouTubeGrowthDecision] = []

        self._load_decisions()

    def _load_decisions(self) -> None:
        """Load stored autonomous growth decisions from disk."""
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if DECISIONS_FILE.exists():
            try:
                raw = json.loads(DECISIONS_FILE.read_text("utf-8"))
                for d in raw:
                    self._decisions_history.append(
                        YouTubeGrowthDecision(
                            id=d.get("id", f"yt_{int(time.time())}"),
                            timestamp=d.get("timestamp", time.time()),
                            action=d.get("action", "produce_episode"),
                            target_repo=d.get("target_repo", ""),
                            pillar=d.get("pillar", "تشريح عمالقة الكود"),
                            title=d.get("title", ""),
                            rationale=d.get("rationale", ""),
                            expected_ctr=float(d.get("expected_ctr", 7.5)),
                            status=d.get("status", "recommended"),
                            video_path=d.get("video_path"),
                            created_at_iso=d.get("created_at_iso", ""),
                        )
                    )
            except Exception as e:
                log.warning("Could not read growth decisions file: %s", e)

    def _save_decisions(self) -> None:
        """Persist decision history to disk."""
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        try:
            records = [d.to_dict() for d in self._decisions_history[-30:]]
            DECISIONS_FILE.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            log.error("Failed to save growth decisions: %s", e)

    def start(self) -> None:
        """Start background loop for autonomous channel monitoring."""
        if self._running or (self._task and not self._task.done()):
            return
        self._running = True
        self._task = asyncio.create_task(self._main_loop())
        log.info(
            "YouTube Autonomous Growth Engine started (interval=%ds, enabled=%s, auto_produce=%s)",
            self.interval_seconds,
            self.enabled,
            self.auto_produce,
        )

    def stop(self) -> None:
        """Stop background loop."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
        log.info("YouTube Autonomous Growth Engine stopped.")

    def set_enabled(self, enabled: bool) -> None:
        self.enabled = enabled
        log.info("YouTube Autonomous Growth Engine enabled=%s", enabled)

    def set_auto_produce(self, auto_produce: bool) -> None:
        self.auto_produce = auto_produce
        log.info("YouTube Autonomous Growth Engine auto_produce=%s", auto_produce)

    async def _main_loop(self) -> None:
        """Main periodic loop."""
        # Initial sleep on boot so other systems initialize cleanly
        await asyncio.sleep(45)
        while self._running:
            self._next_cycle_at = time.time() + self.interval_seconds
            try:
                if self.enabled:
                    await self.run_growth_cycle(force_produce=False)
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.error("YouTube Growth Engine cycle error: %s", e)

            # Sleep until next cycle
            sleep_sec = max(30.0, self._next_cycle_at - time.time())
            await asyncio.sleep(sleep_sec)

    async def run_growth_cycle(self, force_produce: bool = False) -> YouTubeGrowthDecision:
        """Execute one autonomous deliberation & content generation cycle."""
        if self._cycle_in_progress:
            log.warning("Growth cycle already in progress, skipping duplicate call.")
            if self._decisions_history:
                return self._decisions_history[-1]

        self._cycle_in_progress = True
        self._last_cycle_at = time.time()
        start_time = time.time()

        try:
            from ..plugins.github_deepdive_producer import GitHubRepoScout

            # 1. Fetch trending repositories
            repos = GitHubRepoScout.fetch_trending_repos()
            history_repos = set()
            if HISTORY_FILE.exists():
                try:
                    hist_data = json.loads(HISTORY_FILE.read_text("utf-8"))
                    for h in hist_data:
                        history_repos.add(h.get("full_name", "").lower())
                        history_repos.add(h.get("repo_name", "").lower())
                except Exception:
                    pass

            # 2. Select top unproduced candidate
            selected_repo = None
            for r in repos:
                if r["full_name"].lower() not in history_repos and r["name"].lower() not in history_repos:
                    selected_repo = r
                    break

            if not selected_repo:
                selected_repo = repos[0] if repos else {
                    "full_name": "vllm-project/vllm",
                    "name": "vLLM",
                    "language": "Python / C++",
                    "description": "High-throughput and memory-efficient LLM serving engine.",
                    "stars": 42000,
                }

            # 3. Consult AI Council / Brain for the best architectural angle and hook
            prompt = (
                f"أنت مستشار النمو وهندسة المحتوى لقناة 'كود تشريح | Code Anatomy' على يوتيوب.\n"
                f"المشروع المرشح للشرح القادم: {selected_repo['full_name']} ({selected_repo.get('language', 'Python')}).\n"
                f"وصف المشروع: {selected_repo.get('description', '')}.\n"
                f"حدد بإيجاز: \n"
                f"1. عنوان جذاب عالي الـ CTR باللغة العربية لا يتجاوز 10 كلمات.\n"
                f"2. ركيزة المحتوى (تشريح عمالقة الكود 45% أو اصنع أداتك من الصفر 35% أو أسرار معمارية 20%).\n"
                f"3. سبب اختيار هذا المشروع من منظور القيمة التقنية والانتشار."
            )

            council_title = f"تشريح معمارية {selected_repo['name']}: الأسرار البرمجية ونظام العمل الداخلي"
            council_rationale = f"مشروع عالي الطلب ({selected_repo.get('stars', 0)} نجمة) يمثل بنية تحتية حرجة."
            council_pillar = "تشريح عمالقة الكود"

            try:
                eval_res = await self.council.evaluate(prompt)
                if eval_res and eval_res.consensus:
                    lines = [ln.strip() for ln in eval_res.consensus.splitlines() if ln.strip()]
                    if lines:
                        council_title = lines[0].replace('"', '').replace("1.", "").strip()
                        if len(lines) > 1:
                            council_rationale = " ".join(lines[1:3])
            except Exception as e:
                log.debug("Council deliberation fallback: %s", e)

            iso_now = datetime.now(timezone.utc).isoformat()
            decision_id = f"dec_{int(time.time())}"

            decision = YouTubeGrowthDecision(
                id=decision_id,
                timestamp=time.time(),
                action="produce_episode",
                target_repo=selected_repo["full_name"],
                pillar=council_pillar,
                title=council_title,
                rationale=council_rationale,
                expected_ctr=8.2,
                status="recommended",
                video_path=None,
                created_at_iso=iso_now,
            )

            # 4. Trigger production if auto_produce or force_produce is enabled
            if self.auto_produce or force_produce:
                log.info("Autonomous video generation triggered for %s...", selected_repo["full_name"])
                decision.status = "producing"
                try:
                    from ..plugins.github_deepdive_producer import LongFormVideoAssembler
                    details = GitHubRepoScout.fetch_repo_details(selected_repo["full_name"])
                    res = await LongFormVideoAssembler.render_full_deepdive(details)
                    if res.get("ok"):
                        decision.status = "completed"
                        decision.video_path = res.get("video_path")
                    else:
                        decision.status = "failed"
                except Exception as ex:
                    log.error("Video assembly error: %s", ex)
                    decision.status = "failed"

            self._decisions_history.append(decision)
            self._save_decisions()

            log.info(
                "YouTube Growth Cycle complete in %.2fs: %s (%s)",
                time.time() - start_time,
                decision.title,
                decision.status,
            )
            return decision

        finally:
            self._cycle_in_progress = False

    def get_status(self) -> dict[str, Any]:
        """Return comprehensive status for frontend and API telemetry."""
        recent = [d.to_dict() for d in self._decisions_history[-10:]]
        recent.reverse()
        return {
            "ok": True,
            "channel_name": CHANNEL_NAME,
            "channel_id": CHANNEL_ID,
            "account": AUTHORIZED_ACCOUNT,
            "is_running": self._running,
            "enabled": self.enabled,
            "auto_produce": self.auto_produce,
            "interval_seconds": self.interval_seconds,
            "last_cycle_at": self._last_cycle_at,
            "next_cycle_at": self._next_cycle_at,
            "cycle_in_progress": self._cycle_in_progress,
            "total_decisions": len(self._decisions_history),
            "latest_decision": recent[0] if recent else None,
            "decisions": recent,
        }
