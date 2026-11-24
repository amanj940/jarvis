#!/usr/bin/env python3
"""Download the Arabic Piper TTS voice model for offline Arabic speech.

One-time setup helper — run it once on the machine that runs JARVIS:

    python3 scripts/download_arabic_voice.py

It downloads the Piper voice ``ar_JO-kareem-medium`` (Jordanian Arabic,
medium quality) from Hugging Face into ``data/voices/``:

    data/voices/ar_JO-kareem-medium.onnx       (~60 MB)
    data/voices/ar_JO-kareem-medium.onnx.json  (~5 KB, voice config)

Why this exists
---------------
JARVIS speaks Arabic by default through Microsoft Edge-TTS
(ar-SA-HamedNeural), which needs internet. The bundled Piper model
(``data/voices/jarvis.onnx``) is English-only, so when the internet is
down Arabic speech has no local voice. This script fetches an Arabic
Piper model so JARVIS can keep speaking Arabic fully offline.

What it does NOT do
-------------------
* It changes no configuration and no code. The default voice stays
  Edge-TTS HamedNeural. After downloading, follow the config lines it
  prints to point Piper at the Arabic model.
* It never commits or bundles the model: ``data/voices/*`` is
  gitignored (except its README). The model lives only on the machine
  that runs it.
* It downloads nothing at import time — all network access happens
  inside ``ensure_voice()`` / ``main()``.

Safety
------
* Downloads go to a temporary file first and are moved into place
  only after verification, so a failed download never leaves a
  half-written model behind.
* Verification: the download size must match the server's
  ``Content-Length`` (when the server sends one), the ``.onnx`` must
  be at least 1 MB, and the ``.onnx.json`` must parse as JSON with an
  ``audio.sample_rate`` entry.
* Re-running the script skips files that are already present and
  valid. Use ``--force`` to re-download.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

VOICE_ID = "ar_JO-kareem-medium"
BASE_URL = (
    "https://huggingface.co/rhasspy/piper-voices/resolve/main"
    "/ar/ar_JO/kareem/medium"
)
MODEL_URL = f"{BASE_URL}/{VOICE_ID}.onnx"
CONFIG_URL = f"{BASE_URL}/{VOICE_ID}.onnx.json"

MODEL_FILENAME = f"{VOICE_ID}.onnx"
CONFIG_FILENAME = f"{VOICE_ID}.onnx.json"

# Sizes observed on 2026-11-24 (verified with HEAD requests).
# Upstream may republish the model, so these are only sanity hints:
# a mismatch prints a warning, it never fails the download.
EXPECTED_MODEL_SIZE = 63_201_294
EXPECTED_CONFIG_SIZE = 5_024
MIN_MODEL_SIZE = 1_000_000  # a real medium Piper model is tens of MB
CHUNK_SIZE = 1024 * 1024


class DownloadError(RuntimeError):
    """Raised when a voice file cannot be downloaded or verified."""


def repo_root() -> Path:
    """Repository root (the parent of the ``scripts/`` directory)."""
    return Path(__file__).resolve().parent.parent


def default_voices_dir() -> Path:
    """Default voice directory: ``<repo>/data/voices``."""
    return repo_root() / "data" / "voices"


def _config_is_valid(path: Path) -> bool:
    """True when *path* is a plausible Piper voice config."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return (
        isinstance(data, dict)
        and isinstance(data.get("audio"), dict)
        and isinstance(data["audio"].get("sample_rate"), int)
    )


def _model_is_valid(path: Path) -> bool:
    """True when *path* looks like a real (non-trivial) model file."""
    try:
        return path.is_file() and path.stat().st_size >= MIN_MODEL_SIZE
    except OSError:
        return False


