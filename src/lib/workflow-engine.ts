/**
 * Workflow Engine — translates workflow templates into OpenClaw operations.
 *
 * Responsibilities:
 * - Execute workflow steps sequentially via sessions_spawn
 * - Handle dependency chains (step N completes → trigger step N+1)
 * - Pause at review checkpoints for human approval
 * - Track run state in SQLite, execution in OpenClaw
 * - Pass artifacts between steps
 *
 * Architecture: This engine calls openclaw-client.ts exclusively.
 * It never directly manages agents, sessions, or memory.
 */

import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { broadcast } from '@/lib/events';
import type { Task, WorkflowRun, WorkflowStep, WorkflowTemplate, Approval } from '@/lib/types';

// Track active step sessions: taskId → sessionKey
const activeStepSessions = new Map<string, string>();

/**
 * Get the template steps as parsed JSON.
 */
function parseSteps(template: WorkflowTemplate): WorkflowStep[] {
  if (typeof template.steps === 'string') {
    return JSON.parse(template.steps as unknown as string);
  }
  return template.steps;
}

/**
 * Get all tasks for a workflow run, ordered by step index.
 */
function getRunTasks(runId: string): Task[] {
  return queryAll<Task>(
    `SELECT * FROM tasks WHERE workflow_run_id = ? ORDER BY workflow_step_index ASC`,
    [runId]
  );
}

/**
 * Get deliverables for a task (artifacts from previous steps).
 */
function getTaskDeliverables(taskId: string): Array<{ title: string; path: string; description?: string }> {
  return queryAll<{ title: string; path: string; description?: string }>(
    `SELECT title, path, description FROM task_deliverables WHERE task_id = ?`,
    [taskId]
  );
}

/**
 * Get input deliverables for a task (artifacts passed from upstream steps).
 */
function getInputDeliverables(taskId: string): Array<{ title: string; path: string; description?: string; source_task_id: string }> {
  return queryAll<{ title: string; path: string; description?: string; source_task_id: string }>(
    `SELECT title, path, description, source_task_id FROM task_deliverables WHERE task_id = ? AND is_input = 1`,
    [taskId]
  );
}

/**
 * Update a task's status and broadcast the change via SSE.
 */
function updateTaskStatus(taskId: string, status: string): void {
  const now = new Date().toISOString();
  run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', [status, now, taskId]);

  const updatedTask = queryOne<Task>(
    `SELECT t.*, aa.name as assigned_agent_name, aa.avatar_emoji as assigned_agent_emoji
     FROM tasks t
     LEFT JOIN agents aa ON t.assigned_agent_id = aa.id
     WHERE t.id = ?`,
    [taskId]
  );

  if (updatedTask) {
    broadcast({ type: 'task_updated', payload: updatedTask });
  }
}

/**
 * Update a workflow run's status and broadcast via SSE.
 */
function updateRunStatus(runId: string, status: string, extra?: Record<string, unknown>): void {
  const now = new Date().toISOString();
  const updates = ['status = ?', 'metadata = COALESCE(metadata, ?)'];
  const params: unknown[] = [status, '{}'];

  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    updates.push('completed_at = ?');
    params.push(now);

    // Calculate duration
    const runData = queryOne<WorkflowRun>('SELECT started_at FROM workflow_runs WHERE id = ?', [runId]);
    if (runData?.started_at) {
      const durationMs = new Date(now).getTime() - new Date(runData.started_at).getTime();
      updates.push('duration_seconds = ?');
      params.push(Math.round(durationMs / 1000));
    }
  }

  if (extra?.outcome) {
    updates.push('outcome = ?');
    params.push(extra.outcome as string);
  }

  params.push(runId);
  run(`UPDATE workflow_runs SET ${updates.join(', ')} WHERE id = ?`, params);

  const updatedRun = queryOne<WorkflowRun>('SELECT * FROM workflow_runs WHERE id = ?', [runId]);
  if (updatedRun) {
    broadcast({ type: 'workflow_run_updated', payload: updatedRun });
  }
}

/**
 * Build the task prompt for a workflow step, including context from
 * the trigger input and any artifacts from upstream steps.
 */
