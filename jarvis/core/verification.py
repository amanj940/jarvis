"""J.A.R.V.I.S. Execution Verification Engine.

Provides evidence-based post-execution verification for filesystem, git, build,
and agent operations. Enforces the core JARVIS principle:
"Never claim success without tangible evidence."
"""
from __future__ import annotations

import logging
import os
import subprocess
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

log = logging.getLogger("jarvis.verification")


class VerificationStatus(str, Enum):
    VERIFIED = "verified"
    PARTIALLY_VERIFIED = "partially_verified"
    FAILED = "failed"
    UNVERIFIED = "unverified"


@dataclass
class VerificationEvidence:
    check_type: str  # "filesystem", "git", "build", "api", "process"
    target: str
    passed: bool
    details: str
    evidence_data: dict[str, Any] = field(default_factory=dict)


@dataclass
class VerificationReport:
    operation: str
    status: VerificationStatus
    evidences: list[VerificationEvidence] = field(default_factory=list)
    summary: str = ""
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "operation": self.operation,
            "status": self.status.value,
            "summary": self.summary,
            "timestamp": self.timestamp,
            "evidences": [
                {
                    "check_type": e.check_type,
                    "target": e.target,
                    "passed": e.passed,
                    "details": e.details,
                    "evidence_data": e.evidence_data,
                }
                for e in self.evidences
            ],
        }


class ExecutionVerifier:
    """Verifies mutations and operations before JARVIS reports success."""

    @staticmethod
    def verify_file_write(
        path: Path | str,
        expected_snippet: str | None = None,
        min_bytes: int = 1,
    ) -> VerificationEvidence:
        target_path = Path(path)
        if not target_path.exists():
            return VerificationEvidence(
                check_type="filesystem",
                target=str(target_path),
                passed=False,
                details=f"Target file does not exist on disk: {target_path}",
            )

        if not target_path.is_file():
            return VerificationEvidence(
                check_type="filesystem",
                target=str(target_path),
                passed=False,
                details=f"Target path is not a regular file: {target_path}",
            )

        size = target_path.stat().st_size
        if size < min_bytes:
            return VerificationEvidence(
                check_type="filesystem",
                target=str(target_path),
                passed=False,
                details=f"File size ({size} bytes) is less than required ({min_bytes} bytes)",
                evidence_data={"size": size},
            )

        try:
            content = target_path.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            return VerificationEvidence(
                check_type="filesystem",
                target=str(target_path),
                passed=False,
                details=f"File exists but could not be read: {e}",
            )

        if expected_snippet and expected_snippet not in content:
            return VerificationEvidence(
                check_type="filesystem",
                target=str(target_path),
                passed=False,
                details=f"File exists but expected snippet not found in content (length: {len(content)})",
                evidence_data={"size": size, "snippet_expected": expected_snippet[:100]},
            )

        return VerificationEvidence(
            check_type="filesystem",
            target=str(target_path),
            passed=True,
            details=f"File verified successfully ({size} bytes, readable, content verified)",
            evidence_data={"size": size},
        )

    @staticmethod
    def verify_file_deleted(path: Path | str) -> VerificationEvidence:
        target_path = Path(path)
        if target_path.exists():
            return VerificationEvidence(
                check_type="filesystem",
                target=str(target_path),
                passed=False,
                details=f"File still exists on disk after deletion command: {target_path}",
            )
        return VerificationEvidence(
            check_type="filesystem",
            target=str(target_path),
            passed=True,
            details="Confirmed file is removed from disk",
        )

    @staticmethod
    def verify_git_status(
        repo_path: Path | str,
        expected_branch: str | None = None,
        must_be_clean: bool = False,
    ) -> VerificationEvidence:
        repo = Path(repo_path)
        if not (repo / ".git").exists():
            return VerificationEvidence(
                check_type="git",
                target=str(repo),
                passed=False,
                details="Directory is not a git repository",
            )

        try:
            branch_out = subprocess.check_output(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=repo,
                text=True,
                timeout=5,
            ).strip()
            status_out = subprocess.check_output(
                ["git", "status", "--porcelain"],
                cwd=repo,
                text=True,
                timeout=5,
            ).strip()
        except Exception as e:
            return VerificationEvidence(
                check_type="git",
                target=str(repo),
                passed=False,
                details=f"Failed to query git status: {e}",
            )

        evidence = {"branch": branch_out, "uncommitted_files_count": len(status_out.splitlines()) if status_out else 0}

        if expected_branch and branch_out != expected_branch:
            return VerificationEvidence(
                check_type="git",
                target=str(repo),
                passed=False,
                details=f"Expected branch '{expected_branch}' but current branch is '{branch_out}'",
                evidence_data=evidence,
            )

        if must_be_clean and status_out:
            return VerificationEvidence(
                check_type="git",
                target=str(repo),
                passed=False,
                details=f"Working tree is not clean ({evidence['uncommitted_files_count']} uncommitted changes)",
                evidence_data=evidence,
            )

        return VerificationEvidence(
            check_type="git",
            target=str(repo),
            passed=True,
            details=f"Git verified (branch: {branch_out}, uncommitted files: {evidence['uncommitted_files_count']})",
            evidence_data=evidence,
        )

    @staticmethod
    def verify_build_artifact(
        exit_code: int,
        stdout: str,
        expected_artifact: Path | str | None = None,
    ) -> VerificationEvidence:
        if exit_code != 0:
            return VerificationEvidence(
                check_type="build",
                target=str(expected_artifact or "build_command"),
                passed=False,
                details=f"Build command failed with exit code {exit_code}",
                evidence_data={"exit_code": exit_code, "output_tail": stdout[-300:] if stdout else ""},
            )

        if expected_artifact:
            art_path = Path(expected_artifact)
            if not art_path.exists():
                return VerificationEvidence(
                    check_type="build",
                    target=str(art_path),
                    passed=False,
                    details=f"Build exited 0 but expected artifact was not created: {art_path}",
                    evidence_data={"exit_code": exit_code},
                )
            size = art_path.stat().st_size
            return VerificationEvidence(
                check_type="build",
                target=str(art_path),
                passed=True,
                details=f"Build succeeded and artifact exists ({size} bytes)",
                evidence_data={"exit_code": exit_code, "artifact_size": size},
            )

        return VerificationEvidence(
            check_type="build",
            target="build_command",
            passed=True,
            details="Build command completed successfully with exit code 0",
            evidence_data={"exit_code": 0},
        )

    @classmethod
    def evaluate_report(
        cls,
        operation: str,
        evidences: list[VerificationEvidence],
    ) -> VerificationReport:
        if not evidences:
            return VerificationReport(
                operation=operation,
                status=VerificationStatus.UNVERIFIED,
                summary="No verification checks were executed.",
            )

        all_passed = all(e.passed for e in evidences)
        any_passed = any(e.passed for e in evidences)

        if all_passed:
            status = VerificationStatus.VERIFIED
            summary = f"All {len(evidences)} verification check(s) passed with physical evidence."
        elif any_passed:
            status = VerificationStatus.PARTIALLY_VERIFIED
            failed_count = sum(1 for e in evidences if not e.passed)
            summary = f"Partial verification: {failed_count} of {len(evidences)} check(s) failed."
        else:
            status = VerificationStatus.FAILED
            summary = f"All {len(evidences)} verification check(s) failed."

        return VerificationReport(
            operation=operation,
            status=status,
            evidences=evidences,
            summary=summary,
        )


# Global instance
verifier = ExecutionVerifier()
