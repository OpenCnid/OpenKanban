---
title: Deployment
domain: project
last-verified: 2026-02-25
status: current
---

# OpenKanban Deployment

## Local Development
```bash
cd ~/clawd/projects/openkanban/app
npm install
npm run dev    # port 3000
```

## Production Setup

### Prerequisites
- Node.js 20+
- OpenClaw gateway running with WebSocket enabled
- Gateway config: `gateway.tools.allow: ["sessions_spawn", "sessions_send", "cron"]`

### Environment
```env
OPENCLAW_GATEWAY_URL=ws://localhost:4040
OPENCLAW_GATEWAY_TOKEN=<gateway auth token>
OPENCLAW_HTTP_URL=http://localhost:4040
```

### Database
SQLite (better-sqlite3) — no cloud dependency. DB file created automatically on first run.
Located at `data/openkanban.db` (gitignored).

### Build
```bash
npm run build
npm start
```

## Hans Deployment (Future)
Mac Studio target. Will need:
- OpenClaw gateway running as system service
- OpenKanban running as persistent process (pm2 or systemd)
- Local network access for Hans's devices
- Content Scout dependencies: yt-dlp, ffmpeg, Python 3.10+, mlx-whisper (Apple Silicon)

## Content Scout Dependencies
For the content pipeline scripts:
```bash
pip install pillow imagehash python-slugify
# For transcription (Apple Silicon only):
pip install mlx-whisper pyannote-audio
# HuggingFace token needed for pyannote speaker diarization model
```
