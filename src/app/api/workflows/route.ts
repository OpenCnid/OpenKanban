import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import type { WorkflowTemplate } from '@/lib/types';

// GET /api/workflows - List all workflow templates
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspace_id');
    const enabled = searchParams.get('enabled');

    let sql = 'SELECT * FROM workflow_templates WHERE 1=1';
    const params: unknown[] = [];

    if (workspaceId) {
      sql += ' AND workspace_id = ?';
      params.push(workspaceId);
    }

    if (enabled !== null && enabled !== undefined) {
      sql += ' AND enabled = ?';
      params.push(enabled === 'true' ? 1 : 0);
    }

    sql += ' ORDER BY created_at DESC';

    const templates = queryAll<WorkflowTemplate>(sql, params);

    // Parse steps JSON for each template
    const parsed = templates.map((t) => ({
      ...t,
      steps: typeof t.steps === 'string' ? JSON.parse(t.steps) : t.steps,
      trigger_config: t.trigger_config ? JSON.parse(t.trigger_config) : null,
      enabled: Boolean(t.enabled),
    }));

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('Failed to fetch workflow templates:', error);
    return NextResponse.json({ error: 'Failed to fetch workflow templates' }, { status: 500 });
  }
}

// POST /api/workflows - Create a new workflow template
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { name, description, trigger_type, trigger_config, steps, workspace_id, icon } = body;

    if (!name || !steps || !Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json(
        { error: 'name and steps (non-empty array) are required' },
        { status: 400 }
      );
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    run(
      `INSERT INTO workflow_templates (id, name, description, trigger_type, trigger_config, steps, workspace_id, icon, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        description || null,
        trigger_type || 'manual',
        trigger_config ? JSON.stringify(trigger_config) : null,
        JSON.stringify(steps),
        workspace_id || 'default',
        icon || '⚡',
        now,
        now,
      ]
    );

    const template = queryOne<WorkflowTemplate>('SELECT * FROM workflow_templates WHERE id = ?', [id]);

    if (template) {
      const parsed = {
        ...template,
        steps: typeof template.steps === 'string' ? JSON.parse(template.steps) : template.steps,
        trigger_config: template.trigger_config ? JSON.parse(template.trigger_config) : null,
        enabled: Boolean(template.enabled),
      };
      return NextResponse.json(parsed, { status: 201 });
    }

    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    console.error('Failed to create workflow template:', error);
    return NextResponse.json({ error: 'Failed to create workflow template' }, { status: 500 });
  }
}
