# Video Transcript Creator — Build Spec

**Codename:** Transcript Studio  
**Client:** Hans  
**Runtime:** OpenClaw on Mac Studio (Apple Silicon)  
**Status:** Spec draft v1  

---

## 1. What This Is

An OpenClaw pipeline that takes YouTube videos (links, playlists, monitored channels) and produces a **Notion page per video** containing:

1. Full transcript with speaker diarization + 1-minute timestamps
2. Key visual frames (charts, slides, screen content) embedded at correct positions
3. Summary package: takeaways, chapters, shorts candidates, slide suggestions
4. Visual index
5. Raw transcript in a toggle block

Hans drops a link or playlist → pipeline runs → Notion page appears in his Transcript Studio database, filterable by channel, date, topic, and preset.

---

## 2. What Changes From Hans's Original Spec

Hans's spec assumed a freelancer building from scratch on his HP Z4 (NVIDIA GPU). Our version:

| Original Spec | Our Version | Why |
|---|---|---|
| Watch folders for local video drops | OpenClaw triggers (cron, chat, API) | No local folders needed — everything is URL-driven on Mac Studio |
| NVIDIA CUDA (HP Z4) | Apple Silicon MLX/Metal (Mac Studio) | Different GPU, same speed |
| Standalone scripts | OpenClaw skill/pipeline | Integrated with Hans's existing OpenKanban workflow |
| Build from scratch | Extend Content Scout | 60%+ of the pipeline already exists |

**Removed:** Watch folders, local file drops, per-creator folder structure (unnecessary when URL-driven).  
**Kept:** Everything else — diarization, visual classification, presets, summaries, playlist monitoring. Notion replaces Google Docs as the output layer (database views, search, tagging).

---

## 3. Architecture

```
Input (YouTube URL / Playlist / Channel poll)
  │
  ├─ 1. INGEST ──────── yt-dlp download + metadata extraction
  │
  ├─ 2. TRANSCRIBE ──── mlx-whisper (Apple Silicon GPU) + speaker diarization
  │                      → structured transcript with speakers, timestamps, paragraphs
  │
  ├─ 3. EXTRACT ─────── ffmpeg frame extraction + perceptual hash dedup
  │                      [REUSE: extract_frames.py from Content Scout]
  │
  ├─ 4. CLASSIFY ────── Vision LLM classifies frames
  │                      CHART_VISUAL / SCREEN / SLIDE / GRAPHIC → KEEP
  │                      TALKING_HEAD / FILLER → DISCARD (unless meaningful)
  │                      [REUSE: classify_annotate.py — new prompt for this context]
  │
  ├─ 5. MERGE ────────── Place visuals into transcript at correct timestamp positions
  │                      [NEW — core new piece]
  │
  ├─ 6. SUMMARIZE ───── LLM generates: takeaways, chapters, shorts, slide suggestions
  │                      [NEW — different from Content Scout's competitive brief]
  │
  ├─ 7. EXPORT ──────── Build Notion page with all sections + embedded images
  │                      [NEW — extends existing notion_sync.py pattern]
  │
  └─ 8. ARCHIVE ─────── Update processing log, save local artifacts
                         [REUSE: update_log.py, archive pattern]
```

---

## 4. Reusable From Content Scout

These scripts work as-is or with minor adaptation:

| Script | Reuse Level | Notes |
|---|---|---|
| `_common.py` | **As-is** | Shared utilities, path resolution, JSON helpers |
| `download.py` | **As-is** | yt-dlp download with metadata extraction |
| `extract_frames.py` | **As-is** | ffmpeg + perceptual hash dedup |
| `select_videos.py` | **Adapt** | Add playlist support, remove keyword scoring |
| `classify_annotate.py` | **Adapt** | New prompt focused on "is this worth embedding?" not competitive intel |
| `window_transcripts.py` | **Adapt** | Attach transcript context to frames for classification |
| `update_log.py` | **As-is** | Dedup tracking |
| `run_pipeline.py` | **Fork** | New step sequence, same resume/state pattern |
| `cleanup_tmp.py` | **As-is** | Temp file cleanup |
| `notion_sync.py` | **Adapt** | Already creates Notion pages with blocks — extend for full transcript pages |
| `setup_notion.py` | **Adapt** | Already bootstraps Notion databases — add Transcript Studio schema |

**New scripts needed:** 4 (transcribe_local, merge_visuals, summarize_video, export_notion)

