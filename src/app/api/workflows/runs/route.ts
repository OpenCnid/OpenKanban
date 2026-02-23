import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import type { WorkflowRun } from '@/lib/types';

// GET /api/workflows/runs - List workflow runs
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const templateId = searchParams.get('template_id');
    const workspaceId = searchParams.get('workspace_id');
    const includeAll = searchParams.get('include') === 'all';

    let sql = `
      SELECT wr.*, wt.name as template_name, wt.icon as template_icon
      FROM workflow_runs wr
      LEFT JOIN workflow_templates wt ON wr.template_id = wt.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    // By default, hide dismissed runs. ?include=all shows everything (for history).
    if (!includeAll) {
      sql += ' AND (wr.dismissed IS NULL OR wr.dismissed = 0)';
    }

    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        sql += ' AND wr.status = ?';
        params.push(statuses[0]);
      } else if (statuses.length > 1) {
        sql += ` AND wr.status IN (${statuses.map(() => '?').join(',')})`;
        params.push(...statuses);
      }
    }

    if (templateId) {
      sql += ' AND wr.template_id = ?';
      params.push(templateId);
    }

    if (workspaceId) {
      sql += ' AND wr.workspace_id = ?';
      params.push(workspaceId);
    }

    sql += ' ORDER BY wr.started_at DESC';

    const runs = queryAll<WorkflowRun & { template_name?: string; template_icon?: string }>(sql, params);
    return NextResponse.json(runs);
  } catch (error) {
    console.error('Failed to fetch workflow runs:', error);
    return NextResponse.json({ error: 'Failed to fetch workflow runs' }, { status: 500 });
  }
}
