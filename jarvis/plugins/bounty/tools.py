"""Bug-bounty tools for JARVIS.

Safety rules, baked in — not just documented:
* No network calls to any bounty platform. Program notes are static data.
* Findings are local SQLite rows, always created as ``draft``.
* Anything that changes state is CAUTION (asks for confirmation under the
  default ``confirm`` mode); reads and classification are SAFE.
* Nothing here submits, publishes, or contacts anyone. Reporting is a
  local markdown draft that a human submits themselves.
"""
from __future__ import annotations

from ..base import PluginInfo, tool
from ...core.permissions import Permission
from .classification import classify_finding, in_scope
from .programs import list_platforms, program_notes
from .programs_sync import build_web_search_fetcher, sync_programs
from .report import render_report
from .store import VALID_PLATFORMS, VALID_STATUSES, BountyStore


def _store(registry) -> BountyStore:
    store = registry.services.get("bounty_store")
    if store is None:
        store = BountyStore(registry.cfg.abs_path("data/bounty.db"))
        registry.services["bounty_store"] = store
    return store


def register(registry):
    store = _store(registry)

    @tool(
        name="bounty_add_program",
        description="Record a bug-bounty program (name, platform, scope) in the local bounty DB. No network call.",
        permission=Permission.CAUTION,
        parameters={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "platform": {"type": "string", "enum": sorted(VALID_PLATFORMS), "default": "other"},
                "url": {"type": "string", "default": ""},
                "scope": {"type": "array", "items": {"type": "string"}, "default": []},
                "notes": {"type": "string", "default": ""},
            },
            "required": ["name"],
        },
        preview=lambda a: f"bounty program {a.get('name','')}",
    )
    def bounty_add_program(name: str, platform: str = "other", url: str = "",
                           scope: list | None = None, notes: str = "") -> str:
        p = store.add_program(name, platform=platform, url=url, scope=scope, notes=notes)
        return f"program #{p['id']} recorded: {p['name']} ({p['platform']}), scope={p['scope']}"

    @tool(
        name="bounty_list_programs",
        description="List recorded bug-bounty programs from the local bounty DB.",
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {}},
    )
    def bounty_list_programs() -> str:
        programs = store.list_programs()
        if not programs:
            return "no bounty programs recorded yet — use bounty_add_program first."
        return "\n".join(
            f"#{p['id']} {p['name']} ({p['platform']}) scope={p['scope']}"
            for p in programs
        )

    @tool(
        name="bounty_add_target",
        description="Add a target (domain/URL) to a recorded bounty program. Refuses if the program does not exist.",
        permission=Permission.CAUTION,
        parameters={
            "type": "object",
            "properties": {
                "program_id": {"type": "integer"},
                "target": {"type": "string"},
                "kind": {"type": "string", "default": "domain"},
            },
            "required": ["program_id", "target"],
        },
        preview=lambda a: f"bounty target {a.get('target','')} for program #{a.get('program_id')}",
    )
    def bounty_add_target(program_id: int, target: str, kind: str = "domain") -> str:
        t = store.add_target(program_id, target, kind=kind)
        return f"target #{t['id']} recorded: {t['target']} ({t['kind']})"

    @tool(
        name="bounty_list_targets",
        description="List targets recorded for a bounty program.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {"program_id": {"type": "integer"}},
            "required": ["program_id"],
        },
    )
    def bounty_list_targets(program_id: int) -> str:
        targets = store.list_targets(program_id)
        if not targets:
            return f"no targets recorded for program #{program_id}."
        return "\n".join(f"#{t['id']} {t['target']} ({t['kind']})" for t in targets)

    @tool(
        name="bounty_scope_check",
        description="Check whether a target is inside a program's recorded scope. Empty scope means NOTHING is in scope.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "program_id": {"type": "integer"},
                "target": {"type": "string"},
            },
            "required": ["program_id", "target"],
        },
    )
    def bounty_scope_check(program_id: int, target: str) -> str:
        program = store.get_program(program_id)
        if program is None:
            return f"no program with id {program_id} — cannot verify scope, assume OUT of scope."
        ok = in_scope(target, program["scope"])
        return (
            f"{'IN SCOPE' if ok else 'OUT OF SCOPE'}: {target} "
            f"vs program #{program_id} scope={program['scope']}. "
            "Do not test anything out of scope."
            if not ok else
            f"IN SCOPE: {target} vs program #{program_id} scope={program['scope']}."
        )

    @tool(
        name="bounty_classify_finding",
        description="Triage-classify a finding from title/description/evidence (rule-based estimate, always needs human verification).",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "description": {"type": "string", "default": ""},
                "evidence": {"type": "string", "default": ""},
            },
            "required": ["title"],
        },
    )
    def bounty_classify_finding(title: str, description: str = "",
                                evidence: str = "") -> str:
        c = classify_finding(title, description, evidence)
        return (
            f"{c['category']} ({c['cwe'] or 'no CWE'}) — severity {c['severity']} "
            f"[{c['confidence']}]. Remediation: {c['remediation']} "
            "Human verification required before reporting."
        )

    @tool(
        name="bounty_record_finding",
        description="Record a finding as DRAFT in the local bounty DB (classified automatically). Never submits anything.",
        permission=Permission.CAUTION,
        parameters={
            "type": "object",
            "properties": {
                "program_id": {"type": "integer"},
                "target": {"type": "string"},
                "title": {"type": "string"},
                "description": {"type": "string", "default": ""},
                "evidence": {"type": "string", "default": ""},
            },
            "required": ["program_id", "target", "title"],
        },
        preview=lambda a: f"bounty finding (draft): {a.get('title','')}",
    )
    def bounty_record_finding(program_id: int, target: str, title: str,
                              description: str = "", evidence: str = "") -> str:
        program = store.get_program(program_id)
        if program is None:
            return f"no program with id {program_id} — finding NOT recorded."
        if not in_scope(target, program["scope"]):
            return (
                f"OUT OF SCOPE: {target} is not in program #{program_id} "
                f"scope={program['scope']}. Finding NOT recorded — do not test out of scope."
            )
        c = classify_finding(title, description, evidence)
        f = store.add_finding(program_id, target, title, description, evidence,
                              category=c["category"], cwe=c["cwe"], severity=c["severity"])
        return (
            f"finding #{f['id']} recorded as DRAFT: {f['title']} "
            f"({f['category']}, severity {f['severity']}). "
            "Verify and reproduce it yourself before reporting."
        )

    @tool(
        name="bounty_list_findings",
        description="List recorded bounty findings, optionally filtered by program or status.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "program_id": {"type": "integer"},
                "status": {"type": "string", "enum": sorted(VALID_STATUSES)},
            },
        },
    )
    def bounty_list_findings(program_id: int | None = None,
                             status: str | None = None) -> str:
        findings = store.list_findings(program_id, status)
        if not findings:
            return "no findings recorded."
        return "\n".join(
            f"#{f['id']} [{f['severity']}] {f['title']} — {f['category']} "
            f"({f['status']}, target {f['target']})"
            for f in findings
        )

    @tool(
        name="bounty_render_report",
        description="Render a recorded finding as a local markdown disclosure DRAFT. Never submits it.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {"finding_id": {"type": "integer"}},
            "required": ["finding_id"],
        },
    )
    def bounty_render_report(finding_id: int) -> str:
        finding = store.get_finding(finding_id)
        if finding is None:
            return f"no finding with id {finding_id}."
        program = store.get_program(finding["program_id"])
        c = classify_finding(finding["title"], finding["description"], finding["evidence"])
        finding = {**finding, "remediation": c["remediation"]}
        return render_report(finding, program)

    @tool(
        name="bounty_program_notes",
        description="Static notes about a bounty platform (HackerOne, Bugcrowd, Intigriti, YesWeHack). Data only — no API call, no account needed.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {"platform": {"type": "string", "enum": list_platforms()}},
            "required": ["platform"],
        },
    )
    def bounty_program_notes(platform: str) -> str:
        notes = program_notes(platform)
        if notes is None:
            return f"no notes for platform {platform!r}."
        return f"{notes['name']} ({notes['url']}): {notes['notes']} Disclosure: {notes['disclosure']}"

    @tool(
        name="bounty_sync_programs",
        description=(
            "Sync public bounty-program listings (HackerOne, Bugcrowd, "
            "Intigriti, YesWeHack public directories) into the local bounty "
            "DB via web_search. New programs are stored unreviewed with an "
            "empty scope; duplicates are skipped by URL; a failing platform "
            "is skipped. Local DB writes only — nothing is submitted."
        ),
        permission=Permission.CAUTION,
        parameters={
            "type": "object",
            "properties": {
                "platforms": {
                    "type": "array",
                    "items": {"type": "string", "enum": list_platforms()},
                    "default": [],
                },
            },
        },
        preview=lambda a: "bounty program sync",
    )
    async def bounty_sync_programs(platforms: list | None = None) -> str:
        fetcher = build_web_search_fetcher(registry)
        result = await sync_programs(store, search=fetcher,
                                     platforms=platforms or None)
        lines = [
            f"bounty program sync: {result['added']} new, "
            f"{result['duplicates']} duplicates skipped",
        ]
        if result["skipped"]:
            lines.append(
                f"skipped (search failed): {', '.join(result['skipped'])}")
        if result["programs"]:
            lines.append("new: " + ", ".join(result["programs"]))
        lines.append(
            "All synced programs are UNREVIEWED with empty scope — verify "
            "the scope on the program page before testing anything.")
        return "\n".join(lines)

    registry.add_pending("bounty")
    registry.register_plugin(PluginInfo(
        name="bounty",
        description="Bug-bounty scope/target DB, finding triage, and draft disclosure reports. Local only; nothing is submitted.",
        permissions_needed=[Permission.CAUTION],
    ))
