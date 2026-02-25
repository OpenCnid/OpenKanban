import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

const EXAMPLE_TEMPLATES = [
  {
    name: 'YouTube to Presentation',
    description: 'Extract transcript from a YouTube video, summarize key points, generate a Gamma deck, and distribute.',
    icon: '🎬',
    trigger_type: 'manual',
    steps: [
      { name: 'Extract Transcript', agent_role: 'transcriber', tools: ['youtube-transcript'], timeoutSeconds: 300, maxRetries: 1 },
      { name: 'Summarize Key Points', agent_role: 'analyst', depends_on: 'Extract Transcript' },
      { name: 'Generate Gamma Deck', agent_role: 'designer', depends_on: 'Summarize Key Points', review: true, timeoutSeconds: 300 },
      { name: 'Distribute', agent_role: 'distributor', depends_on: 'Generate Gamma Deck', destinations: ['discord', 'notion'] },
    ],
  },
  {
    name: 'Trade Idea Analysis',
    description: 'Pull market data for a ticker, analyze the opportunity, review before logging to portfolio.',
    icon: '📈',
    trigger_type: 'manual',
    steps: [
      { name: 'Market Data Pull', agent_role: 'data-fetcher', agentId: 'market-data', timeoutSeconds: 600, maxRetries: 1 },
      { name: 'Analysis', agent_role: 'analyst', agentId: 'analyst', depends_on: 'Market Data Pull', review: true, timeoutSeconds: 300 },
      { name: 'Log to Portfolio', agent_role: 'recorder', agentId: 'recorder', depends_on: 'Analysis' },
    ],
  },
  {
    name: 'Wednesday Show Prep',
    description: 'Weekly show pipeline: scrape sources, analyze, build top 5, format, and distribute to Discord.',
    icon: '📺',
    trigger_type: 'schedule',
    trigger_config: JSON.stringify({ schedule: '0 18 * * 2', timezone: 'America/Chicago' }),
    steps: [
      { name: 'Scrape Sources', agent_role: 'researcher' },
      { name: 'Analyze & Categorize', agent_role: 'analyst', depends_on: 'Scrape Sources' },
      { name: 'Build Top 5', agent_role: 'writer', depends_on: 'Analyze & Categorize' },
      { name: 'Format for Distribution', agent_role: 'formatter', depends_on: 'Build Top 5', review: true },
      { name: 'Distribute to Discord', agent_role: 'distributor', depends_on: 'Format for Distribution' },
    ],
  },
  {
    name: 'Content Scout Daily Brief',
    description: 'Monitor YouTube channels for new uploads, download, extract and classify frames, transcribe audio, and generate a daily content brief with key takeaways. Runs the content-scout skill pipeline.',
    icon: '📡',
    trigger_type: 'schedule',
    trigger_config: JSON.stringify({ schedule: '0 6 * * *', timezone: 'America/Chicago' }),
    steps: [
      { name: 'Select Videos', agent_role: 'scout', tools: ['content-scout'], timeoutSeconds: 120 },
      { name: 'Download & Extract', agent_role: 'scout', depends_on: 'Select Videos', timeoutSeconds: 600, maxRetries: 1 },
      { name: 'Transcribe Audio', agent_role: 'transcriber', depends_on: 'Download & Extract', timeoutSeconds: 900, output: 'Transcripts for each video via Whisper API. Process each video independently — do not accumulate all transcripts in context.' },
      { name: 'Classify Frames', agent_role: 'analyst', depends_on: 'Download & Extract', timeoutSeconds: 900, output: 'Frame annotations for each video. Process ONE video at a time: classify its frames, save results, then move to next. Do not load all frames into context simultaneously.' },
      { name: 'Generate Brief', agent_role: 'writer', depends_on: 'Classify Frames', timeoutSeconds: 300 },
      { name: 'Distribute', agent_role: 'distributor', depends_on: 'Generate Brief', destinations: ['notion'] },
    ],
  },
  {
    name: 'Transcript Studio',
    description: 'Deep-process a YouTube video into a rich Notion page with speaker-diarized transcript, embedded visual frames, AI-generated summary with takeaways, chapters, and shorts candidates. Runs the transcript-studio skill pipeline. Use for processing individual videos.',
    icon: '🎙️',
    trigger_type: 'manual',
    steps: [
      { name: 'Download & Extract Frames', agent_role: 'scout', tools: ['content-scout', 'transcript-studio'], timeoutSeconds: 600, maxRetries: 1 },
      { name: 'Transcribe & Diarize', agent_role: 'transcriber', depends_on: 'Download & Extract Frames', timeoutSeconds: 1800 },
      { name: 'Classify & Merge Visuals', agent_role: 'analyst', depends_on: 'Transcribe & Diarize', timeoutSeconds: 600 },
      { name: 'Summarize', agent_role: 'analyst', depends_on: 'Classify & Merge Visuals', timeoutSeconds: 300 },
      { name: 'Upload Frames', agent_role: 'uploader', depends_on: 'Classify & Merge Visuals', timeoutSeconds: 300 },
      { name: 'Export to Notion', agent_role: 'exporter', depends_on: 'Summarize', timeoutSeconds: 300 },
    ],
  },
];

// POST /api/workflows/seed — create example workflow templates
export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json().catch(() => ({}));
  const workspaceId = body.workspace_id || 'default';

  const results: Array<{ name: string; action: string; id?: string }> = [];

  for (const tmpl of EXAMPLE_TEMPLATES) {
    // Skip if name already exists
    const existing = db.prepare(
      'SELECT id FROM workflow_templates WHERE name = ? AND workspace_id = ?'
    ).get(tmpl.name, workspaceId) as { id: string } | undefined;

    if (existing) {
      results.push({ name: tmpl.name, action: 'skipped', id: existing.id });
      continue;
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO workflow_templates (id, name, description, trigger_type, trigger_config, steps, workspace_id, icon, enabled, origin, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'manual', 'active', ?, ?)
    `).run(
      id,
      tmpl.name,
      tmpl.description,
      tmpl.trigger_type,
      tmpl.trigger_config || null,
      JSON.stringify(tmpl.steps),
      workspaceId,
      tmpl.icon,
      now,
      now,
    );

    results.push({ name: tmpl.name, action: 'created', id });
  }

  return NextResponse.json({ results });
}