function buildStepPrompt(
  step: WorkflowStep,
  stepIndex: number,
  template: WorkflowTemplate,
  triggerInput: string | null,
  upstreamArtifacts: Array<{ title: string; content?: string; source_step?: string }>
): string {
  const parts: string[] = [];

  parts.push(`## Workflow Step: ${step.name}`);
  parts.push(`**Pipeline:** ${template.name}`);
  parts.push(`**Step ${stepIndex + 1} of ${parseSteps(template).length}**`);

  if (step.agent_role) {
    parts.push(`**Your role:** ${step.agent_role}`);
  }

  if (step.tools && step.tools.length > 0) {
    parts.push(`**Available tools:** ${step.tools.join(', ')}`);
  }

  if (triggerInput) {
    parts.push(`\n### Input\n${triggerInput}`);
  }

  if (upstreamArtifacts.length > 0) {
    parts.push('\n### Context from Previous Steps');
    for (const artifact of upstreamArtifacts) {
      parts.push(`\n**${artifact.source_step || 'Previous step'} → ${artifact.title}:**`);
      if (artifact.content) {
        parts.push(artifact.content);
      }
    }
  }

  if (step.output) {
    parts.push(`\n### Expected Output\nProduce: **${step.output}**`);
  }

  if (step.destinations && step.destinations.length > 0) {
    parts.push(`\n### Distribution\nSend output to: ${step.destinations.join(', ')}`);
  }

  parts.push('\n---');
  parts.push('When complete, provide your output clearly. The next step in the pipeline depends on your result.');

  return parts.join('\n');
}

/**
 * Execute the next ready step in a workflow run.
 * A step is "ready" when all its dependencies are complete and it's in 'inbox' status.
 */
