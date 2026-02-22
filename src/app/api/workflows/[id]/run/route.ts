import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, run, transaction } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { executeNextStep, startCompletionPoller } from '@/lib/workflow-engine';
import type { WorkflowTemplate, WorkflowStep, WorkflowRun, Task } from '@/lib/types';

// Ensure completion poller is running
startCompletionPoller();

// POST /api/workflows/[id]/run - Trigger a workflow run from a template
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const template = queryOne<WorkflowTemplate>('SELECT * FROM workflow_templates WHERE id = ?', [id]);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    const steps: WorkflowStep[] = typeof template.steps === 'string'
      ? JSON.parse(template.steps as unknown as string)
      : template.steps;

    const runId = uuidv4();
    const now = new Date().toISOString();
    const triggerInput = body.trigger_input || body.input || null;

    // Create everything in a transaction
    const result = transaction(() => {
      // 1. Create workflow run
      run(
        `INSERT INTO workflow_runs (id, template_id, name, status, trigger_input, trigger_method, workspace_id, started_at, metadata)
         VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
        [
          runId,
          id,
          template.name,
          triggerInput ? JSON.stringify(triggerInput) : null,
          body.trigger_method || 'manual',
          template.workspace_id || 'default',
          now,
          body.metadata ? JSON.stringify(body.metadata) : null,
        ]
      );

      // 2. Create individual tasks for each step
      const taskIds: Record<string, string> = {};

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const taskId = uuidv4();
        taskIds[step.name] = taskId;

        run(
          `INSERT INTO tasks (id, title, description, status, priority, workspace_id, workflow_run_id, workflow_step_index, created_at, updated_at)
           VALUES (?, ?, ?, 'inbox', 'normal', ?, ?, ?, ?, ?)`,
          [
            taskId,
            step.name,
            `Step ${i + 1} of workflow "${template.name}"`,
            template.workspace_id || 'default',
            runId,
            i,
            now,
            now,
          ]
        );
      }

      // 3. Create task dependencies based on step depends_on
      for (const step of steps) {
        if (step.depends_on && taskIds[step.depends_on] && taskIds[step.name]) {
          const depId = uuidv4();
          run(
            `INSERT INTO task_dependencies (id, task_id, depends_on_task_id, dependency_type, created_at)
             VALUES (?, ?, ?, 'finish_to_start', ?)`,
            [depId, taskIds[step.name], taskIds[step.depends_on], now]
          );
        }
      }

      // 4. Update template usage stats
      run(
        `UPDATE workflow_templates SET total_runs = total_runs + 1, last_used_at = ?, updated_at = ? WHERE id = ?`,
        [now, now, id]
      );

      return { runId, taskIds };
    });

    // Fetch the created run
    const workflowRun = queryOne<WorkflowRun>('SELECT * FROM workflow_runs WHERE id = ?', [result.runId]);

    // Broadcast SSE events
    if (workflowRun) {
      broadcast({
        type: 'workflow_run_created',
        payload: workflowRun,
      });
    }

    // Also broadcast task_created for each task so the kanban updates
    for (const [stepName, taskId] of Object.entries(result.taskIds)) {
      const task = queryOne<Task>(
        `SELECT t.*, aa.name as assigned_agent_name, aa.avatar_emoji as assigned_agent_emoji
         FROM tasks t
         LEFT JOIN agents aa ON t.assigned_agent_id = aa.id
         WHERE t.id = ?`,
        [taskId]
      );
      if (task) {
        broadcast({ type: 'task_created', payload: task });
      }
    }

    // Auto-execute first step if auto_execute is not explicitly false
    const autoExecute = body.auto_execute !== false;
    if (autoExecute) {
      // Execute asynchronously — don't block the response
      executeNextStep(result.runId).catch(err => {
        console.error(`[WorkflowRun] Auto-execute failed for run ${result.runId}:`, err);
      });
    }

    return NextResponse.json({
      id: result.runId,
      template_id: id,
      name: template.name,
      status: 'running',
      task_ids: result.taskIds,
      started_at: now,
    }, { status: 201 });
  } catch (error) {
    console.error('Failed to trigger workflow run:', error);
    return NextResponse.json({ error: 'Failed to trigger workflow run' }, { status: 500 });
  }
}
