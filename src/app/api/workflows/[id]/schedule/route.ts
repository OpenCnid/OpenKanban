import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';

// GET /api/workflows/:id/schedule — check schedule status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const template = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const triggerConfig = template.trigger_config ? JSON.parse(template.trigger_config as string) : {};
  
  if (!triggerConfig.cron_job_id) {
    return NextResponse.json({ scheduled: false });
  }

  return NextResponse.json({
    scheduled: true,
    cronJobId: triggerConfig.cron_job_id,
    schedule: triggerConfig.schedule,
    timezone: triggerConfig.timezone,
  });
}

// POST /api/workflows/:id/schedule — create a cron schedule
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const body = await request.json();
  const { schedule, timezone } = body;

  // schedule can be:
  // - cron expression string: "0 18 * * 2" (Tuesday 6pm)
  // - interval object: { everyMs: 3600000 }
  // - one-shot: { at: "2026-02-25T18:00:00Z" }

  if (!schedule) {
    return NextResponse.json({ error: 'schedule is required' }, { status: 400 });
  }

  const template = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  // Build the schedule object for OpenClaw
  let cronSchedule: Record<string, unknown>;
  if (typeof schedule === 'string') {
    cronSchedule = { kind: 'cron', expr: schedule, tz: timezone || 'America/Chicago' };
  } else if (schedule.everyMs) {
    cronSchedule = { kind: 'every', everyMs: schedule.everyMs };
  } else if (schedule.at) {
    cronSchedule = { kind: 'at', at: schedule.at };
  } else {
    return NextResponse.json({ error: 'Invalid schedule format' }, { status: 400 });
  }

  // The cron payload triggers a workflow run via the API
  const baseUrl = `http://localhost:${process.env.PORT || 4000}`;
  const message = `Trigger scheduled workflow run for template "${template.name}" (ID: ${id}). ` +
    `Make an HTTP POST request to ${baseUrl}/api/workflows/${id}/run with body: ` +
    `{"trigger_method": "schedule", "auto_execute": true}`;

  try {
    const client = getOpenClawClient();
    if (!client.isConnected()) {
      await client.connect();
    }

    const result = await client.addCronJob({
      name: `OpenKanban: ${template.name}`,
      schedule: cronSchedule as { kind: 'cron'; expr: string; tz?: string },
      payload: {
        kind: 'agentTurn',
        message,
        timeoutSeconds: 600,
      },
      sessionTarget: 'isolated',
      delivery: { mode: 'none' },
    });

    // Store cron job ID in template trigger_config
    const existingConfig = template.trigger_config ? JSON.parse(template.trigger_config as string) : {};
    const updatedConfig = {
      ...existingConfig,
      cron_job_id: result.jobId,
      schedule: typeof schedule === 'string' ? schedule : JSON.stringify(schedule),
      timezone: timezone || 'America/Chicago',
    };

    db.prepare('UPDATE workflow_templates SET trigger_type = ?, trigger_config = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run('schedule', JSON.stringify(updatedConfig), id);

    return NextResponse.json({
      success: true,
      cronJobId: result.jobId,
      schedule: cronSchedule,
    });
  } catch (err) {
    console.error('[Schedule] Failed to create cron job:', err);
    return NextResponse.json(
      { error: `Failed to create schedule: ${err instanceof Error ? err.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

// DELETE /api/workflows/:id/schedule — remove a cron schedule
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const template = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const triggerConfig = template.trigger_config ? JSON.parse(template.trigger_config as string) : {};
  
  if (!triggerConfig.cron_job_id) {
    return NextResponse.json({ error: 'No schedule configured' }, { status: 404 });
  }

  try {
    const client = getOpenClawClient();
    if (!client.isConnected()) {
      await client.connect();
    }

    await client.removeCronJob(triggerConfig.cron_job_id);

    // Clear schedule from template
    const { cron_job_id, schedule, timezone, ...rest } = triggerConfig;
    db.prepare('UPDATE workflow_templates SET trigger_type = ?, trigger_config = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run('manual', Object.keys(rest).length > 0 ? JSON.stringify(rest) : null, id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Schedule] Failed to remove cron job:', err);
    return NextResponse.json(
      { error: `Failed to remove schedule: ${err instanceof Error ? err.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