export async function executeNextStep(runId: string): Promise<{ executed: boolean; taskId?: string; error?: string }> {
  const workflowRun = queryOne<WorkflowRun>('SELECT * FROM workflow_runs WHERE id = ?', [runId]);
  if (!workflowRun) {
    return { executed: false, error: 'Run not found' };
  }

  if (workflowRun.status !== 'running') {
    return { executed: false, error: `Run is ${workflowRun.status}, not running` };
  }

  const template = queryOne<WorkflowTemplate>('SELECT * FROM workflow_templates WHERE id = ?', [workflowRun.template_id]);
  if (!template) {
    return { executed: false, error: 'Template not found' };
  }

  const steps = parseSteps(template);
  const tasks = getRunTasks(runId);

  // Find the next task that's ready to execute (inbox + all deps complete)
  for (const task of tasks) {
    if (task.status !== 'inbox') continue;

    // Check if all dependencies are satisfied
    const deps = queryAll<{ depends_on_task_id: string }>(
      'SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?',
      [task.id]
    );

    const allDepsComplete = deps.every(dep => {
      const depTask = queryOne<Task>('SELECT status FROM tasks WHERE id = ?', [dep.depends_on_task_id]);
      return depTask?.status === 'done';
    });

    if (!allDepsComplete) continue;

    // This task is ready — check if it's a review step
    const stepIndex = task.workflow_step_index ?? 0;
    const step = steps[stepIndex];

    if (!step) continue;

    // Gather upstream artifacts
    const upstreamArtifacts: Array<{ title: string; content?: string; source_step?: string }> = [];
    for (const dep of deps) {
      const depDeliverables = getTaskDeliverables(dep.depends_on_task_id);
      const depTask = queryOne<Task>('SELECT title FROM tasks WHERE id = ?', [dep.depends_on_task_id]);
      for (const d of depDeliverables) {
        upstreamArtifacts.push({
          title: d.title,
          content: d.description || undefined,
          source_step: depTask?.title,
        });
      }
    }

    // Parse trigger input
    let triggerInput = workflowRun.trigger_input;
    if (triggerInput) {
      try {
        triggerInput = JSON.parse(triggerInput);
      } catch {
        // Already a plain string
      }
    }

    // Build prompt and execute
    const prompt = buildStepPrompt(step, stepIndex, template, triggerInput as string | null, upstreamArtifacts);

    // Update task to in_progress
    updateTaskStatus(task.id, 'in_progress');

    // Spawn sub-agent session via OpenClaw
    try {
      const client = getOpenClawClient();
      if (!client.isConnected()) {
        await client.connect();
      }

      const label = `wf-${runId.slice(0, 8)}-step${stepIndex}`;
      const result = await client.spawnSession({
        task: prompt,
        label,
        cleanup: 'keep', // Keep session for history/artifact extraction
        runTimeoutSeconds: 300, // 5 min timeout per step
      });

      // Track the session
      activeStepSessions.set(task.id, result.sessionKey || label);

      // Store session key in task metadata
      run(
        'UPDATE tasks SET description = ? WHERE id = ?',
        [`Step ${stepIndex + 1} of workflow "${template.name}" [session: ${result.sessionKey || label}]`, task.id]
      );

      console.log(`[WorkflowEngine] Step "${step.name}" executing (task: ${task.id}, session: ${result.sessionKey || label})`);

      return { executed: true, taskId: task.id };
    } catch (err) {
      console.error(`[WorkflowEngine] Failed to execute step "${step.name}":`, err);
      updateTaskStatus(task.id, 'inbox'); // Revert to inbox on failure

      // If we can't execute, fail the run
      updateRunStatus(runId, 'failed', { outcome: `Step "${step.name}" failed to start: ${err instanceof Error ? err.message : 'Unknown error'}` });

      return { executed: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  // No tasks ready — check if all are done (run complete) or all blocked
  const allDone = tasks.every(t => t.status === 'done');
  if (allDone) {
    updateRunStatus(runId, 'completed', { outcome: 'All steps completed successfully' });

    // Update template success rate
    const templateRuns = queryAll<{ status: string }>('SELECT status FROM workflow_runs WHERE template_id = ?', [template.id]);
    const completedCount = templateRuns.filter(r => r.status === 'completed').length;
    const totalCount = templateRuns.length;
    const successRate = totalCount > 0 ? completedCount / totalCount : null;
    run('UPDATE workflow_templates SET success_rate = ? WHERE id = ?', [successRate, template.id]);

    console.log(`[WorkflowEngine] Run ${runId} completed successfully`);
  }

  // Check if any task is in 'review' (waiting for human approval)
  const reviewTask = tasks.find(t => t.status === 'review');
  if (reviewTask) {
    updateRunStatus(runId, 'paused');
    console.log(`[WorkflowEngine] Run ${runId} paused — step "${reviewTask.title}" awaiting review`);
  }

  return { executed: false };
}

/**
 * Handle step completion — called when a task transitions to 'done'.
 * Advances the workflow to the next step.
 */
export async function onStepCompleted(taskId: string): Promise<void> {
  const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task?.workflow_run_id) return; // Not a workflow task

  // Clean up session tracking
  activeStepSessions.delete(taskId);

  console.log(`[WorkflowEngine] Step "${task.title}" completed for run ${task.workflow_run_id}`);

  // Ensure the run is in 'running' state (it might be 'paused' if coming from review)
  const workflowRun = queryOne<WorkflowRun>('SELECT status FROM workflow_runs WHERE id = ?', [task.workflow_run_id]);
  if (workflowRun && workflowRun.status === 'paused') {
    updateRunStatus(task.workflow_run_id, 'running');
  }

  // Try to execute the next step
  await executeNextStep(task.workflow_run_id);
}

/**
 * Handle step moved to review — pause the run for human approval.
 */
export function onStepReview(taskId: string): void {
  const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task?.workflow_run_id) return;

  const template = queryOne<WorkflowTemplate>(
    `SELECT wt.* FROM workflow_templates wt
     JOIN workflow_runs wr ON wr.template_id = wt.id
     WHERE wr.id = ?`,
    [task.workflow_run_id]
  );

  // Create an approval record
  const approvalId = uuidv4();
  const now = new Date().toISOString();
  run(
    `INSERT INTO approvals (id, type, title, description, source, source_task_id, workflow_run_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      approvalId,
      'step_review',
      `Review: ${task.title}`,
      `Step "${task.title}" in pipeline "${template?.name || 'Unknown'}" requires your review before proceeding.`,
      'workflow_engine',
      taskId,
      task.workflow_run_id,
      now,
      now,
    ]
  );

  // Create notification
  const notifId = uuidv4();
  run(
    `INSERT INTO notifications (id, type, title, message, link, source_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      notifId,
      'approval_needed',
      `Review needed: ${task.title}`,
      `Step "${task.title}" in "${template?.name || 'Unknown'}" is ready for your review.`,
      `/workspace/default?tab=pipelines`,
      approvalId,
      now,
    ]
  );

  updateRunStatus(task.workflow_run_id, 'paused');

  // Broadcast approval + notification
  const approval = queryOne<Approval>('SELECT * FROM approvals WHERE id = ?', [approvalId]);
  if (approval) {
    broadcast({ type: 'approval_created', payload: approval });
  }

  console.log(`[WorkflowEngine] Run ${task.workflow_run_id} paused — step "${task.title}" awaiting review (approval: ${approvalId})`);
}

/**
 * Approve a step — mark as done and advance the pipeline.
 */
export async function approveStep(taskId: string, notes?: string): Promise<{ success: boolean; error?: string }> {
  const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return { success: false, error: 'Task not found' };
  if (!task.workflow_run_id) return { success: false, error: 'Not a workflow task' };
  if (task.status !== 'review') return { success: false, error: `Task is ${task.status}, not in review` };

  const now = new Date().toISOString();

  // Update approval record
  run(
    `UPDATE approvals SET status = 'approved', resolved_at = ?, resolution_notes = ?, updated_at = ?
     WHERE source_task_id = ? AND status = 'pending'`,
    [now, notes || null, now, taskId]
  );

  // Update run approval count
  run(
    'UPDATE workflow_runs SET approval_count = approval_count + 1 WHERE id = ?',
    [task.workflow_run_id]
  );

  // Mark task as done and advance
  updateTaskStatus(taskId, 'done');
  await onStepCompleted(taskId);

  return { success: true };
}

/**
 * Reject a step — fail the run.
 */
export async function rejectStep(taskId: string, notes?: string): Promise<{ success: boolean; error?: string }> {
  const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return { success: false, error: 'Task not found' };
  if (!task.workflow_run_id) return { success: false, error: 'Not a workflow task' };
  if (task.status !== 'review') return { success: false, error: `Task is ${task.status}, not in review` };

  const now = new Date().toISOString();

  // Update approval record
  run(
    `UPDATE approvals SET status = 'rejected', resolved_at = ?, resolution_notes = ?, updated_at = ?
     WHERE source_task_id = ? AND status = 'pending'`,
    [now, notes || null, now, taskId]
  );

  // Update run rejection count
  run(
    'UPDATE workflow_runs SET rejection_count = rejection_count + 1 WHERE id = ?',
    [task.workflow_run_id]
  );

  // Fail the run
  updateRunStatus(task.workflow_run_id, 'failed', { outcome: `Step "${task.title}" rejected${notes ? ': ' + notes : ''}` });

  return { success: true };
}

/**
 * Cancel a running workflow — kill any active sub-agent sessions.
 */
export async function cancelRun(runId: string): Promise<{ success: boolean; error?: string }> {
  const workflowRun = queryOne<WorkflowRun>('SELECT * FROM workflow_runs WHERE id = ?', [runId]);
  if (!workflowRun) return { success: false, error: 'Run not found' };
  if (workflowRun.status !== 'running' && workflowRun.status !== 'paused') {
    return { success: false, error: `Run is ${workflowRun.status}, cannot cancel` };
  }

  // Kill any active sub-agent sessions
  const tasks = getRunTasks(runId);
  const client = getOpenClawClient();
  const isConnected = client.isConnected();

  for (const task of tasks) {
    if (task.status === 'in_progress') {
      const sessionKey = activeStepSessions.get(task.id);
      if (sessionKey && isConnected) {
        try {
          await client.killSubagent(sessionKey);
          console.log(`[WorkflowEngine] Killed session ${sessionKey} for task ${task.id}`);
        } catch (err) {
          console.warn(`[WorkflowEngine] Failed to kill session ${sessionKey}:`, err);
        }
      }
      updateTaskStatus(task.id, 'inbox');
      activeStepSessions.delete(task.id);
    }
  }

  updateRunStatus(runId, 'cancelled', { outcome: 'Cancelled by user' });
  return { success: true };
}

/**
 * Get the active session key for a task (if it's currently executing).
 */
export function getActiveSession(taskId: string): string | undefined {
  return activeStepSessions.get(taskId);
}