**Existing Notion infrastructure** (currently blocked on Hans's workspace + API token):
- `notion_sync.py` — creates pages per video with frame annotation blocks
- `setup_notion.py` — creates Content Vault, Daily Briefs, Channels databases
- Both use `notion-client` Python SDK, handle rate limiting, block pagination

For Transcript Studio, we add a **new database** ("Transcript Studio") alongside the existing Content Vault. Same Notion workspace, different database, much richer page content (full transcript + embedded images vs. just annotation highlights).

---

## 5. Step Details

### 5.1 Ingest (download.py — reuse)

Already handles:
- yt-dlp download with resolution cap
- Metadata extraction (title, channel, duration, upload date)
- Audio file extraction

**Add:** Playlist expansion mode. Currently `select_videos.py` handles channel monitoring. Need a path for:
```
--playlist "https://youtube.com/playlist?list=PLxxxxxxx"
```
That expands the playlist → filters out already-processed IDs → queues new ones.

### 5.2 Transcribe (NEW: transcribe_local.py)

**Engine:** [mlx-whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper) — Whisper running natively on Apple Silicon via MLX framework. Near real-time on M-series chips.

**Model:** `large-v3` (best accuracy, runs fine on Mac Studio's unified memory)

**Speaker Diarization:** [pyannote-audio](https://github.com/pyannote/pyannote-audio) 3.x
- Runs on CPU (fast enough for post-processing)
- Requires HuggingFace token (free, one-time accept of model terms)
- Assigns Speaker 1, Speaker 2, etc. to each segment

**Output:** `transcript_structured.json`
```json
{
  "videoId": "abc123",
  "segments": [
    {
      "start": 0.0,
      "end": 4.2,
      "text": "Welcome back to the show.",
      "speaker": "Speaker 1",
      "minute_mark": "00:00"
    },
    {
      "start": 4.2,
      "end": 12.8,
      "text": "Today we're looking at credit spreads and why everyone's getting this wrong.",
      "speaker": "Speaker 1",
      "minute_mark": "00:00"
    }
  ],
  "speakers": ["Speaker 1", "Speaker 2"],
  "full_text": "...",
  "raw_text": "..."
}
```

**Timestamp markers:** Every 60 seconds, insert a `--- [MM:SS] ---` boundary in the formatted output. This is what frames anchor to during the merge step.

**Dual output:**
- `transcript_clean.txt` — formatted with speakers, paragraphs, timestamps
- `transcript_raw.txt` — minimal processing, included in final doc

### 5.3 Extract Frames (extract_frames.py — reuse as-is)

Already does:
- ffmpeg frame extraction at configurable interval (default 15s, could do 5s for slides-heavy)
- Perceptual hash deduplication (imagehash, configurable threshold)
- Outputs numbered frames per video

### 5.4 Classify Frames (classify_annotate.py — adapt prompt)

Current prompt is geared toward competitive content intelligence. New prompt for Transcript Studio:

```
You are analyzing video frames to decide which should be EMBEDDED in a 
transcript document. The reader wants to see charts, slides, screen content, 
and meaningful graphics — NOT talking heads or filler.

For each frame, classify:
- EMBED: chart, slide, screen share, data table, meaningful graphic
- SKIP: talking head, filler, intro/outro, sponsor

For EMBED frames, provide:
- type: chart | slide | screen | table | graphic | diagram
- description: 1-line description of what's shown
- importance: 1-5 (5 = critical visual, reader NEEDS to see this)
```

Much simpler than the content intel prompt. Faster, cheaper per frame.

### 5.5 Merge Visuals Into Transcript (NEW: merge_visuals.py)

The key new piece. Takes:
- `transcript_structured.json` (with minute marks)
- Classified frames (EMBED only, with timestamps)
- Frame image files

Produces: `merged_transcript.json` — an ordered sequence of blocks:

```json
[
  { "type": "timestamp", "value": "00:00" },
  { "type": "text", "speaker": "Speaker 1", "text": "Welcome back..." },
  { "type": "text", "speaker": "Speaker 1", "text": "Today we're looking at..." },
  { "type": "visual", "timestamp": "00:45", "label": "Chart - S&P 500 YTD", "image_path": "frames/frame_45s.png", "description": "..." },
  { "type": "text", "speaker": "Speaker 2", "text": "Right, and if you look at..." },
  { "type": "timestamp", "value": "01:00" },
  ...
]
```

**Insertion logic:**
1. Each frame has a timestamp (e.g., 45s)
2. Find the transcript segment closest to that timestamp
3. Insert the visual block AFTER that segment
4. If multiple frames cluster at the same timestamp, insert in order

### 5.6 Summarize (NEW: summarize_video.py)

LLM-generated summary package. Input: full transcript + frame annotations.

**Sections generated:**

**A) Key Takeaways (5-10)**
- Each with timestamp reference
- Neutral tone

**B) Chapter List (8-14)**
```
00:00 Introduction
02:15 Credit Spreads Overview  
05:30 Why Most Traders Get This Wrong
...
```

**C) Shorts/Clip Candidates (10-14)**
Each includes:
- Timestamp range (start → end)
- Hook line (what grabs attention)
- Payoff line (the insight/punchline)
- On-screen text suggestion (≤6 words)
- Soft CTA