def _download(url: str, dest: Path) -> int:
    """Download *url* to *dest* (atomic: temp file + rename).

    Returns the number of bytes written. Raises DownloadError on any
    network failure, size mismatch or undersized file; no partial file
    is left behind.
    """
    tmp_path: Path | None = None
    try:
        request = urllib.request.Request(
            url, headers={"User-Agent": "jarvis-voice-downloader/1.0"}
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            header = response.headers.get("Content-Length")
            expected = int(header) if header and header.isdigit() else None
            fd, tmp_name = tempfile.mkstemp(
                prefix=dest.name + ".", dir=str(dest.parent)
            )
            tmp_path = Path(tmp_name)
            written = 0
            with os.fdopen(fd, "wb") as out:
                while True:
                    chunk = response.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    out.write(chunk)
                    written += len(chunk)
    except DownloadError:
        raise
    except (urllib.error.URLError, OSError, ValueError) as exc:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
        raise DownloadError(f"download failed for {url}: {exc}") from exc

    assert tmp_path is not None  # mkstemp ran if we got here
    if expected is not None and written != expected:
        tmp_path.unlink(missing_ok=True)
        raise DownloadError(
            f"size mismatch for {url}: got {written} bytes, "
            f"server said {expected}"
        )
    if dest.suffix == ".onnx" and written < MIN_MODEL_SIZE:
        tmp_path.unlink(missing_ok=True)
        raise DownloadError(
            f"downloaded model for {url} is only {written} bytes — "
            "smaller than any real Piper model, refusing it"
        )
    os.chmod(tmp_path, 0o644)
    os.replace(tmp_path, dest)
    return written


def ensure_voice(
    voices_dir: Path | str,
    force: bool = False,
    quiet: bool = False,
) -> dict:
    """Make sure the Arabic voice files exist in *voices_dir*.

    Downloads whatever is missing (or everything, with ``force``) and
    skips files that are already present and valid. Returns a dict of
    ``{"model": {...}, "config": {...}}`` with ``status`` of
    ``downloaded`` / ``skipped`` / ``failed`` per file.
    """
    voices_dir = Path(voices_dir)
    voices_dir.mkdir(parents=True, exist_ok=True)
    results: dict = {}
    files = (
        ("model", MODEL_FILENAME, MODEL_URL, EXPECTED_MODEL_SIZE, _model_is_valid),
        ("config", CONFIG_FILENAME, CONFIG_URL, EXPECTED_CONFIG_SIZE, _config_is_valid),
    )
    for kind, filename, url, expected_size, is_valid in files:
        dest = voices_dir / filename
        if is_valid(dest) and not force:
            results[kind] = {
                "status": "skipped",
                "path": str(dest),
                "size": dest.stat().st_size,
            }
            continue
        try:
            size = _download(url, dest)
        except DownloadError as exc:
            results[kind] = {"status": "failed", "path": str(dest), "error": str(exc)}
            continue
        if kind == "config" and not _config_is_valid(dest):
            dest.unlink(missing_ok=True)
            results[kind] = {
                "status": "failed",
                "path": str(dest),
                "error": "downloaded config is not a valid Piper voice "
                "config (missing audio.sample_rate)",
            }
            continue
        if size != expected_size and not quiet:
            print(
                f"  warning: {filename} is {size:,} bytes, expected "
                f"~{expected_size:,} — upstream may have republished "
                "the model; continuing",
                file=sys.stderr,
            )
        results[kind] = {"status": "downloaded", "path": str(dest), "size": size}
    return results


def config_lines(voices_dir: Path | str) -> str:
    """Exact ``config.yaml`` lines that enable the Arabic voice offline.

    Change these two lines inside the existing ``voice:`` section.
    The Edge default is untouched: with ``provider: auto`` Arabic
    still uses HamedNeural whenever the internet is up.
    """
    voices_dir = Path(voices_dir)
    try:
        rel_dir = voices_dir.resolve().relative_to(repo_root())
        model_path = (rel_dir / MODEL_FILENAME).as_posix()
    except ValueError:
        model_path = (voices_dir / MODEL_FILENAME).as_posix()
    return (
        "voice:\n"
        "  provider: piper\n"
        f"  piper_model: {model_path}\n"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="download_arabic_voice.py",
        description=(
            "Download the Arabic Piper voice model "
            f"({VOICE_ID}) into data/voices/ so JARVIS can speak "
            "Arabic offline."
        ),
    )
    parser.add_argument(
        "--voices-dir",
        type=Path,
        default=None,
        help="Directory to store the voice files in "
        "(default: <repo>/data/voices).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download even if valid files are already present.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Print only errors and the config snippet.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Entry point: download the voice, print the config lines."""
    args = build_parser().parse_args(argv)
    voices_dir = args.voices_dir or default_voices_dir()
    if not args.quiet:
        print(f"Downloading Arabic Piper voice ({VOICE_ID}) into {voices_dir} ...")
    results = ensure_voice(voices_dir, force=args.force, quiet=args.quiet)
    for kind, result in results.items():
        if result["status"] == "failed":
            print(f"  {kind}: FAILED — {result['error']}", file=sys.stderr)
        elif not (args.quiet and result["status"] == "skipped"):
            print(
                f"  {kind}: {result['status']} "
                f"({result['size']:,} bytes) -> {result['path']}"
            )
    if any(r["status"] == "failed" for r in results.values()):
        print(
            "Download failed. Check your internet connection and try again.",
            file=sys.stderr,
        )
        return 1
    print()
    print(
        "Done. To speak Arabic offline, change these lines in the "
        "voice: section of config.yaml, then restart the backend:"
    )
    print(config_lines(voices_dir))
    print(
        "Set provider back to auto to return to Edge-TTS "
        "(ar-SA-HamedNeural) when the internet is available."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
