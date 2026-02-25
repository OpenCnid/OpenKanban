---
title: Content Pipeline
domain: project
last-verified: 2026-02-25
status: current
---

# Content Pipeline (Content Scout + Transcript Studio)

## What It Does

Monitors YouTube channels, downloads videos, extracts frames, transcribes audio, classifies visuals, and generates daily briefs. Two related pipelines:

1. **Content Scout** — daily monitoring + brief generation
2. **Transcript Studio** — deep single-video processing with Notion export

## Pipeline Steps (12)

select → download → extract → transcribe (local GPU) → window → classify → merge → summarize → export (Notion) → log → archive → cleanup

## Key Scripts

| Script | Purpose |
|--------|---------|
| `scripts/content-scout/run_pipeline.py` | Main orchestrator |
| `scripts/content-scout/select_videos.py` | Channel + playlist monitoring |
| `scripts/content-scout/transcribe_local.py` | mlx-whisper + pyannote diarization |
| `scripts/content-scout/merge_visuals.py` | Interleave frames into transcript |
| `scripts/content-scout/summarize_video.py` | LLM summary generation |
| `scripts/content-scout/export_notion.py` | Notion page builder |

## Configuration
- Channel configs: `config/content-scout/channels.json`
- Playlists: `config/content-scout/playlists.json`
- Presets: `config/content-scout/presets/{default,podcast,presentation,suno}.json`

## Hans's Real Use Case
NOT primarily "what content should I make" — it's **thesis validation**: "I'm worried about credit markets, did anyone in my shows talk about it?"

## Dependencies
- Apple Silicon Mac (mlx-whisper for free local transcription)
- ffmpeg, yt-dlp, Python 3.10+, PIL/Pillow, imagehash, python-slugify
- HuggingFace token for pyannote speaker diarization
- Optional: OpenAI API (transcription fallback), Notion API

## Cost
~$0.15-0.40/video (LLM classification + summary only). Transcription free on Apple Silicon.

## Blocking Items
1. Hans's Notion workspace + API token
2. Mac Studio deployment
3. Image storage for Notion embeds (Cloudflare R2 recommended)
