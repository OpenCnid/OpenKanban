import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { executeNextStep } from '@/lib/workflow-engine';
import type { WorkflowRun } from '@/lib/types';

/**
 * POST /api/workflows/runs/[id]/execute
 * Start or resume execution of a workflow run.
 * Kicks off the next ready step via the workflow engine.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const workflowRun = queryOne<WorkflowRun>(
      'SELECT * FROM workflow_runs WHERE id = ?',
      [id]
    );

    if (!workflowRun) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (workflowRun.status !== 'running' && workflowRun.status !== 'paused') {
      return NextResponse.json(
        { error: `Run is ${workflowRun.status}, cannot execute` },
        { status: 400 }
      );
    }

    const result = await executeNextStep(id);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      executed: result.executed,
      task_id: result.taskId || null,
      message: result.executed
        ? `Step started (task: ${result.taskId})`
        : 'No steps ready to execute',
    });
  } catch (error) {
    console.error('Failed to execute workflow run:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
