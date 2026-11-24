# Video builder (second slice — lightweight, draft-only)

Build short draft videos inside Jarvis: write a script, split it into
scenes, and render one still image + spoken narration per scene into a
local `draft.mp4`. Built for a weak laptop (~7 GB RAM, laptop GPU): no
GPU models, no model downloads, no heavy RAM use — ffmpeg only ever
holds one 720p frame and one audio stream at a time.

## Setup

ffmpeg is required and is **not** installed by Jarvis:

- Windows: `winget install Gyan.FFmpeg`
- macOS: `brew install ffmpeg`
- Ubuntu/Debian: `sudo apt install ffmpeg`

Narration uses the existing Edge-TTS path (`cfg.voice.edge_voice`,
Arabic default) and needs internet, like the rest of Jarvis TTS. If
narration fails for a scene, that scene renders **silent** and is listed
in the result — the job still finishes.

## Workflow

1. Create a project (optionally from a script — blank lines split scenes):
   `video_create_project(name="My video", topic="space", script="...")`
2. Add scenes if needed: `video_add_scene(project_id, narration="...", image="path/to/still.png")`
   - `duration_seconds` is optional; it is estimated from the words.
   - `image` is optional; scenes without an image use a plain dark background.
3. Render: `video_render_draft(project_id)` →
   `data/video/<id>-<name>/draft.mp4` (plus `draft.srt` and `cover.jpg`
   in the same folder — see Slice 2 below)
4. Watch the file, then refine the script and re-render. Re-rendering
   overwrites the draft.

## Slice 2 — subtitles, transitions, thumbnail

- **Subtitles.** One SRT cue per scene, timed to the final video
  (crossfades pull later scenes earlier, and the timings account for
  that). Output is twofold: a `draft.srt` sidecar next to the video,
  and a soft `mov_text` subtitle track muxed into the mp4
  (`ffmpeg -i draft.mp4 -i draft.srt -map 0:v -map 0:a -map 1 -c copy
  -c:s mov_text`, tagged `language=ara` for Arabic). Default is auto:
  on when any narration contains Arabic script, off otherwise;
  pass `subtitles=true/false` to force it. Silent scenes get no cue.
- **Transitions.** A 0.5s crossfade between consecutive scenes
  (`xfade` video + `acrossfade` audio, one extra encode pass with the
  same libx264/AAC settings). On by default; `transitions=false`
  restores the old fast stream-copy concat. `transition_seconds`
  changes the length (max 2s, clamped to half the shortest scene so
  no scene is eaten by its fades). Single-scene projects never fade.
- **Thumbnail.** `cover.jpg` is extracted from the middle of the
  first scene (`ffmpeg -ss <d1/2> -i draft.mp4 -frames:v 1 -q:v 2`).
  A thumbnail failure only warns — the video is unaffected.

## Tools

| Tool | Permission | What it does |
| --- | --- | --- |
| `video_create_project` | CAUTION | Create a draft project, optionally from a script |
| `video_add_scene` | CAUTION | Add one scene (narration + optional image) |
| `video_list_projects` | SAFE | List projects, status, scene counts |
| `video_render_draft` | CAUTION | Render a local draft mp4 (720p, ffmpeg) — optional `subtitles`, `transitions`, `transition_seconds` |

## Limits (deliberate, first slice)

- **No video generation.** Scenes are still images you provide (or a
  plain background). AI image generation already exists in Jarvis
  (`media` plugin) — use it to make the stills.
- **No publishing.** There is no tool that uploads or schedules a video
  anywhere. Review the draft file yourself first.
- **No cloud service.** A cloud video service is an optional future path,
  not this slice.
- **720p default, one clip per scene.** Higher resolutions are future
  work; keep renders short while the laptop is the limit. Transitions
  (slice 2) cost one extra encode pass but no extra RAM.
- Narration is Edge-TTS (cloud, needs internet). Offline Piper narration
  is not wired here — Piper's model is English-only.
