"""Bug-bounty finding classification — pure logic, no network, no I/O.

Severity is an *estimate* for triage only. Every finding must be verified
by a human before it is reported anywhere; see ``report.py``.
"""
from __future__ import annotations

import re

SEVERITIES = ("critical", "high", "medium", "low", "info")
SEVERITY_ORDER = {name: i for i, name in enumerate(SEVERITIES)}

# (keywords, category, cwe, severity, remediation hint)
_RULES: list[tuple[tuple[str, ...], str, str, str, str]] = [
    (("sql injection", "sqli", "sql-injection"), "SQL Injection", "CWE-89", "critical",
     "Use parameterised queries / prepared statements; never build SQL from user input."),
    (("remote code execution", "rce", "command injection", "os command injection"),
     "Remote Code Execution", "CWE-78", "critical",
     "Remove shell execution of user input; allowlist commands and arguments."),
    (("ssrf", "server-side request forgery"), "Server-Side Request Forgery", "CWE-918", "high",
     "Allowlist outbound destinations; block private/reserved IP ranges; validate URLs."),
    (("stored xss", "stored cross-site scripting"), "Cross-Site Scripting (Stored)", "CWE-79", "high",
     "Encode output for its context; enforce a strict Content-Security-Policy."),
    (("xss", "cross-site scripting", "reflected xss", "dom xss"),
     "Cross-Site Scripting", "CWE-79", "medium",
     "Encode output for its context; enforce a strict Content-Security-Policy."),
    (("idor", "insecure direct object reference", "broken access control",
      "authori", "privilege escalation", "priv esc"),
     "Broken Access Control / IDOR", "CWE-639", "high",
     "Check ownership and authorisation server-side on every object access."),
    (("csrf", "cross-site request forgery"), "Cross-Site Request Forgery", "CWE-352", "medium",
     "Require anti-CSRF tokens on state-changing requests; use SameSite cookies."),
    (("authentication bypass", "auth bypass", "broken authentication",
      "session fixation", "jwt"), "Broken Authentication", "CWE-287", "high",
     "Fix session handling; rotate secrets; enforce MFA where the program allows."),
    (("sensitive data exposure", "information disclosure", "leak",
      "exposed credentials", "exposed api key", "directory listing"),
     "Sensitive Data Exposure", "CWE-200", "medium",
     "Remove the exposure; rotate any leaked credentials; add access controls."),
    (("open redirect",), "Open Redirect", "CWE-601", "low",
     "Allowlist redirect targets; reject absolute URLs to untrusted hosts."),
    (("clickjacking",), "Clickjacking", "CWE-1021", "low",
     "Send X-Frame-Options: DENY or frame-ancestors 'none'."),
    (("missing security header", "security headers", "cors misconfig"),
     "Security Misconfiguration", "CWE-16", "low",
     "Set the recommended security headers; review CORS allowlists."),
    (("rate limit", "brute force", "no rate limiting"), "Rate Limiting / Brute Force", "CWE-307", "medium",
     "Add rate limiting and account lockout / CAPTCHA on sensitive endpoints."),
]


def classify_finding(title: str, description: str = "", evidence: str = "") -> dict:
    """Classify a finding from free text. Returns a triage dict.

    Never returns a confident verdict on an empty/unknown description:
    those come back ``low`` with ``needs_verification=True``.
    """
    text = f"{title or ''} {description or ''} {evidence or ''}".lower()
    for keywords, category, cwe, severity, remediation in _RULES:
        if any(k in text for k in keywords):
            return {
                "category": category,
                "cwe": cwe,
                "severity": severity,
                "confidence": "rule-match",
                "remediation": remediation,
                "needs_verification": True,
            }
    return {
        "category": "Unclassified",
        "cwe": "",
        "severity": "low",
        "confidence": "no-rule-match",
        "remediation": "Verify manually against the program scope and reproduce before reporting.",
        "needs_verification": True,
    }


def severity_rank(severity: str) -> int:
    """Lower number = more severe. Unknown severities sort last."""
    return SEVERITY_ORDER.get((severity or "").lower(), len(SEVERITIES))


def sort_findings(findings: list[dict]) -> list[dict]:
    """Sort findings most-severe first, keeping input order within a severity."""
    return sorted(findings, key=lambda f: severity_rank(f.get("severity", "")))


def in_scope(target: str, scope: list[str]) -> bool:
    """Check a target (domain, URL, or path) against scope entries.

    Scope entries may be bare domains (``example.com`` matches the domain
    and subdomains), wildcards (``*.example.com``), URLs, or path prefixes
    (``/api/``). An empty scope list means *nothing* is in scope — never
    assume permission.
    """
    if not scope:
        return False
    target = (target or "").strip().lower()
    if not target:
        return False
    host = re.sub(r"^https?://", "", target).split("/")[0].split(":")[0]
    path = "/" + "/".join(target.split("/")[3:]) if "://" in target else (
        "/" + target.split("/", 1)[1] if "/" in target and not target.startswith("/") else target
    )
    for entry in scope:
        e = (entry or "").strip().lower()
        if not e:
            continue
        if e.startswith("*."):
            if host.endswith(e[1:]):
                return True
        elif e.startswith("/"):
            if path.startswith(e):
                return True
        elif "://" in e:
            ehost = re.sub(r"^https?://", "", e).split("/")[0].split(":")[0]
            if host == ehost or host.endswith("." + ehost):
                return True
        else:
            if host == e or host.endswith("." + e):
                return True
    return False
