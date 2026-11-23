"""Draft vulnerability report template — markdown, local only.

A rendered report is a DRAFT. It is never submitted anywhere by JARVIS.
A human must verify the finding, reproduce it, and submit it themselves
through the program's own channel. The banner at the top says so.
"""
from __future__ import annotations

BANNER = (
    "> **DRAFT — DO NOT SUBMIT YET.** This report was generated locally by "
    "JARVIS from unverified triage data. A human must reproduce the finding, "
    "confirm it is in scope, and submit it through the program's own channel."
)


def render_report(finding: dict, program: dict | None = None) -> str:
    """Render a finding + program into a markdown disclosure draft."""
    program_name = (program or {}).get("name") or "Unknown program"
    platform = (program or {}).get("platform") or ""
    scope = (program or {}).get("scope") or []
    lines = [
        f"# Vulnerability report (draft): {finding.get('title', 'Untitled')}",
        "",
        BANNER,
        "",
        "## Summary",
        "",
        f"- **Program:** {program_name}" + (f" ({platform})" if platform else ""),
        f"- **Target:** {finding.get('target', '')}",
        f"- **Severity (triage estimate):** {finding.get('severity', 'low')}",
        f"- **Category:** {finding.get('category', 'Unclassified')}",
        f"- **CWE:** {finding.get('cwe', '') or 'n/a'}",
        f"- **Status:** {finding.get('status', 'draft')}",
        "",
        "## Scope",
        "",
    ]
    if scope:
        lines.extend(f"- `{s}`" for s in scope)
    else:
        lines.append("- _No scope recorded — confirm scope on the program page before testing._")
    lines += [
        "",
        "## Description",
        "",
        finding.get("description", "") or "_No description recorded._",
        "",
        "## Steps to reproduce",
        "",
        "1. _Fill in exact steps, starting from a clean session._",
        "2. _Include request/response details (redact secrets and tokens)._",
        "3. _Note what you expected vs what actually happened._",
        "",
        "## Evidence",
        "",
        finding.get("evidence", "") or "_No evidence recorded — attach screenshots / logs / PoC output._",
        "",
        "## Impact",
        "",
        "_Describe what an attacker could actually do with this, in the program's context._",
        "",
        "## Suggested fix",
        "",
        finding.get("remediation", "") or "_Suggest a concrete fix._",
        "",
        "## Disclosure",
        "",
        "Submitted only through the program's own channel, after human "
        "verification. Do not disclose publicly until the program allows it.",
        "",
    ]
    return "\n".join(lines)
