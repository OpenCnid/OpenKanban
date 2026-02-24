# Content Scout — Python Scripts Build Task

Build all Python pipeline scripts for Content Scout. These are deterministic data-processing scripts that get called by an AI agent as tools. They live in `scripts/content-scout/` inside an existing Next.js app (OpenKanban).

## Environment
- Python 3.12, venv at `.venv/`
- Dependencies installed: yt-dlp, Pillow, imagehash, openai, anthropic, notion-client, python-slugify, requests
- Config files already exist at `config/content-scout/` (settings.json, channels.json, keywords.json, watchlist.json)
- Output goes to `content-vault/` and intermediate files to `tmp/`
- All paths are relative to the app root (`projects/openkanban/app/`)

## Scripts to Build (16 total)

### 1. `select_videos.py` — 🐍 Deterministic
Scan channel watchlist, filter + rank videos, output selection.

```bash
python scripts/content-scout/select_videos.py \
  --channels config/content-scout/channels.json \
  --keywords config/content-scout/keywords.json \
  --log content-vault/processing-log.json \
  --limit 5 \
  --output tmp/video_list.json
```

Logic:
1. For each active channel, run `yt-dlp --flat-playlist --playlist-end 10` to get recent uploads
2. Parse: video_id, title, upload_date, duration
3. Filter: upload within last 24h, duration between min/max, not in processing log, title doesn't match excludes
4. Score: `recency * 0.3 + priority * 0.3 + keywords * 0.4`
   - recency = max(0, 24 - hours_since_upload) / 24
   - priority = {"high": 1.0, "medium": 0.6, "low": 0.3}
   - keywords = sum(3 if kw in high else 1 for kw in matched) / 10 (capped at 1.0)
5. Sort by score desc, take top N, write JSON

Output: `[{ id, url, title, channelId, channelName, channelSlug, uploadDate, duration, score }]`

### 2. `download.py` — 🐍 Deterministic
Download video + audio streams for selected videos.

```bash
python scripts/content-scout/download.py \
  --input tmp/video_list.json \
  --output-dir tmp/downloads/ \
  --max-resolution 720 \
  --delay 5
```

Per video:
1. Download video-only: `yt-dlp -f "bestvideo[height<=720]" -o "{video_id}_video.%(ext)s"`
2. Download audio-only: `yt-dlp -f "bestaudio" --extract-audio --audio-format mp3 -o "{video_id}_audio.%(ext)s"`
3. Save metadata JSON: `{video_id}_meta.json`
4. Sleep delay between downloads

### 3. `extract_frames.py` — 🐍 Deterministic
Extract frames at intervals, deduplicate with pHash.

```bash
python scripts/content-scout/extract_frames.py \
  --input-dir tmp/downloads/ \
  --output-dir tmp/frames/ \
  --interval 5 \
  --hash-threshold 5
```

Per video:
1. Find video file matching `{video_id}_video.*`
2. Run ffmpeg: `ffmpeg -i video -vf "fps=1/{interval}" -q:v 2 frame_%04d.png`
3. Compute pHash for each via `imagehash.phash()`
4. Keep frame if hamming distance ≥ threshold from ALL kept frames
5. Rename kept frames with timestamp: `frame_{timestamp}s.png` where timestamp = frame_number × interval
6. Write `_manifest.json` per video: `[{ path, timestamp, hash }]`

### 4. `transcribe.py` — 🐍 Deterministic (API wrapper)
Whisper transcription.

```bash
python scripts/content-scout/transcribe.py \
  --input-dir tmp/downloads/ \
  --output-dir tmp/transcripts/ \
  --model whisper-1
```

Per video:
1. Load `{video_id}_audio.mp3`
2. If > 25MB, split with ffmpeg: `-f segment -segment_time 600`
3. Call OpenAI Whisper with `response_format="verbose_json"`, `timestamp_granularities=["segment"]`
4. Merge chunk transcripts if split
5. Write `{video_id}.json`

