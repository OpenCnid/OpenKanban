/**
 * Content Scout — OpenKanban Workflow Templates
 * These register with the existing workflow engine from weeks 1-5.
 */

export const CONTENT_SCOUT_DAILY_TEMPLATE = {
  name: 'Content Scout — Daily',
  slug: 'content-scout-daily',
  description: 'Autonomous daily scan of competitor YouTube channels. Selects videos, extracts frames, transcribes audio, classifies visuals with AI, stores to Notion + local files, and generates a position-aware content brief.',
  steps: [
    {
      name: 'Select + Download + Extract + Transcribe',
      agentId: 'content-scout',
      prompt: [
        'Run the Content Scout deterministic preprocessing pipeline.',
        'Execute: cd projects/openkanban/app && source .venv/bin/activate && python scripts/content-scout/run_pipeline.py --steps select,download,extract,transcribe,window',
        'This handles: video selection (keyword matching), downloading via yt-dlp, frame extraction via ffmpeg, pHash deduplication, Whisper transcription, and transcript windowing.',
        'Output: tmp/windowed_frames.json ready for classification.',
        'Report: number of videos selected, frames extracted, frames after dedup, transcript minutes.',
      ].join('\n'),
      timeout: 900,
      dependsOn: [] as string[],
    },
    {
      name: 'Classify + Annotate',
      agentId: 'content-analyst',
      prompt: [
        'Run the Content Scout classification pipeline.',
        'Execute: cd projects/openkanban/app && source .venv/bin/activate && python scripts/content-scout/classify_annotate.py --input tmp/windowed_frames.json --output tmp/annotations.json',
        'This calls Claude Vision (Sonnet) to classify each frame (CHART, GRAPH, TABLE, SLIDE, SCREEN, TALKING_HEAD, FILLER) and annotate kept frames with: what it shows, key data, verbal context from transcript, insight, relevance score, tags, content angle, ticker, timeframe, indicators.',
        'Report: frames classified, frames kept, top categories, top tickers.',
      ].join('\n'),
      timeout: 600,
      dependsOn: ['Select + Download + Extract + Transcribe'],
    },
    {
      name: 'Store + Brief + Deliver',
      agentId: 'content-scout',
      prompt: [
        'Run the Content Scout storage and brief generation pipeline.',
        'Execute: cd projects/openkanban/app && source .venv/bin/activate && python scripts/content-scout/run_pipeline.py --steps compress,tags,log,notion,brief,cleanup',
        'This handles: image compression to WebP, tag index update, processing log update, Notion sync (text-first with timestamp links), position-aware content brief via Claude Opus, and tmp cleanup.',
        'Report: frames stored, Notion entries created, brief location, estimated cost.',
      ].join('\n'),
      timeout: 600,
      dependsOn: ['Classify + Annotate'],
    },
  ],
  reviewCheckpoints: [] as string[],
  schedule: '0 6 * * *',
  autonomous: true,
} as const;

export const CONTENT_SCOUT_SINGLE_TEMPLATE = {
  name: 'Content Scout — Single Video',
  slug: 'content-scout-single',
  description: 'Process a single YouTube video on demand — fully autonomous, no approval needed.',
  steps: [
    {
      name: 'Process Video',
      agentId: 'content-scout',
      prompt: [
        'Run the full Content Scout pipeline for a single video.',
        'Execute: cd projects/openkanban/app && source .venv/bin/activate && python scripts/content-scout/run_pipeline.py --video-url {url}',
        'This runs the complete pipeline: download, extract frames, transcribe, classify+annotate, compress, store, Notion sync, generate brief, cleanup.',
        'Report: frames kept, top visuals, brief highlights.',
      ].join('\n'),
      timeout: 900,
      dependsOn: [] as string[],
    },
  ],
  reviewCheckpoints: [] as string[],
  autonomous: true,
} as const;

/**
 * All Content Scout templates for registration with the workflow engine.
 */
export const CONTENT_SCOUT_TEMPLATES = [
  CONTENT_SCOUT_DAILY_TEMPLATE,
  CONTENT_SCOUT_SINGLE_TEMPLATE,
];
