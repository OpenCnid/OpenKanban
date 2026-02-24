# Transcript Studio — Overview for Hans

## What It Does

Drop a YouTube link, playlist, or let it auto-poll your tracked channels daily. For each video, you get a **Notion page** with:

- **Full transcript** — speaker diarization (Speaker 1 / Speaker 2), punctuation, paragraphs, timestamp markers every minute
- **Visuals embedded in-line** — charts, slides, screen shares placed at the exact moment they appear (talking head frames filtered out)
- **Summary package** — key takeaways with timestamps, chapter list, 10-14 shorts/clip candidates with hooks + payoffs, slide/graphic suggestions
- **Visual index** — table of every captured visual with timestamp + description
- **Raw transcript** — collapsed at the bottom for reference

Everything lives in a **Notion database** — filter by channel, date, topic, preset. Search across all your transcripts.

---

## How It Works

```
You say "process this video" or add to a playlist
        ↓
   Auto-download via yt-dlp
        ↓
   Transcribe locally on Mac Studio GPU (Apple Silicon)
   Speaker diarization — who said what
        ↓
   Extract frames → classify each one
   Charts/slides/screens = KEEP
   Talking heads/filler = SKIP
        ↓
   Merge visuals into transcript at correct timestamps
        ↓
   Generate summary (takeaways, chapters, shorts candidates)
        ↓
   Notion page created with everything embedded
```

Runs on your Mac Studio via OpenClaw. Triggers from chat, cron schedule, or OpenKanban mission.

---

## What a Notion Page Looks Like

```
📄 "Credit Spreads Deep Dive — tastylive"

📺 Source: youtube.com/watch?v=...
🎙️ Speakers: 2 | Duration: 28:15
📅 Feb 24, 2026 | Preset: Default

━━━ SUMMARY ━━━

▸ Key Takeaways (click to expand)
  1. Credit spreads widening signals risk-off — [12:34]
  2. Dollar selloff reversed intraday — [05:15]
  ...

▸ Chapters
  00:00  Introduction
  02:15  Credit Spreads Overview
  05:30  Why Most Traders Get This Wrong
  ...

▸ Shorts/Clip Candidates
  Clip 1 [02:15 → 03:40]
    Hook: "Everyone's doing credit spreads wrong"
    Payoff: "Here's what the bond market is actually telling you"
    On-screen: "CREDIT SPREAD TRAP"
  ...

━━━ TRANSCRIPT WITH VISUALS ━━━

--- [00:00] ---

Speaker 1: Welcome back to the show. Today we're
looking at credit spreads and why everyone's 
getting this wrong.

Speaker 2: Right, and this is where it gets
interesting because...

  ┌──────────────────────────────┐
  │  📊 Visual @ 00:45 — Chart  │
  │  S&P 500 YTD Performance    │
  │  [FULL-WIDTH IMAGE]         │
  └──────────────────────────────┘

Speaker 1: As you can see on the chart...

--- [01:00] ---
...

▸ Visual Index (click to expand)
  | Time  | Type  | Description             |
  | 00:45 | Chart | S&P 500 YTD Performance |
  | 03:12 | Slide | Credit Spread Mechanics  |

▸ Raw Transcript (click to expand)
  [full unformatted text]
```

---

## Presets

Different video types get different treatment:

| Preset | Frame Capture | Best For |
|---|---|---|
| **Default** | Every 15s, deduped | Finance/tech videos |
| **Podcast** | Every 30s, minimal | Talking-head interviews (only captures screen shares) |
| **Presentation** | Every 5s, aggressive | Slide-heavy content (catches every slide change) |
| **Suno** | Every 10s | Adds a "New Workflows & Features" section at the top |

Assign presets per channel or per video. Your tastylive might be "default" while a presentation channel is "presentation."

---

## Three Ways to Trigger

1. **Chat:** Tell OpenClaw "process this video: [URL]"
2. **Playlist:** Add videos to a tracked YouTube playlist — pipeline picks up new additions daily
3. **Channels:** Auto-poll 5-6 tracked channels every morning for new uploads + livestream replays

All managed through OpenClaw on the Mac Studio.

---

## What It Costs

| Component | Cost |
|---|---|
| Transcription | **$0** — runs locally on Mac Studio GPU |
| Speaker detection | **$0** — runs locally |
| Frame extraction | **$0** — runs locally |
| AI classification + summary | **~$0.15-0.40/video** |
| Notion | **$0** — free API |
| YouTube download | **$0** |

**~$15-60/month** at 3-5 videos/day. Everything heavy runs on your hardware.

---

## What We Need From You

1. **Notion workspace access** — create an internal integration, share the API token
2. **YouTube channels/playlists** — which creators to monitor, which playlists to track
3. **Preset preferences** — which channels get which preset (or we start with default for all)
4. **HuggingFace account** — free, needed for the speaker diarization model (one-time setup)

---

## Timeline

| Phase | What | When |
|---|---|---|
| 1 | Transcription engine (local GPU + speaker detection) | Week 1 |
| 2 | Visual merge + summary generation | Week 1-2 |
| 3 | Notion export (full pages with embedded images) | Week 2 |
| 4 | Playlist monitoring + presets | Week 2-3 |
| 5 | OpenClaw integration + OpenKanban mission template | Week 3 |

---

*Built on top of the Content Scout pipeline that's already running. ~60% of the code already exists — the new pieces are local transcription, visual-transcript merging, summary generation, and Notion export.*
