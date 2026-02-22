import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryAll, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import type { WorkflowRun, Task } from '@/lib/types';

// GET /api/workflows/runs/[id] - Get a single workflow run with its tasks
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const workflowRun = queryOne<WorkflowRun>(
      `SELECT wr.*, wt.name as template_name, wt.icon as template_icon, wt.steps as template_steps
       FROM workflow_runs wr
       LEFT JOIN workflow_templates wt ON wr.template_id = wt.id
       WHERE wr.id = ?`,
      [id]
    );

    if (!workflowRun) {
      return NextResponse.json({ error: 'Workflow run not found' }, { status: 404 });
    }

    // Fetch tasks for this run
    const tasks = queryAll<Task>(
      `SELECT t.*, aa.name as assigned_agent_name, aa.avatar_emoji as assigned_agent_emoji
       FROM tasks t
       LEFT JOIN agents aa ON t.assigned_agent_id = aa.id
       WHERE t.workflow_run_id = ?
       ORDER BY t.workflow_step_index ASC`,
      [id]
    );

    return NextResponse.json({
      ...workflowRun,
      tasks,
    });
  } catch (error) {
    console.error('Failed to fetch workflow run:', error);
    return NextResponse.json({ error: 'Failed to fetch workflow run' }, { status: 500 });
  }
}

// PATCH /api/workflows/runs/[id] - Update a workflow run
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = queryOne<WorkflowRun>('SELECT * FROM workflow_runs WHERE id = ?', [id]);
    if (!existing) {
      return NextResponse.json({ error: 'Workflow run not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.status !== undefined) {
      updates.push('status = ?');
      values.push(body.status);

      // Set completed_at if transitioning to terminal state
      if (['completed', 'failed', 'cancelled'].includes(body.status) && !existing.completed_at) {
        const now = new Date().toISOString();
        updates.push('completed_at = ?');
        values.push(now);

        // Calculate duration
        if (existing.started_at) {
          const duration = Math.round(
            (new Date(now).getTime() - new Date(existing.started_at).getTime()) / 1000
          );
          updates.push('duration_seconds = ?');
          values.push(duration);
        }
      }
    }

    if (body.outcome !== undefined) { updates.push('outcome = ?'); values.push(body.outcome); }
    if (body.metadata !== undefined) { updates.push('metadata = ?'); values.push(JSON.stringify(body.metadata)); }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    values.push(id);
    run(`UPDATE workflow_runs SET ${updates.join(', ')} WHERE id = ?`, values);

    const updated = queryOne<WorkflowRun>('SELECT * FROM workflow_runs WHERE id = ?', [id]);

    if (updated) {
      broadcast({ type: 'workflow_run_updated', payload: updated });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed to update workflow run:', error);
    return NextResponse.json({ error: 'Failed to update workflow run' }, { status: 500 });
  }
}
