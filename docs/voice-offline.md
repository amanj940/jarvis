# Offline Arabic voice (Piper)

JARVIS speaks Arabic by default through Microsoft Edge-TTS
(`ar-SA-HamedNeural`, Hamed Neural) — a natural neural voice, but it
needs internet. The Piper model bundled with JARVIS
(`data/voices/jarvis.onnx`) is English-only, so when the internet is
down Arabic speech has no local voice and `/api/tts` returns 503 for
Arabic text.

This page explains how to download an Arabic Piper model so JARVIS
can keep speaking Arabic fully offline. It changes no code and no
defaults: HamedNeural stays the default voice.

## Quick start

Run once, on the machine that runs JARVIS (needs internet one time):

```bash
python3 scripts/download_arabic_voice.py
```

Expected files afterwards:

| File | Size | What it is |
| --- | --- | --- |
| `data/voices/ar_JO-kareem-medium.onnx` | ~60 MB | Piper voice model (Jordanian Arabic, medium quality) |
| `data/voices/ar_JO-kareem-medium.onnx.json` | ~5 KB | Voice config (sample rate, phoneme map) |

The script downloads from Hugging Face (`rhasspy/piper-voices`),
skips files that are already present and valid, verifies each
download (size vs `Content-Length`, minimum size, JSON validity),
and never leaves a half-written file behind. Re-run with `--force`
to re-download. See `python3 scripts/download_arabic_voice.py --help`.

Prerequisites: `pip install piper-tts` (see `requirements-voice.txt`)
and ~65 MB free disk. The model files are gitignored
(`data/voices/*`) and are **never committed** — after a fresh clone,
run the script again.

## Enabling it

Change these two lines in the `voice:` section of `config.yaml`
(the script prints them for you), then restart the backend:

```yaml
voice:
  provider: piper
  piper_model: data/voices/ar_JO-kareem-medium.onnx
```

To go back to Edge-TTS HamedNeural, set `provider: auto` again
(and, if you want the English JARVIS voice back,
`piper_model: data/voices/jarvis.onnx`).

## How the fallback actually works

Read this before expecting magic — the routing today is explicit,
not automatic:

- **Default (`provider: auto`, internet up):** Arabic text goes to
  Edge-TTS HamedNeural. English text may use the local Piper
  `jarvis.onnx` model if it is installed. This is the normal,
  best-sounding setup.
- **Default (`provider: auto`, internet down):** Arabic still tries
  Edge first and fails (HTTP 503), because the code in
  `jarvis/models/tts.py` assumes the Piper model is English-only and
  never routes Arabic to Piper in auto mode. Downloading the Arabic
  model alone does **not** change this.
- **Offline Arabic (`provider: piper` + Arabic `piper_model`):**
  all speech goes through the downloaded Arabic Piper model,
  including Arabic — fully offline, no internet needed.
- **Trade-off:** with `provider: piper`, English text also goes
  through the Arabic model, so English will sound accented/wrong.
  If you need both languages offline, switch `provider` as needed —
  there is no per-language provider yet.

A future code change could auto-route Arabic to the Arabic Piper
model when it is present; that routing lives in
`jarvis/models/tts.py` and was deliberately left untouched here.

## Quality — honest note

Piper Arabic (`ar_JO-kareem-medium`) is intelligible and perfectly
usable offline, but it sounds noticeably less natural than
HamedNeural: flatter prosody, more robotic pacing, occasional
misreadings of diacritic-less words. Keep Edge-TTS as the default
whenever the internet is available, and treat Piper as the offline
backup, not a replacement.

## Troubleshooting

- **Script fails with a network error:** it needs internet once.
  Corporate proxies: set `HTTPS_PROXY` / `HTTP_PROXY` as usual for
  Python; the script uses `urllib` and honours proxy env vars.
- **`piper model not found`:** `piper_model` in `config.yaml` must
  point at the downloaded file, relative to the repo root
  (`data/voices/ar_JO-kareem-medium.onnx`).
- **Voice still speaks English / still 503 offline:** `provider`
  is probably still `auto` — set it to `piper` (see above) and
  restart the backend.
- **`.onnx.json` missing:** the model will not load. Re-run the
  script; it downloads the config next to the model.
- **No sound at all:** check `pip show piper-tts` and the backend
  log at `data/logs/jarvis.log` for the TTS error line.
