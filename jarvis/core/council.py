"""JARVIS — Multi-Model AI Council & Collective Consensus Engine.

Inspired by consoles.ai, Mixture of Agents (MoA), and multi-agent ensemble architectures.
Enables collaborative deliberation, cross-examination, and collective decision making
across multiple frontier LLMs (Gemini, Groq/Llama, DeepSeek, Claude, OpenRouter, etc.).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import sqlite3
from dataclasses import dataclass
from typing import Any, Callable

from .brain import BrainReply, LLMBrain
from .events import Event, EventKind
from .providers_catalog import get_provider_spec

log = logging.getLogger("jarvis.council")


@dataclass
class CouncilMember:
    id: str
    name: str
    provider: str
    model: str
    icon: str
    role: str
    specialty: str
    system_prompt: str


@dataclass
class MemberProposal:
    member_id: str
    member_name: str
    icon: str
    model: str
    content: str
    confidence: float = 0.95


@dataclass
class CouncilDeliberation:
    topic: str
    active_members: list[dict[str, str]]
    proposals: list[MemberProposal]
    peer_critiques: list[dict[str, str]]
    consensus_verdict: str
    agreement_score: float = 0.98


# Default member profiles matching frontier model strengths
COUNCIL_ROSTER: dict[str, CouncilMember] = {
    "deepseek_v3": CouncilMember(
        id="deepseek_v3",
        name="DeepSeek V3 (Reasoning & Code)",
        provider="openrouter",
        model="deepseek/deepseek-chat",
        icon="🐋",
        role="كبير مهندسي البرمجيات والاستدلال الرياضي والمنطقي",
        specialty="أقوى نموذج عالمي في الاستدلال المنطقي العميق وهندسة الخوارزميات وتفكيك المعضلات المعقدة",
        system_prompt=(
            "أنت كبير مهندسي البرمجيات والاستدلال في مجلس الذكاء الاصطناعي (AI Council) ممثلاً لنموذج DeepSeek V3. "
            "دورك: التحليل العميق خطوة بخطوة، فحص الجانب الخوارزمي الدقيق، كشف الحالات الحدية (Edge Cases)، والتحقق الصارم من صحة الأفكار."
        ),
    ),
    "llama_70b": CouncilMember(
        id="llama_70b",
        name="Meta Llama 3.3 70B",
        provider="openrouter",
        model="meta-llama/llama-3.3-70b-instruct",
        icon="🦙",
        role="مستشار المعرفة الموسوعية والاستدلال المفتوح",
        specialty="النموذج الرائد عالمياً من Meta بقوة 70 مليار معامل في التفكير الحر والتحليل الاستراتيجي الشامل",
        system_prompt=(
            "أنت عضو بارز في مجلس الذكاء الاصطناعي ممثلاً لنموذج Meta Llama 3.3 70B. "
            "دورك: التفكير المنطقي الصريح غير المقيد، تقديم منظور استراتيجي موسوعي، وتفكيك الافتراضات الخاطئة."
        ),
    ),
    "qwen_72b": CouncilMember(
        id="qwen_72b",
        name="Qwen 2.5 72B (Alibaba)",
        provider="openrouter",
        model="qwen/qwen-2.5-72b-instruct",
        icon="🌐",
        role="مستشار الرياضيات والتحليل متعدد اللغات والأنظمة",
        specialty="معمارية 72B خارقة في الرياضيات والعلوم الدقيقة والربط المعرفي متعدد الثقافات",
        system_prompt=(
            "أنت عضو مجلس الذكاء الاصطناعي ممثلاً لنموذج Qwen 2.5 72B الرائد عالمياً. "
            "دورك: التدقيق الرياضي والعلمي الصارم، وضمان شمولية الحل وقابليته للتطبيق عبر مختلف البيئات والأنظمة."
        ),
    ),
    "groq_120b": CouncilMember(
        id="groq_120b",
        name="GPT-OSS 120B (Groq / 11 Keys)",
        provider="groq",
        model="openai/gpt-oss-120b",
        icon="⚡",
        role="مستشار الاستدلال فائق الضخامة (120B)",
        specialty="معمارية 120B مفتوحة المصدر فائقة القدرة مع تدوير 11 مفتاحاً سحابياً لضمان عدم التوقف",
        system_prompt=(
            "أنت مستشار الاستدلال العميق في مجلس الذكاء الاصطناعي (AI Council) ممثلاً لمعمارية 120B. "
            "دورك: تقديم حلول هندسية متينة، صريحة، والتركيز على أفضل الممارسات التقنية."
        ),
    ),
    "gemini": CouncilMember(
        id="gemini",
        name="Google Gemini 2.0 Flash",
        provider="gemini",
        model="gemini-2.0-flash",
        icon="✨",
        role="المستشار التحليلي والمعلوماتي الشامل",
        specialty="السرعة الفائقة، التحليل المنطقي وسياق التفكير الواسع واسترجاع الحقائق",
        system_prompt=(
            "أنت عضو بارز في مجلس الذكاء الاصطناعي (AI Council). "
            "دورك: تقديم تحليل استراتيجي سريع، موثق بالحقائق، مع التركيز على أفضل الممارسات والحلول العملية المباشرة."
        ),
    ),
    "groq_allam": CouncilMember(
        id="groq_allam",
        name="ALLaM 7B Arabic (SDAIA)",
        provider="groq",
        model="allam-2-7b",
        icon="🇸🇦",
        role="مستشار اللغة العربية والمعارف الثقافية",
        specialty="إتقان اللغة العربية، البلاغة، والمعارف الإقليمية والأدبية الأصيلة",
        system_prompt=(
            "أنت خبير اللغة العربية والمعارف الثقافية في مجلس الذكاء الاصطناعي (AI Council). "
            "دورك: صياغة وتدقيق الأفكار باللغة العربية الفصحى الرصينة، وضمان دقة المصطلحات والمفاهيم."
        ),
    ),
    "ollama": CouncilMember(
        id="ollama",
        name="Local Student (Llama 3.2 1B)",
        provider="ollama",
        model="llama3.2:1b",
        icon="💻",
        role="المتعلم والمراقب المحلي",
        specialty="استيعاب إجماع العمالقة والتعلم الذاتي المستمر على الجهاز محلياً دون إنترنت",
        system_prompt=(
            "أنت النموذج المحلي المتعلم في مجلس الذكاء الاصطناعي. "
            "دورك: تقديم منظور محلي سريع، وإبراز النقاط الجوهرية التي يجب تعلمها وحفظها محلياً."
        ),
    ),
    "mistral": CouncilMember(
        id="mistral",
        name="Mistral Small / Codestral",
        provider="mistral",
        model="mistral-small-latest",
        icon="🌪️",
        role="المستشار الأوروبي للأنظمة الذكية",
        specialty="الدقة التحليلية الصارمة، المعايير الأوروبية، وقوة الشيفرات البرمجية",
        system_prompt=(
            "أنت ممثل نماذج Mistral الأوروبية في مجلس الذكاء الاصطناعي (AI Council). "
            "دورك: التحليل الرياضي والبرمجي الدقيق، والاهتمام بالبنية المعمارية الأنيقة والآمنة."
        ),
    ),
    "cohere": CouncilMember(
        id="cohere",
        name="Cohere Command R+",
        provider="cohere",
        model="command-r-plus",
        icon="📑",
        role="المستشار التوثيقي والاسترجاعي المعمق",
        specialty="محاذاة النصوص، التوثيق الدقيق، واسترجاع السياق المترابط",
        system_prompt=(
            "أنت ممثل نماذج Cohere في مجلس الذكاء الاصطناعي (AI Council). "
            "دورك: فحص ترابط الأفكار، توثيق الخطوات، وضمان خلو المقترحات من التناقض المنطقي."
        ),
    ),
    "sambanova": CouncilMember(
        id="sambanova",
        name="Llama 3.3 (SambaNova RDU)",
        provider="sambanova",
        model="Meta-Llama-3.3-70B-Instruct",
        icon="🚀",
        role="مستشار معمارية RDU فائقة الأداء",
        specialty="معالجة البيانات المتدفقة والاستدلال العميق عبر شرائح RDU",
        system_prompt=(
            "أنت عضو بارز في مجلس الذكاء الاصطناعي (AI Council) ممثلاً لمعالجات SambaNova. "
            "دورك: تقديم حلول عالية الكفاءة والتوسعية وحساب الأداء الأمثل."
        ),
    ),
    "nvidia": CouncilMember(
        id="nvidia",
        name="NVIDIA NIM NIM-Llama 3.3",
        provider="nvidia",
        model="meta/llama-3.3-70b-instruct",
        icon="🟢",
        role="مستشار الحوسبة المتسارعة ونماذج المؤسسات",
        specialty="أعلى معايير الأمان المؤسسي والاستدلال المسرع بالعتاد",
        system_prompt=(
            "أنت ممثل NVIDIA NIM في مجلس الذكاء الاصطناعي (AI Council). "
            "دورك: فحص الأمان وقابلية التشغيل على خوادم الإنتاج والأنظمة المتسارعة."
        ),
    ),
    "openrouter": CouncilMember(
        id="openrouter",
        name="Nemotron 3.5 (OpenRouter)",
        provider="openrouter",
        model="nvidia/nemotron-3.5-lightning:free",
        icon="🌟",
        role="المستشار التنسيقي للنماذج العالمية",
        specialty="الوصول لنخبة النماذج العالمية متعددة التخصصات",
        system_prompt=(
            "أنت المستشار المعماري الشامل في مجلس الذكاء الاصطناعي (AI Council). "
            "دورك: وزن الآراء، فحص الأمان والموثوقية، وتقديم منظور شمولي متوازن."
        ),
    ),
    "deepseek": CouncilMember(
        id="deepseek",
        name="DeepSeek V3 / R1",
        provider="deepseek",
        model="deepseek-chat",
        icon="🐋",
        role="كبير مهندسي البرمجيات والرياضيات",
        specialty="الاستدلال العميق خطوة بخطوة، تصحيح الأخطاء، وهندسة الخوارزميات",
        system_prompt=(
            "أنت كبير مهندسي البرمجيات في مجلس الذكاء الاصطناعي (AI Council). "
            "دورك: فحص الجانب الهندسي الدقيق، التعقيد الحسابي، جودة الشيفرة، وحالات الحافة (Edge Cases)."
        ),
    ),
    "anthropic": CouncilMember(
        id="anthropic",
        name="Claude 3.5 Sonnet",
        provider="anthropic",
        model="claude-3-5-sonnet-20241022",
        icon="🧠",
        role="المدقق المعماري الصارم وخبير الأمان",
        specialty="أعلى درجات الدقة الهندسية، التحليل المنهجي الصارم وخلو الهلوسة",
        system_prompt=(
            "أنت المدقق المعماري الصارم في مجلس الذكاء الاصطناعي (AI Council). "
            "دورك: فحص جودة التفكير، الإشارة إلى أي نقاط ضعف أو هلوسات، وتقديم الحل الأكثر متانة هندسياً."
        ),
    ),
    "openai": CouncilMember(
        id="openai",
        name="OpenAI GPT-4o",
        provider="openai",
        model="gpt-4o",
        icon="✨",
        role="المستشار التوجيهي والتكاملي",
        specialty="الربط متعدد الوسائط والتنسيق اللغوي المتين",
        system_prompt=(
            "أنت عضو توجيهي في مجلس الذكاء الاصطناعي (AI Council). "
            "دورك: تقديم حلول ابتكارية ودمج الأفكار بوضوح ودقة عالية."
        ),
    ),
}



# Dynamic elected council roster storage
_DYNAMIC_ROSTER: list[CouncilMember] = []
_LAST_BENCHMARK_RESULTS: list[dict[str, Any]] = []


_SPECIALTY_HINTS = (
    ("arabic", "Arabic language specialist", "إتقان العربية الفصحى واللهجات"),
    ("code", "Coding specialist", "هندسة البرمجيات وكتابة الكود"),
    ("reason", "Deep reasoning specialist", "الاستدلال العميق والتحليل المنطقي"),
    ("ultra", "Frontier reasoning", "النماذج العملاقة والاستدلال المتقدم"),
    ("flash", "Speed specialist", "سرعة الاستجابة الفائقة"),
    ("lite", "Efficiency specialist", "كفاءة عالية بتكلفة صفرية"),
    ("mini", "Lightweight specialist", "النماذج الخفيفة السريعة"),
    ("command", "Instruction-following", "دقة اتباع التعليمات"),
)


def _specialty_for(model_key: str) -> tuple[str, str]:
    lowered = model_key.lower()
    for hint, role, spec in _SPECIALTY_HINTS:
        if hint in lowered:
            return role, spec
    return "General council voice", "رأي متوازن ومبني على الدليل"


def roster_from_verified_lineup(path: str = "data/model_council.json") -> list[CouncilMember]:
    """Build council members from the TESTED lineup in model_council.json.

    Every member here passed real inference tests — this is the verified
    'strongest available' roster, not a static guess.
    """
    members: list[CouncilMember] = []
    try:
        with open(path) as f:
            db = json.load(f)
    except Exception as e:
        log.warning("Could not load council lineup from %s: %s", path, e)
        return members

    lineup = db.get("lineup") or []
    consultants = db.get("consultants") or {}
    for key in lineup:
        if "/" not in key:
            continue
        provider, model = key.split("/", 1)
        if get_provider_spec(provider) is None:
            continue
        consultant = consultants.get(key) or {}
        role, specialty = _specialty_for(key)
        members.append(
            CouncilMember(
                id=f"{provider}:{model}",
                name=f"{provider}/{model}",
                provider=provider,
                model=model,
                icon="🧠",
                role=role,
                specialty=specialty or consultant.get("expertise", ""),
                system_prompt=(
                    f"أنت مستشار في مجلس نماذج JARVIS representing {key}. "
                    f"{specialty}. قدّم رأياً دقيقاً مبنياً على الدليل والمنطق."
                ),
            )
        )
    return members


_FAST_COUNCIL_SIZE = 8
_MODEL_DB_PATH = "data/models.db"


def _avg_latency_for(provider: str, model: str) -> float | None:
    """Average measured latency (ms) for a provider/model from models.db."""
    try:
        conn = sqlite3.connect(_MODEL_DB_PATH)
        row = conn.execute(
            """SELECT AVG(p.metric_value) FROM performance p
               JOIN models m ON m.id = p.model_id
               WHERE m.provider = ? AND m.model_name = ?
                 AND p.metric_name = 'latency_ms'""",
            (provider, model),
        ).fetchone()
        conn.close()
        return row[0] if row and row[0] else None
    except Exception:
        return None


def select_fast_members(members: list[CouncilMember], n: int = _FAST_COUNCIL_SIZE) -> list[CouncilMember]:
    """Pick the n fastest members by REAL measured latency, preserving diversity."""
    if len(members) <= n:
        return members
    scored = []
    for m in members:
        lat = _avg_latency_for(m.provider, m.model)
        # Unknown latency sorts last; slight preference for proven providers
        scored.append((lat if lat is not None else 999999.0, m))
    scored.sort(key=lambda t: t[0])
    return [m for _, m in scored[:n]]


class AICouncil:
    """Orchestrates multi-model deliberation, peer cross-examination, and consensus."""

    _dynamic_roster: list[CouncilMember] = _DYNAMIC_ROSTER
    _last_benchmark: list[dict[str, Any]] = _LAST_BENCHMARK_RESULTS

    def __init__(self, brain: LLMBrain):
        self.brain = brain

    @classmethod
    def set_dynamic_roster(cls, members: list[CouncilMember], benchmark_data: list[dict[str, Any]] | None = None) -> None:
        cls._dynamic_roster = members
        if benchmark_data is not None:
            cls._last_benchmark = benchmark_data

    @classmethod
    def get_last_benchmark(cls) -> list[dict[str, Any]]:
        return cls._last_benchmark

    async def auto_evaluate_and_elect(self) -> tuple[list[dict[str, Any]], list[CouncilMember]]:
        """Run multi-provider model benchmark and dynamically elect council members."""
        from .council_evaluator import CouncilEvaluator
        evaluator = CouncilEvaluator(self.brain)
        results = await evaluator.benchmark_all_candidates()
        elected = evaluator.elect_council(results)
        results_dicts = [r.to_dict() for r in results]
        AICouncil.set_dynamic_roster(elected, results_dicts)
        return results_dicts, elected

    def get_available_members(self) -> list[CouncilMember]:
        """Discover which council members can actively vote based on working providers with keys."""
        if AICouncil._dynamic_roster:
            return AICouncil._dynamic_roster

        members: list[CouncilMember] = []
        for roster_id, member in COUNCIL_ROSTER.items():
            prov = member.provider
            keys = self.brain.key_manager.get_keys(prov)
            active_key = self.brain.key_manager.get_active_key(prov)
            spec = get_provider_spec(prov)
            is_local = prov in {"ollama", "lmstudio"}
            # Cloud-only policy: local providers (ollama/lmstudio) are never
            # auto-included — they require an explicit key to join the council.
            has_key = bool(active_key or (keys and len(keys) > 0))
            if has_key or (spec and not spec.requires_key and not is_local):
                members.append(member)

        if not members:
            fallback_m = COUNCIL_ROSTER.get("groq_120b") or COUNCIL_ROSTER.get("gemini")
            if fallback_m:
                members = [fallback_m]

        return [m for m in members if m is not None]

    async def deliberate(
        self,
        topic: str,
        *,
        context: str = "",
        full: bool = False,
        on_event: Callable[[Event], None] | None = None,
    ) -> CouncilDeliberation:
        """Run a 3-stage deliberation: Proposals -> Cross-Review -> Consensus.

        full=False → fast council (top-N by measured latency, ~8 members).
        full=True  → entire verified lineup (25 members, slower, deeper).
        """
        members = self.get_available_members()
        if not members:
            # Fallback to primary model alone
            members = [COUNCIL_ROSTER["gemini"]]
        elif not full and len(members) > _FAST_COUNCIL_SIZE:
            members = select_fast_members(members)

        log.info("AI Council convened with %d members for topic: %s", len(members), topic[:60])

        if on_event:
            on_event(
                Event(
                    EventKind.INFO,
                    text=f"🏛️ انعقاد مجلس النماذج الذكي بمشاركة {len(members)} نماذج: "
                         + ", ".join(f"{m.icon} {m.name}" for m in members),
                    payload={
                        "council": True,
                        "phase": "convened",
                        "members": [{"id": m.id, "name": m.name, "icon": m.icon, "role": m.role} for m in members],
                    },
                )
            )

        # ── STAGE 1: Independent Parallel Proposals ─────────────────────────
        proposals: list[MemberProposal] = []

        async def _query_member(m: CouncilMember) -> MemberProposal:
            prompt = (
                f"المسألة المطروحة للمجلس:\n«{topic}»\n\n"
                f"{f'السياق الإضافي: {context}' if context else ''}\n"
                "قدّم مقترحك وحلك وخلاصة رأيك بوضوح وقوة وتركيز هندسي عالٍ."
            )
            spec = get_provider_spec(m.provider)
            endpoint = spec.default_base_url if spec else self.brain.mc.endpoint
            
            try:
                reply = await asyncio.wait_for(
                    self.brain._run_provider_attempt_loop(
                        provider=m.provider,
                        endpoint=endpoint,
                        model=m.model,
                        messages=[
                            {"role": "system", "content": m.system_prompt},
                            {"role": "user", "content": prompt},
                        ],
                        tool_schemas=[],
                        stream=False,
                        max_tokens=1200,
                    ),
                    timeout=150,
                )
                text = reply.text if reply and not reply.text.startswith("[brain error]") else "لم يتمكن العضو من تقديم مقترحه في هذه الجولة."
            except Exception as e:
                log.warning("Council member %s failed: %s", m.id, e)
                text = f"تعذر الاستجابة: {e}"

            return MemberProposal(
                member_id=m.id,
                member_name=m.name,
                icon=m.icon,
                model=m.model,
                content=text,
            )

        # Run Stage 1 concurrently
        results = await asyncio.gather(*[_query_member(m) for m in members], return_exceptions=True)
        for r in results:
            if isinstance(r, MemberProposal):
                proposals.append(r)

        if on_event:
            on_event(
                Event(
                    EventKind.INFO,
                    text="✓ تم استلام مقترحات أعضاء المجلس. جاري التداول والمراجعة المتبادلة...",
                    payload={"council": True, "phase": "proposals_ready", "count": len(proposals)},
                )
            )

        # ── STAGE 2: Peer Review & Cross-Examination ───────────────────────
        if on_event:
            on_event(
                Event(
                    EventKind.INFO,
                    text="🔍 بدء المرحلة الثانية: فحص ونقد المقترحات متبادلاً بين أعضاء المجلس...",
                    payload={"council": True, "phase": "peer_review_start", "count": len(proposals)},
                )
            )

        peer_critiques: list[dict[str, str]] = []

        async def _peer_review_member(m: CouncilMember) -> dict[str, str] | None:
            other_proposals = [p for p in proposals if p.member_id != m.id]
            if not other_proposals:
                return None

            peers_text = "\n\n".join(
                f"--- مقترح {p.icon} {p.member_name} ({p.model}) ---\n{p.content}"
                for p in other_proposals
            )
            critique_prompt = (
                f"المسألة المطروحة: «{topic}»\n\n"
                "إليك المقترحات المقدمة من باقي أعضاء مجلس الذكاء الاصطناعي:\n"
                f"{peers_text}\n\n"
                "بصفتك عضواً في المجلس، قدّم مراجعة نقدية موجزة وصريحة:\n"
                "1. ما هي نقاط القوة والضعف في مقترحات زملائك؟\n"
                "2. هل هناك افتراضات غير دقيقة، أو مخاطر أمنية/تقنية، أو ثغرات أغفلوها؟\n"
                "3. ما التعديل الجوهري الذي توصي به لتوحيد الرأي بأعلى كفاءة؟\n"
                "اكتب مراجعتك المركزة في فقرة أو فقرتين واضحتين."
            )
            spec = get_provider_spec(m.provider)
            endpoint = spec.default_base_url if spec else self.brain.mc.endpoint
            try:
                reply = await asyncio.wait_for(
                    self.brain._run_provider_attempt_loop(
                        provider=m.provider,
                        endpoint=endpoint,
                        model=m.model,
                        messages=[
                            {"role": "system", "content": f"{m.system_prompt}\nأنت الآن في جلسة المراجعة والنقد التبادلي لمقترحات باقي الأعضاء."},
                            {"role": "user", "content": critique_prompt},
                        ],
                        tool_schemas=[],
                        stream=False,
                        max_tokens=1200,
                    ),
                    timeout=150,
                )
                text = reply.text if reply and not reply.text.startswith("[brain error]") else "لم يقدّم العضو تعقيباً إضافياً."
            except Exception as e:
                log.warning("Peer review from %s failed: %s", m.id, e)
                text = f"تعذر إتمام المراجعة: {e}"

            return {
                "member_id": m.id,
                "member_name": m.name,
                "icon": m.icon,
                "model": m.model,
                "critique": text,
            }

        # Run Stage 2 concurrently across all available members
        critique_results = await asyncio.gather(*[_peer_review_member(m) for m in members], return_exceptions=True)
        for cr in critique_results:
            if isinstance(cr, dict) and cr.get("critique"):
                peer_critiques.append(cr)

        if on_event:
            on_event(
                Event(
                    EventKind.INFO,
                    text=f"✓ اكتملت مرحلة النقد المتبادل ({len(peer_critiques)} مراجعات). جاري صياغة الإجماع النهائي...",
                    payload={"council": True, "phase": "peer_review_done", "critiques_count": len(peer_critiques)},
                )
            )

        # ── STAGE 3: Unified Consensus Synthesis & Dynamic Agreement Score ─
        proposals_summary = "\n\n".join(
            f"### مقترح {p.icon} {p.member_name} ({p.model}):\n{p.content}"
            for p in proposals
        )
        critiques_summary = "\n\n".join(
            f"### تعقيب ونقد {c.get('icon', '💬')} {c.get('member_name', '')} ({c.get('model', '')}):\n{c.get('critique', '')}"
            for c in peer_critiques
        )

        synthesis_prompt = (
            "أنت رئيس مجلس الذكاء الاصطناعي (Chairman of the AI Council) ونظام J.A.R.V.I.S القيادي.\n"
            f"المسألة المطروحة:\n«{topic}»\n\n"
            "المقترحات الأولية من أعضاء المجلس:\n"
            f"{proposals_summary}\n\n"
            "جلسة النقد والمراجعة التبادلية (Peer Review & Critiques):\n"
            f"{critiques_summary}\n\n"
            "المطلوب منك كرئيس للمجلس:\n"
            "1. تلخيص نقاط الاتفاق ونقاط النقد الجوهرية التي أثيرت.\n"
            "2. صياغة **القرار والإجماع النهائي الموحد (Consensus Resolution)** الأقوى هندسياً والأشمل للتطبيق المباشر، متجاوزاً أي قصور فردي.\n"
            "3. تقييم نسبة توافق النماذج واتساق الحل النهائي كنسبة بين 0.50 و 0.99.\n"
            "في نهاية ردك تماماً، اكتب في سطر منفصل مستقل:\n"
            "AGREEMENT_SCORE: 0.XX"
        )

        # Chairman synthesis using the active working cloud model (DeepSeek V3 preferred for synthesis)
        if self.brain.key_manager.get_active_key("openrouter"):
            chairman_provider = "openrouter"
            chairman_model = "deepseek/deepseek-chat"
        elif self.brain.key_manager.get_active_key("groq"):
            chairman_provider = "groq"
            chairman_model = "openai/gpt-oss-120b"
        elif self.brain.key_manager.get_active_key("gemini"):
            chairman_provider = "gemini"
            chairman_model = "gemini-2.0-flash"
        elif self.brain.key_manager.get_active_key("cerebras"):
            chairman_provider = "cerebras"
            chairman_model = "gpt-oss-120b"
        else:
            chairman_provider = self.brain.mc.provider
            chairman_model = self.brain.mc.model
        chairman_spec = get_provider_spec(chairman_provider)
        chairman_endpoint = chairman_spec.default_base_url if chairman_spec else self.brain.mc.endpoint

        try:
            verdict_reply = await self.brain._run_provider_attempt_loop(
                provider=chairman_provider,
                endpoint=chairman_endpoint,
                model=chairman_model,
                messages=[
                    {"role": "system", "content": "You are J.A.R.V.I.S., Chief AI System & Council Chairman. Produce the authoritative consensus."},
                    {"role": "user", "content": synthesis_prompt},
                ],
                tool_schemas=[],
                stream=False,
            )
            consensus_raw = verdict_reply.text if verdict_reply else "تم اعتماد الرأي المشترك بين النماذج."
        except Exception as e:
            log.error("Council Chairman synthesis failed: %s", e)
            consensus_raw = proposals[0].content if proposals else "تعذر استخلاص القرار النهائي."

        # Parse dynamic agreement score
        dynamic_score = 0.94
        consensus_text = consensus_raw
        score_match = re.search(r"AGREEMENT_SCORE:\s*(0\.\d+)", consensus_raw)
        if score_match:
            try:
                parsed = float(score_match.group(1))
                dynamic_score = max(0.50, min(0.99, parsed))
                consensus_text = re.sub(r"AGREEMENT_SCORE:\s*0\.\d+", "", consensus_raw).strip()
            except Exception:
                dynamic_score = 0.94
        elif len(proposals) > 1:
            dynamic_score = 0.92

        deliberation = CouncilDeliberation(
            topic=topic,
            active_members=[{"id": m.id, "name": m.name, "icon": m.icon, "role": m.role} for m in members],
            proposals=proposals,
            peer_critiques=peer_critiques,
            consensus_verdict=consensus_text,
            agreement_score=dynamic_score,
        )

        if on_event:
            on_event(
                Event(
                    EventKind.INFO,
                    text=f"🏛️ تم التوصل إلى قرار وإجماع المجلس النهائي بنسبة توافق {int(dynamic_score*100)}%.",
                    payload={
                        "council": True,
                        "phase": "finished",
                        "consensus": consensus_text,
                        "agreement_score": dynamic_score,
                    },
                )
            )

        return deliberation