**D) Slide/Graphic Suggestions**
- If video has slides: identify key slide moments
- If video lacks slides: suggest what visuals WOULD help

**Output:** `summary.json` + `summary.md`

### 5.7 Export to Notion (NEW: export_notion.py)

**Notion as the output layer.** Each processed video becomes a page in a Notion database — filterable, searchable, taggable. Way better than a flat folder of Google Docs.

We already have `notion_sync.py` (syncs annotation highlights) and `setup_notion.py` (bootstraps database schema). This new script builds the **full transcript page** — not just highlights but the complete document Hans wants.

**Why Notion over Google Docs:**
- Database views → filter by channel, date, topic, preset, status
- Linked databases → cross-reference videos, playlists, briefs
- Native search across all transcripts
- Toggle blocks → collapse raw transcript, visual index (keeps pages clean)
- Integrates with Hans's existing workspace
- API handles images as external URLs (upload to Cloudflare R2 or S3, embed via URL)

**Notion Database: "Transcript Studio"**

| Property | Type | Purpose |
|---|---|---|
| Name | Title | `[Video Title] — [Channel]` |
| Date | Date | Processing date |
| Channel | Select | Source channel name |
| Preset | Select | default / podcast / presentation / suno |
| Duration | Number | Video length in minutes |
| Speakers | Number | Count of detected speakers |
| Status | Select | Processing / Ready / Reviewed |
| Source URL | URL | YouTube link |
| Video ID | Rich text | Dedup key |
| Tags | Multi-select | Topics, tickers, themes |
| Playlist | Select | Which playlist it came from (if any) |

**Page Content Structure (Notion blocks):**

```
📄 Page: "Credit Spreads Deep Dive — tastylive"

┌─ Callout Block ─────────────────────────┐
│ 📺 Source: [YouTube URL]                │
│ 🎙️ Speakers: 2 | Duration: 28:15       │
│ 📅 Uploaded: 2026-02-24 | Preset: default│
└──────────────────────────────────────────┘

── Heading 1: Summary ──

  Toggle: Key Takeaways (5-10)
    1. [takeaway] — [timestamp link]
    ...

  Toggle: Chapters
    00:00 Introduction
    02:15 Credit Spreads Overview
    ...

  Toggle: Shorts/Clip Candidates (10-14)
    Clip 1: [02:15 → 03:40]
      Hook: ...
      Payoff: ...
      ...

  Toggle: Slide/Graphic Notes
    ...

── Heading 1: Transcript with Visuals ──

  Paragraph: --- [00:00] ---
  
  Paragraph: **Speaker 1:** Welcome back to the show. 
  Today we're looking at credit spreads...

  Paragraph: **Speaker 2:** Right, and this is where 
  it gets interesting because...

  ┌─ Image Block ──────────────────────────┐
  │  [Visual @ 00:45 — Chart]             │
  │  S&P 500 YTD Performance              │
  │  [FULL-WIDTH EMBEDDED IMAGE]          │
  └────────────────────────────────────────┘

  Paragraph: **Speaker 1:** As you can see on the chart...

  Paragraph: --- [01:00] ---
  ...

── Heading 1: Visual Index ── (Toggle)

  Table Block:
  | Timestamp | Type  | Description             |
  |-----------|-------|-------------------------|
  | 00:45     | Chart | S&P 500 YTD Performance |
  | 03:12     | Slide | Credit Spread Mechanics  |

── Heading 1: Raw Transcript ── (Toggle, collapsed by default)

  [Full unformatted transcript text]
```

**Image handling:**
- Upload frame images to object storage (Cloudflare R2 — cheap, fast, S3-compatible)
- Embed in Notion as external image blocks with the R2 URL
- R2 free tier: 10GB storage, 10M reads/month — more than enough
- Alternative: Supabase Storage (already have a project) if we want to keep it in-stack

**Auth:** Notion API token (internal integration) stored in 1Password on Mac Studio → injected via `op run`.

### 5.8 Archive + Dedup (reuse pattern)