### 5. `window_transcripts.py` — 🐍 Deterministic
Map frame timestamps to transcript text windows.

```bash
python scripts/content-scout/window_transcripts.py \
  --frames-dir tmp/frames/ \
  --transcripts-dir tmp/transcripts/ \
  --window 30 \
  --output tmp/windowed_frames.json
```

Per frame:
1. Read timestamp T from _manifest.json
2. Collect transcript segments where `start >= T-window` and `start <= T+window`
3. Join text
4. Build sourceUrl: `https://youtube.com/watch?v={video_id}&t={int(T)}`

Output format:
```json
[{
  "videoId": "abc123",
  "videoTitle": "SPY Analysis",
  "channelName": "TastyTrade",
  "channelSlug": "tastytrade",
  "framePath": "tmp/frames/abc123/frame_142s.png",
  "timestamp": 142,
  "sourceUrl": "https://youtube.com/watch?v=abc123&t=142",
  "transcriptWindow": "You can see SPY at this 510 support level..."
}]
```

### 6. `classify_annotate.py` — 🧠 LLM (Anthropic Vision API)
Classify and annotate frames using Claude Vision.

```bash
python scripts/content-scout/classify_annotate.py \
  --input tmp/windowed_frames.json \
  --batch-size 5 \
  --model claude-sonnet-4-20250514 \
  --output tmp/annotations.json
```

Logic:
1. Read windowed frames
2. Group into batches of batch_size
3. Per batch: encode images as base64, build prompt with transcript context
4. Call Anthropic API with vision (images + text)
5. Parse JSON response
6. Filter: keep only frames with category in (CHART, GRAPH, TABLE, SLIDE, SCREEN) and confidence >= threshold
7. Write all annotations (kept + discarded) to output

Prompt template (include in script as constant):
```
You are a stock/options trading analyst reviewing frames from a competitor's YouTube video.
Video: {title} by {channel}
For EACH frame, provide classification and (if relevant) annotation.

Categories: CHART, GRAPH, TABLE, SLIDE, SCREEN, TALKING_HEAD, FILLER
If TALKING_HEAD or FILLER, return classification only.
If CHART/GRAPH/TABLE/SLIDE/SCREEN with confidence >= 0.7, annotate:
- what: description
- key_data: array of data points
- verbal_context: what presenter says
- insight: analytical insight
- relevance: 1-5
- tags: array
- content_angle: content opportunity
- ticker: string or null
- timeframe: string or null
- indicators: array

Respond as JSON array.
```

### 7. `compress_and_store.py` — 🐍 Deterministic
Compress kept frames to WebP, organize in content-vault.

```bash
python scripts/content-scout/compress_and_store.py \
  --annotations tmp/annotations.json \
  --frames-dir tmp/frames/ \
  --output-dir content-vault/daily/$(date +%Y-%m-%d)/ \
  --format webp \
  --quality 85 \
  --max-width 1920
```

Per kept frame:
1. Load PNG
2. Resize if width > max_width (maintain aspect ratio)
3. Save as WebP at quality
4. Filename: `{channel_slug}_{video_id}_{timestamp}s.webp`
5. Build `_index.json` with full metadata

### 8. `build_tag_index.py` — 🐍 Deterministic
Build/update reverse tag index.

```bash
python scripts/content-scout/build_tag_index.py \
  --index content-vault/daily/$(date +%Y-%m-%d)/_index.json \
  --tag-index content-vault/tags/tag-index.json
```

Read annotations, update `{ "SPY": ["daily/2026-02-23/file.webp", ...], ... }`

### 9. `update_log.py` — 🐍 Deterministic
Update processing log with daily stats.

```bash
python scripts/content-scout/update_log.py \
  --video-list tmp/video_list.json \
  --annotations tmp/annotations.json \
  --log content-vault/processing-log.json
```

Append video IDs to processed list, update dailyStats for today.

