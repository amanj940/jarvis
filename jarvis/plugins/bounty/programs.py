"""Static program notes for the big bounty platforms — data only.

No live API calls, no keys, no network. These notes tell the agent where
a program lives and how its disclosure path works; the user still has to
create an account and read the program's own scope page before testing
anything. If a platform changes its rules, the program page wins.
"""
from __future__ import annotations

PROGRAMS: list[dict] = [
    {
        "platform": "hackerone",
        "name": "HackerOne",
        "url": "https://hackerone.com",
        "notes": (
            "Largest managed bounty platform. Programs publish a scope page "
            "listing in-scope assets and out-of-scope items; rewards are set "
            "per program and triage is handled by the program team."
        ),
        "disclosure": (
            "Submit through the program page on HackerOne only. Include steps "
            "to reproduce, impact, and a fix suggestion. Do not disclose "
            "publicly until the program allows it."
        ),
        "typical_scope": ["*.example.com", "example.com"],
    },
    {
        "platform": "bugcrowd",
        "name": "Bugcrowd",
        "url": "https://bugcrowd.com",
        "notes": (
            "Crowdsourced bounty platform with public and private programs. "
            "Each program brief defines scope, safe-harbour terms, and reward "
            "ranges; some programs use points (VRT) before cash."
        ),
        "disclosure": (
            "Submit through the Bugcrowd program brief only, following its "
            "submission template. Respect the program's disclosure timeline."
        ),
        "typical_scope": ["*.example.com", "example.com"],
    },
    {
        "platform": "intigriti",
        "name": "Intigriti",
        "url": "https://intigriti.com",
        "notes": (
            "European bounty platform. Programs define scope and severity "
            "using the Intigriti triage standard; researcher identity "
            "verification may be required for payouts."
        ),
        "disclosure": (
            "Submit through the Intigriti program page. Follow its severity "
            "guidance and do not test outside the listed scope."
        ),
        "typical_scope": ["*.example.com", "example.com"],
    },
    {
        "platform": "yeswehack",
        "name": "YesWeHack",
        "url": "https://yeswehack.com",
        "notes": (
            "European platform with public programs and private bug-bounty "
            "campaigns. Scope and rules are per program; some programs run "
            "time-boxed live hacking events."
        ),
        "disclosure": (
            "Submit through the YesWeHack program page and follow its "
            "disclosure policy."
        ),
        "typical_scope": ["*.example.com", "example.com"],
    },
]


def program_notes(platform: str) -> dict | None:
    """Return the static notes for a platform, or None if unknown."""
    key = (platform or "").strip().lower()
    for p in PROGRAMS:
        if p["platform"] == key:
            return dict(p)
    return None


def list_platforms() -> list[str]:
    return [p["platform"] for p in PROGRAMS]