- `processing-log.json` tracks processed video IDs (no re-processing)
- Local artifacts saved to `output/{video-id}/` (frames, transcripts, summary)
- Cleanup tmp after successful export

---

## 6. Presets

Presets control pipeline behavior per video type. Stored in `config/presets/`.

### Default (Finance/Tech)
```json
{
  "name": "default",
  "frame_interval": 15,
  "hash_threshold": 5,
  "classify_prompt": "transcript_studio_default",
  "summary_sections": ["takeaways", "chapters", "shorts", "slides"],
  "whisper_model": "large-v3",
  "image_size": "large"
}
```

### Podcast/Interview
```json
{
  "name": "podcast",
  "frame_interval": 30,
  "hash_threshold": 8,
  "classify_prompt": "transcript_studio_minimal",
  "summary_sections": ["takeaways", "chapters", "shorts"],
  "whisper_model": "large-v3",
  "image_size": "large",
  "notes": "Fewer frames — most content is audio. Only capture screen shares."
}
```

### Slides-Heavy / Presentation
```json
{
  "name": "presentation",
  "frame_interval": 5,
  "hash_threshold": 3,
  "classify_prompt": "transcript_studio_aggressive",
  "summary_sections": ["takeaways", "chapters", "shorts", "slides"],
  "whisper_model": "large-v3",
  "image_size": "large",
  "notes": "Capture every slide change. Most aggressive frame extraction."
}
```

### Suno (Music/Tool Updates)
```json
{
  "name": "suno",
  "frame_interval": 10,
  "hash_threshold": 5,
  "classify_prompt": "transcript_studio_default",
  "summary_sections": ["takeaways", "chapters", "shorts", "slides", "suno_features"],
  "whisper_model": "large-v3",
  "image_size": "large",
  "notes": "Adds a 'New Workflows & Features' brief section at top."
}
```

**Preset selection:** Pass `--preset podcast` to the pipeline, or configure per-channel in `channels.json`:
```json
{
  "tastylive": { "channelId": "...", "preset": "podcast" },
  "projectfinance": { "channelId": "...", "preset": "presentation" }
}
```

---

## 7. YouTube Monitoring

### Channels (daily poll via OpenClaw cron)
Same pattern as Content Scout — `select_videos.py` adapted to also check playlists.

### Playlists (the critical feature)
Hans adds videos to playlists constantly. The pipeline must:
1. Poll tracked playlists daily
2. Detect new additions (even if the video itself is old)
3. Queue new additions for processing
4. Track by `(playlist_id, video_id)` pair in processing log

```json
// config/playlists.json
{
  "playlists": [
    {
      "url": "https://youtube.com/playlist?list=PLxxxxxxx",
      "name": "Hans Master Watch",
      "preset": "default"
    }
  ]
}
```

### Single URL (on-demand)
```bash
python run_transcript_pipeline.py --video-url "https://youtube.com/watch?v=xxx" --preset podcast
```

Or via OpenClaw chat: Hans says "process this video: [URL]" → OpenClaw triggers pipeline.

---

## 8. Mac Studio Setup Requirements

### Python Environment
```bash
# Create dedicated venv
python3 -m venv ~/transcript-studio-env
source ~/transcript-studio-env/bin/activate

# Core dependencies
pip install mlx-whisper          # Apple Silicon Whisper
pip install pyannote-audio       # Speaker diarization
pip install notion-client        # Notion API
pip install imagehash pillow     # Frame dedup
pip install python-slugify       # Slugification
pip install yt-dlp               # YouTube download
pip install anthropic openai     # LLM classification + summarization

# System
brew install ffmpeg              # Frame extraction + audio processing
```

### GPU Validation
```bash
python -c "import mlx.core as mx; print(mx.default_device())"
# Should output: Device(gpu, 0)
```

### Notion Auth
1. Create Notion internal integration at https://www.notion.so/my-integrations
2. Give it "Read content", "Insert content", "Update content" capabilities
3. Share the target Notion page/database with the integration
4. Store API token in 1Password → inject as `NOTION_TOKEN` via `op run`

### Image Storage (for Notion embeds)
Notion external image blocks need a public URL. Options:
1. **Cloudflare R2** — cheapest (free tier: 10GB, 10M reads/mo), S3-compatible
2. **Supabase Storage** — already in-stack (`skleqjejhrtrhlvhyirk`)
3. **Vercel Blob** — simple but costs more at scale

Recommended: Cloudflare R2 (set up once, forget about it)

