# Bug Bounty team agent

JARVIS's bug-bounty capability is a **local triage assistant**, not an
automated hacker. It records programs and scope, classifies candidate
findings, and drafts disclosure reports. A human does the testing, the
verification, and the submission.

## Safety rules (non-negotiable)

1. **Scope first, always.** Nothing is tested unless the target is inside a
   program's recorded scope. An empty scope means *nothing* is in scope.
   `bounty_record_finding` refuses out-of-scope findings outright.
2. **No exploitation.** JARVIS recon is `scan_project` on a local directory
   and `web_search` for public program information. No probing, no payloads,
   no credential stuffing, no brute force.
3. **Drafts only.** Findings are created as `draft`. Nothing is submitted,
   published, or sent to anyone by JARVIS. A human reproduces the finding
   and submits it through the program's own channel.
4. **Permissions stay `confirm`.** The bounty tools are `SAFE` (reads,
   classification) or `CAUTION` (local DB writes). Nothing here is
   `DANGEROUS`, and the code default for `permissions.mode` is `confirm`.
   Never set it to `bypass` for bounty work — that would auto-allow every
   tool, including destructive ones.
5. **No live platform APIs.** HackerOne / Bugcrowd / Intigriti / YesWeHack
   notes in `jarvis/plugins/bounty/programs.py` are static data. There are
   no keys and no API calls. The program's own scope page always wins.

## Files

| File | What it is |
|---|---|
| `jarvis/plugins/bounty/classification.py` | Rule-based triage: severity, CWE, remediation. Pure logic, no I/O. |
| `jarvis/plugins/bounty/store.py` | SQLite store (`data/bounty.db`): programs, targets, findings. |
| `jarvis/plugins/bounty/programs.py` | Static platform notes (HackerOne, Bugcrowd, Intigriti, YesWeHack). |
| `jarvis/plugins/bounty/report.py` | Markdown disclosure draft template (always bannered DRAFT). |
| `jarvis/plugins/bounty/tools.py` | The `bounty_*` tools registered with the plugin registry. |
| `jarvis/agents/security.py` | `SecurityAgent` — plans and runs the workflow via the tool registry. |
| `tests/test_bounty.py` | Unit tests (classification, scope, store, report, agent scope gate). |

The plugin is discovered automatically by `PluginRegistry.load_all()`:
`jarvis/plugins/bounty/__init__.py` exposes `register()`.

## Tools

| Tool | Permission | What it does |
|---|---|---|
| `bounty_add_program` | CAUTION | Record a program: name, platform, scope list, notes. |
| `bounty_list_programs` | SAFE | List recorded programs. |
| `bounty_add_target` | CAUTION | Add a target to a program. |
| `bounty_list_targets` | SAFE | List a program's targets. |
| `bounty_scope_check` | SAFE | `IN SCOPE` / `OUT OF SCOPE` for a target vs program scope. |
| `bounty_classify_finding` | SAFE | Triage estimate (category, CWE, severity, remediation). |
| `bounty_record_finding` | CAUTION | Record a finding as `draft` (scope-checked, classified). |
| `bounty_list_findings` | SAFE | List findings, optionally by program/status. |
| `bounty_render_report` | SAFE | Render a finding as a local markdown disclosure draft. |
| `bounty_program_notes` | SAFE | Static notes for a platform. |

Finding statuses: `draft` → `verified` → `reported` → `triaged` /
`resolved`; also `duplicate`, `out_of_scope`, `rejected`.

## Workflow (what the security agent does)

1. **Scope** — `bounty_scope_check`. Out of scope = stop here.
2. **Recon** — `scan_project` for a local path, else `web_search` for
   public program information.
3. **Triage** — `bounty_classify_finding` (rule-based estimate).
4. **Record** — `bounty_record_finding` as `draft` (scope-checked again).
5. **Report** — `bounty_render_report` produces the markdown draft.

Example (through chat):

```
Add the Acme program on HackerOne with scope example.com,
then check whether sub.example.com is in scope.
```

## Disclosure path

1. Verify the finding yourself: reproduce it from a clean session.
2. Confirm it is in scope on the program's own page.
3. Render the draft with `bounty_render_report`.
4. Fill in exact reproduction steps and impact; redact secrets/tokens.
5. Submit **only** through the program's channel (HackerOne / Bugcrowd /
   Intigriti / YesWeHack program page).
6. Do not disclose publicly until the program allows it.
7. Mark the finding `reported` in the local DB once submitted.

## What is deliberately NOT here

- No live HackerOne/Bugcrowd API integration (needs keys and accounts;
  add later behind explicit configuration, never silently).
- No automated exploitation, fuzzing, or scanning of live targets.
- No payout / reward tracking — add only if the user asks for it.
