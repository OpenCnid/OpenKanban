import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';

// GET /api/approvals/:id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const approval = db.prepare(`
    SELECT a.*, wr.name as workflow_name, t.title as task_title
    FROM approvals a
    LEFT JOIN workflow_runs wr ON a.workflow_run_id = wr.id
    LEFT JOIN tasks t ON a.source_task_id = t.id
    WHERE a.id = ?
  `).get(id);

  if (!approval) {
    return NextResponse.json({ error: 'Approval not found' }, { status: 404 });
  }

  return NextResponse.json(approval);
}

// PATCH /api/approvals/:id — resolve an approval (approve/reject)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const body = await request.json();
  const { status, resolution_notes } = body;

  if (!status || !['approved', 'rejected'].includes(status)) {
    return NextResponse.json(
      { error: 'Invalid status. Must be "approved" or "rejected".' },
      { status: 400 }
    );
  }

  const existing = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'Approval not found' }, { status: 404 });
  }

  if (existing.status !== 'pending') {
    return NextResponse.json(
      { error: `Approval already ${existing.status}` },
      { status: 409 }
    );
  }

  db.prepare(`
    UPDATE approvals
    SET status = ?, resolution_notes = ?, resolved_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(status, resolution_notes || null, id);

  const updated = db.prepare(`
    SELECT a.*, wr.name as workflow_name, t.title as task_title
    FROM approvals a
    LEFT JOIN workflow_runs wr ON a.workflow_run_id = wr.id
    LEFT JOIN tasks t ON a.source_task_id = t.id
    WHERE a.id = ?
  `).get(id);

  broadcast({ type: 'approval_updated', payload: updated as unknown as import('@/lib/types').Approval });

  // If this approval is tied to a workflow step, trigger the engine
  if (existing.workflow_run_id && existing.source_task_id) {
    try {
      const baseUrl = `http://localhost:${process.env.PORT || 4000}`;
      const endpoint = status === 'approved'
        ? `${baseUrl}/api/workflows/runs/${existing.workflow_run_id}/steps/${existing.source_task_id}/approve`
        : `${baseUrl}/api/workflows/runs/${existing.workflow_run_id}/steps/${existing.source_task_id}/reject`;

      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: resolution_notes }),
      });
    } catch (err) {
      console.error('[Approvals] Failed to trigger workflow engine:', err);
    }
  }

  return NextResponse.json(updated);
}