### HuggingFace Auth (for pyannote)
1. Create HF account
2. Accept pyannote/speaker-diarization-3.1 model terms
3. Generate access token
4. Store in 1Password → inject as `HF_TOKEN`

---

## 9. OpenClaw Integration

### As a Skill
```
skills/transcript-studio/
├── SKILL.md
├── scripts/
│   ├── _common.py
│   ├── run_transcript_pipeline.py
│   ├── transcribe_local.py
│   ├── merge_visuals.py
│   ├── summarize_video.py
│   └── export_notion.py
└── config/
    ├── presets/
    ├── channels.json
    └── playlists.json
```

### Triggers
1. **Cron:** Daily playlist/channel poll (morning)
2. **Chat:** "Process this video: [URL]" → triggers single-video mode
3. **API:** `POST /api/workflows/trigger` from OpenKanban UI (Mission: "Process latest Jordi video")

### OpenKanban Template
A pre-built workflow template: "Process YouTube Video"
- Step 1: Download + extract
- Step 2: Transcribe (GPU)
- Step 3: Classify + merge
- Step 4: Summarize + export
- Review checkpoint after Step 4 (Hans approves before Doc is created, or auto-approve)

---

## 10. Build Plan

### Phase 1 — Local Transcription Engine (Week 1)
- [ ] `transcribe_local.py` with mlx-whisper + pyannote diarization
- [ ] Test on Mac Studio with 2-3 sample videos
- [ ] Validate: speakers detected, timestamps accurate, paragraphing clean
- [ ] Output both structured JSON and clean/raw text

### Phase 2 — Visual Merge + Summary (Week 1-2)

- [ ] `merge_visuals.py` — interleave frames into transcript
- [ ] `summarize_video.py` — chapters, takeaways, shorts, slides
- [ ] Adapt classify prompt for embed/skip (simpler than content intel)
- [ ] Test end-to-end: URL → merged transcript + summary

### Phase 3 — Notion Export (Week 2)
- [ ] `export_notion.py` — full page builder with all sections
- [ ] Image upload to R2/Supabase Storage → embed as external URLs
- [ ] Notion block formatting (headings, toggles, tables, callouts, images)
- [ ] `setup_transcript_db.py` — bootstrap Transcript Studio database in Notion
- [ ] Test with real video → verify page looks right

### Phase 4 — Playlist Monitoring + Presets (Week 2-3)
- [ ] Playlist expansion in select_videos.py
- [ ] Preset system (config files + CLI flag)
- [ ] Suno preset with features brief
- [ ] Channel + playlist daily cron via OpenClaw

### Phase 5 — OpenClaw Skill + OpenKanban Template (Week 3)
- [ ] Package as OpenClaw skill
- [ ] Wire up chat trigger ("process this video")
- [ ] OpenKanban workflow template
- [ ] Documentation + quick start guide

---

## 11. Acceptance Tests

Same as Hans's spec, adapted for our stack:

| Test | Video Type | Pass Criteria |
|---|---|---|
| Test 1 | Slides-heavy presentation | Every slide captured, embedded at correct position |
| Test 2 | Screen share with charts | Charts/graphs captured, talking head filtered out |
| Test 3 | Talking head podcast | Minimal frames (only if screen content appears), diarization works |
| Test 4 | Playlist with 3 videos | All 3 processed, no duplicates, 3 separate Notion pages |
| Test 5 | Suno tutorial | Features brief section generated at top |

**Universal pass criteria:**
- Timestamps every 1 minute in transcript
- Speaker diarization present and reasonable
- Visuals embedded at chronologically correct positions
- Notion page created with all sections in correct order
- Large images (full-width in page)
- No duplicate processing on re-run

---

## 12. Cost Estimate

| Component | Cost | Notes |
|---|---|---|
| Transcription (mlx-whisper) | **$0** | Local GPU, no API |
| Diarization (pyannote) | **$0** | Local CPU |
| Frame extraction (ffmpeg) | **$0** | Local |
| Classification (vision LLM) | **~$0.10-0.25/video** | ~30-50 frames × vision API |
| Summary (LLM) | **~$0.05-0.15/video** | Single call with full transcript |
| Notion API | **$0** | Free for internal integrations |
| Image storage (R2) | **$0** | Free tier: 10GB + 10M reads/mo |
| YouTube download | **$0** | yt-dlp is free |

**Total: ~$0.15-0.40 per video** (only LLM classification + summary costs).

At 3-5 videos/day = **$14-60/month**. Compared to hiring a freelancer, this is effectively free.

---

*Spec v1 — ready for review. The 4 new scripts are the real work; everything else is adaptation.*
