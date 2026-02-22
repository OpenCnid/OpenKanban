import { NextRequest, NextResponse } from 'next/server';
import { queryOne, run } from '@/lib/db';
import type { WorkflowTemplate } from '@/lib/types';

function parseTemplate(t: WorkflowTemplate) {
  return {
    ...t,
    steps: typeof t.steps === 'string' ? JSON.parse(t.steps as unknown as string) : t.steps,
    trigger_config: t.trigger_config ? JSON.parse(t.trigger_config) : null,
    enabled: Boolean(t.enabled),
  };
}

// GET /api/workflows/[id] - Get a single workflow template
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const template = queryOne<WorkflowTemplate>('SELECT * FROM workflow_templates WHERE id = ?', [id]);

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json(parseTemplate(template));
  } catch (error) {
    console.error('Failed to fetch workflow template:', error);
    return NextResponse.json({ error: 'Failed to fetch workflow template' }, { status: 500 });
  }
}

// PATCH /api/workflows/[id] - Update a workflow template
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = queryOne<WorkflowTemplate>('SELECT * FROM workflow_templates WHERE id = ?', [id]);
    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    const now = new Date().toISOString();

    if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name); }
    if (body.description !== undefined) { updates.push('description = ?'); values.push(body.description); }
    if (body.trigger_type !== undefined) { updates.push('trigger_type = ?'); values.push(body.trigger_type); }
    if (body.trigger_config !== undefined) { updates.push('trigger_config = ?'); values.push(JSON.stringify(body.trigger_config)); }
    if (body.steps !== undefined) { updates.push('steps = ?'); values.push(JSON.stringify(body.steps)); }
    if (body.icon !== undefined) { updates.push('icon = ?'); values.push(body.icon); }
    if (body.enabled !== undefined) { updates.push('enabled = ?'); values.push(body.enabled ? 1 : 0); }
    if (body.status !== undefined) { updates.push('status = ?'); values.push(body.status); }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    updates.push('updated_at = ?');
    values.push(now);
    values.push(id);

    run(`UPDATE workflow_templates SET ${updates.join(', ')} WHERE id = ?`, values);

    const updated = queryOne<WorkflowTemplate>('SELECT * FROM workflow_templates WHERE id = ?', [id]);
    return NextResponse.json(updated ? parseTemplate(updated) : { id });
  } catch (error) {
    console.error('Failed to update workflow template:', error);
    return NextResponse.json({ error: 'Failed to update workflow template' }, { status: 500 });
  }
}

// DELETE /api/workflows/[id] - Delete a workflow template
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = queryOne<WorkflowTemplate>('SELECT * FROM workflow_templates WHERE id = ?', [id]);

    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    run('DELETE FROM workflow_templates WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete workflow template:', error);
    return NextResponse.json({ error: 'Failed to delete workflow template' }, { status: 500 });
  }
}