### 10. `notion_sync.py` — 🐍 Deterministic (API wrapper)
Create Notion database entries.

```bash
python scripts/content-scout/notion_sync.py \
  --annotations tmp/annotations.json \
  --database-id $NOTION_CONTENT_VAULT_DB \
  --token $NOTION_TOKEN
```

Per video with kept frames:
1. Create database entry: title, date, channel, tickers, relevance, tags, status="New"
2. Add child blocks per frame (text-first, no images):
   ```
   ## [CATEGORY] description (▶️ M:SS)
   **Relevance: N/5**
   🎯 What: ...
   📊 Key Data: ...
   🗣️ Presenter Says: ...
   💡 Insight: ...
   🎬 Content Angle: ...
   🏷️ Tags: ...
   🔗 Watch: <timestamp URL>
   ```
3. Rate limit: sleep between API calls

### 11. `generate_brief.py` — 🧠 LLM (Anthropic API)
Generate position-aware daily content brief.

```bash
python scripts/content-scout/generate_brief.py \
  --annotations tmp/annotations.json \
  --watchlist config/content-scout/watchlist.json \
  --output content-vault/daily/$(date +%Y-%m-%d)/_daily-brief.md \
  --model claude-opus-4-20250514
```

Build prompt with all annotations + Hans's watchlist, call Claude Opus. Write markdown brief.

Brief structure:
1. Position Alerts — competitor analysis on Hans's positions
2. Top Themes — consensus views + contrarian angles
3. Best Visuals — relevance 4-5 with timestamp links
4. Content Opportunities — gaps + edge
5. Ticker Heatmap — all tickers + sentiment + key levels

### 12. `cleanup_tmp.py` — 🐍 Deterministic
Delete intermediate files.

```bash
python scripts/content-scout/cleanup_tmp.py --tmp-dir tmp/
```

Remove: downloads/, frames/, transcripts in tmp/. Keep: content-vault/ and config/.

### 13. `discover_channels.py` — 🐍 + 🧠 hybrid
Weekly channel discovery via YouTube API. NOT needed for v1 launch — stub it.

### 14. `check_staleness.py` — 🐍 Deterministic
Channel health monitor. NOT needed for v1 launch — stub it.

### 15. `setup_notion.py` — 🐍 Deterministic
Create Notion databases with correct schemas.

```bash
python scripts/content-scout/setup_notion.py \
  --token $NOTION_TOKEN \
  --parent-page-id PAGE_ID
```

Creates: Content Vault database, Daily Briefs database, Channels database. Outputs IDs.

### 16. `run_pipeline.py` — 🐍 Master Orchestrator
Chains all scripts together with error handling and resume.

```bash
python scripts/content-scout/run_pipeline.py [--date 2026-02-23] [--video-url URL] [--dry-run]
```

Logic:
1. Check for `tmp/_pipeline_state.json` — resume from last incomplete step if exists
2. If `--video-url` provided, skip select_videos, create single-video video_list.json
3. Run scripts in order: select → download → extract → transcribe → window → classify → compress → tags → log → notion → brief → cleanup
4. Track state after each step
5. Handle errors per the spec: skip individual video failures, fallback without transcript, continue on Notion failure
6. Print summary at end

## Code Standards
- Use `argparse` for all CLI arguments with sensible defaults
- Use `pathlib.Path` for file operations
- JSON for all data interchange
- Logging via Python `logging` module (info level by default, --verbose for debug)
- All scripts should be runnable standalone AND importable (use `if __name__ == "__main__"`)
- Handle missing files gracefully (e.g., no processing log yet = empty)
- Use type hints
- Each script should print a summary at exit (e.g., "Selected 5 videos", "Extracted 47 unique frames")

## Don't Do
- Don't write tests (not yet)
- Don't create TypeScript files (those come later)
- Don't modify existing OpenKanban code
- Don't create a setup.py or pyproject.toml (these are standalone scripts)
