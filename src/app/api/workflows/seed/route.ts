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
      { name: 'Extract Transcript', agent_role: 'transcriber', tools: ['youtube-transcript'] },
      { name: 'Summarize Key Points', agent_role: 'analyst', depends_on: 'Extract Transcript' },
      { name: 'Generate Gamma Deck', agent_role: 'designer', depends_on: 'Summarize Key Points', review: true },
      { name: 'Distribute', agent_role: 'distributor', depends_on: 'Generate Gamma Deck', destinations: ['discord', 'notion'] },
    ],
  },
  {
    name: 'Trade Idea Analysis',
    description: 'Pull market data for a ticker, analyze the opportunity, review before logging to portfolio.',
    icon: '📈',
    trigger_type: 'manual',
    steps: [
      { name: 'Market Data Pull', agent_role: 'data-fetcher', agentId: 'market-data' },
      { name: 'Analysis', agent_role: 'analyst', agentId: 'analyst', depends_on: 'Market Data Pull', review: true },
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
