import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// GET /api/approvals — list approvals with optional filters
export async function GET(request: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status'); // 'pending' | 'approved' | 'rejected'
  const workspaceId = searchParams.get('workspace_id') || 'default';
  const limit = parseInt(searchParams.get('limit') || '50');

  let query = `
    SELECT a.*, wr.name as workflow_name, t.title as task_title
    FROM approvals a
    LEFT JOIN workflow_runs wr ON a.workflow_run_id = wr.id
    LEFT JOIN tasks t ON a.source_task_id = t.id
  `;
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Filter by workspace through workflow_runs
  conditions.push('(wr.workspace_id = ? OR wr.workspace_id IS NULL)');
  params.push(workspaceId);

  if (status) {
    conditions.push('a.status = ?');
    params.push(status);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY CASE a.status WHEN \'pending\' THEN 0 ELSE 1 END, a.created_at DESC';
  query += ' LIMIT ?';
  params.push(limit);

  const approvals = db.prepare(query).all(...params);
  return NextResponse.json(approvals);
}
