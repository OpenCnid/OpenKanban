import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { routeInput } from '@/lib/workflow-router';
import { v4 as uuidv4 } from 'uuid';
import { broadcast } from '@/lib/events';

/**
 * POST /api/workflows/trigger — Agent-initiated workflow trigger
 *
 * This is the inbound bridge from OpenClaw to OpenKanban.
 * An agent (triage, cron job, or any OpenClaw session) can call this
 * to trigger a workflow run. Supports three modes:
 *
 * 1. Direct: { template_id: "xxx", input: "..." }
 *    → Triggers a specific template immediately
 *
 * 2. Routed: { input: "analyze AAPL options" }
 *    → Runs through semantic router, auto-executes if confident
 *
 * 3. Proposed: { input: "...", propose_only: true }
 *    → Creates a notification for Hans to decide, doesn't auto-execute
 */
export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json();
  const {
    template_id,
    input,
    source,
    auto_execute = true,
    propose_only = false,
    workspace_id = 'default',
  } = body;

  if (!input && !template_id) {
    return NextResponse.json(
      { error: 'Either input or template_id is required' },
      { status: 400 }
    );
  }

  // Mode 1: Direct template trigger
  if (template_id) {
    const template = db.prepare(
      'SELECT * FROM workflow_templates WHERE id = ? AND workspace_id = ?'
    ).get(template_id, workspace_id) as Record<string, unknown> | undefined;

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Trigger the run
    const baseUrl = `http://localhost:${process.env.PORT || 4000}`;
    const runRes = await fetch(`${baseUrl}/api/workflows/${template_id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger_input: input || '',
        trigger_method: source || 'agent',
        auto_execute: auto_execute,
      }),
    });

    if (!runRes.ok) {
      const err = await runRes.text();
      return NextResponse.json({ error: `Failed to trigger run: ${err}` }, { status: 500 });
    }

    const run = await runRes.json();
    return NextResponse.json({
      action: 'triggered',
      run_id: run.id,
      template_name: template.name,
      source: source || 'agent',
    });
  }

  // Mode 2 & 3: Route the input
  const routeResult = await routeInput(input, workspace_id);

  // Mode 3: Propose only — create notification, don't execute
  if (propose_only) {
    const notifId = uuidv4();
    const now = new Date().toISOString();

    let message = '';
    if (routeResult.path === 'A' && routeResult.matchedTemplateName) {
      message = `Agent suggests running "${routeResult.matchedTemplateName}" for: "${input}"`;
    } else if (routeResult.path === 'B' && routeResult.suggestions) {
      const names = routeResult.suggestions.map(s => s.templateName).join(', ');
      message = `Agent has input that might match: ${names}. Input: "${input}"`;
    } else if (routeResult.path === 'D' && routeResult.proposedWorkflow) {
      message = `Agent proposes a new workflow "${routeResult.proposedWorkflow.name}" for: "${input}"`;
    } else {
      message = `Agent has input that needs routing: "${input}"`;
    }

    db.prepare(
      `INSERT INTO notifications (id, type, title, message, link, source_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      notifId,
      'workflow_suggestion',
      `Workflow suggestion from ${source || 'agent'}`,
      message,
      `/workspace/${workspace_id}?tab=pipelines`,
      null,
      now,
    );

    broadcast({
      type: 'notification_created',
      payload: {
        id: notifId,
        type: 'workflow_suggestion',
        title: `Workflow suggestion from ${source || 'agent'}`,
        message,
        read: false,
        created_at: now,
      },
    });

    return NextResponse.json({
      action: 'proposed',
      routing: routeResult,
      notification_id: notifId,
    });
  }

  // Mode 2: Auto-execute if confident enough
  if (routeResult.path === 'A' && routeResult.matchedTemplateId && auto_execute) {
    // High confidence — trigger immediately
    const baseUrl = `http://localhost:${process.env.PORT || 4000}`;
    const runRes = await fetch(`${baseUrl}/api/workflows/${routeResult.matchedTemplateId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger_input: input,
        trigger_method: source || 'agent-routed',
        auto_execute: true,
      }),
    });

    if (!runRes.ok) {
      return NextResponse.json({
        action: 'route_failed',
        routing: routeResult,
        error: 'Failed to trigger matched template',
      }, { status: 500 });
    }

    const run = await runRes.json();
    return NextResponse.json({
      action: 'auto_triggered',
      run_id: run.id,
      template_name: routeResult.matchedTemplateName,
      routing: routeResult,
      source: source || 'agent',
    });
  }

  // Not confident enough to auto-execute — create notification for Hans
  const notifId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO notifications (id, type, title, message, link, source_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    notifId,
    'workflow_suggestion',
    `Workflow needed: ${input.slice(0, 60)}`,
    `Agent (${source || 'unknown'}) suggests a workflow for: "${input}". Routing confidence: ${(routeResult.confidence * 100).toFixed(0)}%. ${routeResult.reasoning}`,
    `/workspace/${workspace_id}?tab=pipelines`,
    null,
    now,
  );

  broadcast({
    type: 'notification_created',
    payload: {
      id: notifId,
      type: 'workflow_suggestion',
      title: `Workflow needed: ${input.slice(0, 60)}`,
      message: `Agent suggests a workflow for: "${input}"`,
      read: false,
      created_at: now,
    },
  });

  return NextResponse.json({
    action: 'needs_review',
    routing: routeResult,
    notification_id: notifId,
    source: source || 'agent',
  });
}
