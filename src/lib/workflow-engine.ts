console.log('[WorkflowEngine] MODULE LOADED');

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
import * as fs from 'fs';
import * as path from 'path';
import { queryOne, queryAll, run } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { broadcast } from '@/lib/events';
import { recordOutcome } from '@/lib/workflow-intelligence';
import { getWorkspaceBasePath } from '@/lib/config';
import type { Task, WorkflowRun, WorkflowStep, WorkflowTemplate, Approval } from '@/lib/types';

// Track tasks with active inline watchers (inside /execute endpoint)
// The global poller must skip these — they have their own polling loop
const WF_INLINE_KEY = '__wf_inline_watched__';
if (!(WF_INLINE_KEY in globalThis)) {
  (globalThis as Record<string, unknown>)[WF_INLINE_KEY] = new Set<string>();
}
const inlineWatchedTasks = (globalThis as unknown as Record<string, Set<string>>)[WF_INLINE_KEY];

// Track active step sessions on globalThis to survive Next.js HMR
const WF_SESSIONS_KEY = '__wf_active_sessions__';
if (!(WF_SESSIONS_KEY in globalThis)) {
  (globalThis as Record<string, unknown>)[WF_SESSIONS_KEY] = new Map<string, string>();
}
const activeStepSessions = (globalThis as unknown as Record<string, Map<string, string>>)[WF_SESSIONS_KEY];

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

      // Update task description with label
      run(
        'UPDATE tasks SET description = ? WHERE id = ?',
        [`Step ${stepIndex + 1} of workflow "${template.name}" [label: ${label}]`, task.id]
      );

      // Spawn the sub-agent (fire-and-forget — OpenClaw always returns immediately)
      const result = await client.spawnSession({
        task: prompt,
        label,
        model: 'anthropic/claude-sonnet-4-6',
        cleanup: 'keep', // Keep so we can read history after completion
        runTimeoutSeconds: 300,
      });

      const sessionKey = result.sessionKey || label;
      activeStepSessions.set(task.id, sessionKey);

      // Update task with session key
      run(
        'UPDATE tasks SET description = ? WHERE id = ?',
        [`Step ${stepIndex + 1} of workflow "${template.name}" [session: ${sessionKey}]`, task.id]
      );

      console.log(`[WorkflowEngine] Step "${step.name}" spawned — session: ${sessionKey}`);

      // Mark this task as inline-watched so the global poller skips it
      inlineWatchedTasks.add(task.id);

      // Poll until the sub-agent completes, then extract output
      // This runs inside the /execute endpoint which has its own HTTP request context
      const maxWait = 300000; // 5 min
      const pollMs = 4000;
      const start = Date.now();

      while (Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, pollMs));

        // Check task hasn't been cancelled or already handled by global poller
        const freshTask = queryOne<Task>('SELECT status FROM tasks WHERE id = ?', [task.id]);
        if (!freshTask || freshTask.status !== 'in_progress') {
          console.log(`[WorkflowEngine] Task ${task.id} no longer in_progress (${freshTask?.status}), stopping inline watcher`);
          inlineWatchedTasks.delete(task.id);
          return { executed: true, taskId: task.id };
        }

        // Check sub-agent status
        const agents = await client.listSubagents({ recentMinutes: 10 });
        const agent = agents.find((a: Record<string, unknown>) =>
          a.sessionKey === sessionKey || a.label === sessionKey
        ) as Record<string, unknown> | undefined;

        if (!agent || agent.status === 'done' || agent.status === 'completed') {
          // Agent finished — extract output from history
          const agentKey = agent?.sessionKey ? String(agent.sessionKey) : sessionKey;
          const output = await extractSessionOutput(client, agentKey);
          console.log(`[WorkflowEngine] Step "${step.name}" done — output: ${output.length} chars`);

          inlineWatchedTasks.delete(task.id);
          await handleStepCompletion(task.id, output.slice(0, 5000) || 'Agent completed successfully');

          // Cleanup session
          try { await client.killSubagent(agentKey); } catch {}
          activeStepSessions.delete(task.id);

          return { executed: true, taskId: task.id };
        }

        if (agent.status === 'failed' || agent.status === 'error') {
          inlineWatchedTasks.delete(task.id);
          handleStepFailure(task.id, 'Agent failed');
          try { await client.killSubagent(String(agent.sessionKey || sessionKey)); } catch {}
          activeStepSessions.delete(task.id);
          return { executed: true, taskId: task.id };
        }
      }

      // Timeout
      inlineWatchedTasks.delete(task.id);
      console.warn(`[WorkflowEngine] Step "${step.name}" timed out after 5 minutes`);
      await handleStepCompletion(task.id, 'Agent timed out after 5 minutes');
      return { executed: true, taskId: task.id };
    } catch (err) {
      console.error(`[WorkflowEngine] Failed to execute step "${step.name}":`, err);
      updateTaskStatus(task.id, 'inbox'); // Revert to inbox on failure

      // If we can't execute, fail the run
      updateRunStatus(runId, 'failed', { outcome: `Step "${step.name}" failed to start: ${err instanceof Error ? err.message : 'Unknown error'}` });
      recordOutcome(runId);

      return { executed: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  // No tasks ready — check if all are done (run complete) or all blocked
  const allDone = tasks.every(t => t.status === 'done');
  if (allDone) {
    updateRunStatus(runId, 'completed', { outcome: 'All steps completed successfully' });

    // Record outcome + update template stats via intelligence module
    recordOutcome(runId);

    // Write consolidated output file to workspace
    writeRunOutput(runId);

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
 * Includes the agent's output in the approval so the reviewer knows what to approve.
 */
export function onStepReview(taskId: string, agentOutput?: string): void {
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
      `Step "${task.title}" completed in pipeline "${template?.name || 'Unknown'}". Review the agent output below before approving.`,
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
      agentOutput
        ? `Step "${task.title}" finished — review the output and approve or reject.`
        : `Step "${task.title}" in "${template?.name || 'Unknown'}" is ready for your review.`,
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

  // Mark task as done and set run back to 'running' so /execute can pick it up
  updateTaskStatus(taskId, 'done');

  // Set run status to 'running' (from 'paused')
  if (task.workflow_run_id) {
    const wr = queryOne<WorkflowRun>('SELECT status FROM workflow_runs WHERE id = ?', [task.workflow_run_id]);
    if (wr && wr.status === 'paused') {
      updateRunStatus(task.workflow_run_id, 'running');
    }
  }

  // Don't chain executeNextStep here — return immediately so the PATCH
  // doesn't block for minutes. The UI will call /execute to continue.
  return { success: true, runId: task.workflow_run_id };
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

  // Record outcome for intelligence tracking
  recordOutcome(task.workflow_run_id);

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

  // Record outcome for intelligence tracking
  recordOutcome(runId);

  return { success: true };
}

/**
 * Get the active session key for a task (if it's currently executing).
 */
export function getActiveSession(taskId: string): string | undefined {
  return activeStepSessions.get(taskId);
}

// ============================================================
// Per-step completion watcher (more reliable than global poller)
// ============================================================

async function watchStepCompletion(
  taskId: string,
  sessionKey: string,
  step: WorkflowStep,
  template: WorkflowTemplate
): Promise<void> {
  const client = getOpenClawClient();
  const maxWait = 300000; // 5 min max
  const pollInterval = 4000; // Check every 4s
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    // Check if task is still in_progress (might have been cancelled)
    const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!task || task.status !== 'in_progress') return;

    try {
      const subagents = await client.listSubagents({ recentMinutes: 10 });
      const agent = subagents.find((a: Record<string, unknown>) =>
        a.sessionKey === sessionKey || a.label === sessionKey
      ) as Record<string, unknown> | undefined;

      if (!agent) {
        // Session gone — try history extraction one last time
        let output = await extractSessionOutput(client, sessionKey);
        await handleStepCompletion(taskId, output || 'Agent completed (session ended)');
        return;
      }

      if (agent.status === 'done' || agent.status === 'completed') {
        // Extract output from history while session still exists
        let output = await extractSessionOutput(client, String(agent.sessionKey || sessionKey));
        await handleStepCompletion(taskId, output || 'Agent completed successfully');

        // Clean up
        try { await client.killSubagent(String(agent.sessionKey || sessionKey)); } catch {}
        activeStepSessions.delete(taskId);
        return;
      }

      if (agent.status === 'failed' || agent.status === 'error') {
        handleStepFailure(taskId, 'Agent failed');
        try { await client.killSubagent(String(agent.sessionKey || sessionKey)); } catch {}
        activeStepSessions.delete(taskId);
        return;
      }
    } catch {
      // Network error — retry
    }
  }

  // Timeout
  console.warn(`[WorkflowEngine] Step watcher timed out for task ${taskId}`);
  await handleStepCompletion(taskId, 'Agent timed out after 5 minutes');
}

async function extractSessionOutput(client: ReturnType<typeof getOpenClawClient>, sessionKey: string): Promise<string> {
  try {
    const history = await client.getSubagentHistory(sessionKey, { limit: 5, includeTools: true }) as Array<{
      role?: string;
      content?: string | Array<{ type: string; text?: string; thinking?: string }>;
    }>;

    // Walk backwards through messages looking for the last assistant text
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (msg.role !== 'assistant') continue;

      if (typeof msg.content === 'string' && msg.content.length > 10) {
        return msg.content.slice(0, 5000);
      }
      if (Array.isArray(msg.content)) {
        const textBlocks = msg.content.filter(b => b.type === 'text' && b.text);
        if (textBlocks.length > 0) {
          return textBlocks.map(b => b.text).join('\n').slice(0, 5000);
        }
      }
    }
  } catch {
    // History unavailable
  }
  return '';
}

// ============================================================
// Global completion poller (backup — catches missed steps)
// ============================================================
// sessions_spawn is fire-and-forget. This poller checks active
// sub-agent sessions and marks tasks done when they complete.

// Use globalThis to survive Next.js HMR module reloads
const GLOBAL_POLLER_KEY = '__wf_completion_poller__';
const POLL_INTERVAL_MS = 5000;

async function pollActiveSteps(): Promise<void> {
  // Check for in_progress workflow tasks in DB — don't rely solely on in-memory Map
  const inProgressTasks = queryAll<Task & { workflow_run_id: string }>(
    `SELECT * FROM tasks WHERE status = 'in_progress' AND workflow_run_id IS NOT NULL`
  );

  // Sync DB state into activeStepSessions (handles HMR reloads losing in-memory state)
  for (const task of inProgressTasks) {
    if (!activeStepSessions.has(task.id)) {
      // Extract session key from description: "Step N of ... [session: xxx]"
      const match = task.description?.match(/\[session:\s*([^\]]+)\]/);
      if (match) {
        activeStepSessions.set(task.id, match[1]);
      }
    }
  }

  if (activeStepSessions.size === 0) return;

  try {
    const client = getOpenClawClient();
    if (!client.isConnected()) return;

    // Get active + recently completed sub-agents from OpenClaw
    const subagents = await client.listSubagents({ recentMinutes: 60 }) as Array<{
      sessionKey?: string;
      label?: string;
      status?: string;
      completedAt?: string;
      result?: string;
    }>;

    const entries = Array.from(activeStepSessions.entries());
    for (const [taskId, sessionKey] of entries) {
      // Skip tasks that have an active inline watcher (inside /execute endpoint)
      // The inline watcher is authoritative — it has better timing for output extraction
      if (inlineWatchedTasks.has(taskId)) {
        continue;
      }

      // Find this session in the sub-agents list
      const agent = subagents.find(
        (a) => a.sessionKey === sessionKey || a.label === sessionKey
      );

      if (!agent) {
        // Session not found — might have been cleaned up (cleanup: 'delete')
        // Check if enough time has passed (avoid marking done too early)
        const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
        if (!task || task.status !== 'in_progress') {
          activeStepSessions.delete(taskId);
          continue;
        }

        // If the task has been in_progress for > 15s and the session is gone,
        // try to extract output before giving up
        const elapsed = Date.now() - new Date(task.updated_at).getTime();
        if (elapsed > 15000) {
          console.log(`[WorkflowEngine] Session ${sessionKey} for task ${taskId} not found — attempting history extraction`);

          let output = '';
          try {
            // Try fetching history — session might still exist even if not in subagents list
            const history = await client.getSubagentHistory(sessionKey, { limit: 5, includeTools: true }) as Array<{
              role?: string;
              content?: string | Array<{ type: string; text?: string }>;
            }>;
            const lastAssistant = history?.filter((m) => m.role === 'assistant').pop();
            if (lastAssistant?.content) {
              if (typeof lastAssistant.content === 'string') {
                output = lastAssistant.content.slice(0, 5000);
              } else if (Array.isArray(lastAssistant.content)) {
                output = lastAssistant.content
                  .filter((b) => b.type === 'text' && b.text)
                  .map((b) => b.text)
                  .join('\n')
                  .slice(0, 5000);
              }
            }
          } catch {
            // History truly unavailable
          }

          await handleStepCompletion(taskId, output || 'Agent completed (output not available — session was cleaned up before extraction)');
        }
        continue;
      }

      // Check if the sub-agent finished
      if (agent.completedAt || agent.status === 'completed' || agent.status === 'done') {
        console.log(`[WorkflowEngine] Sub-agent ${sessionKey} completed for task ${taskId}`);

        // Try to get the result from session history
        let output = agent.result || '';
        if (!output) {
          try {
            const history = await client.getSubagentHistory(
              agent.sessionKey || sessionKey,
              { limit: 5 }
            ) as Array<{ role?: string; content?: string | Array<{ type: string; text?: string }> }>;
            const lastAssistant = history?.filter((m) => m.role === 'assistant').pop();
            if (lastAssistant?.content) {
              if (typeof lastAssistant.content === 'string') {
                output = lastAssistant.content.slice(0, 5000);
              } else if (Array.isArray(lastAssistant.content)) {
                // Content blocks: [{ type: 'text', text: '...' }]
                output = lastAssistant.content
                  .filter((b) => b.type === 'text' && b.text)
                  .map((b) => b.text)
                  .join('\n')
                  .slice(0, 5000);
              }
            }
          } catch {
            // Session might already be deleted
          }
        }

        console.log(`[WorkflowEngine] Extracted output for ${taskId}: ${output.length} chars, first 100: ${output.slice(0, 100)}`);
        await handleStepCompletion(taskId, output || 'Agent completed successfully (no text output captured)');

        // Clean up the session now that we've extracted the output
        try {
          await client.killSubagent(agent.sessionKey || sessionKey);
        } catch {
          // Already cleaned up
        }
      } else if (agent.status === 'failed' || agent.status === 'error') {
        console.error(`[WorkflowEngine] Sub-agent ${sessionKey} failed for task ${taskId}`);
        handleStepFailure(taskId, agent.result || 'Sub-agent failed');

        try {
          await client.killSubagent(agent.sessionKey || sessionKey);
        } catch { /* ignore */ }
      }
    }
  } catch (err) {
    console.warn('[WorkflowEngine] Poller error:', err);
  }
}

// ============================================================
// Pipeline output file writer
// ============================================================

function writeRunOutput(runId: string): void {
  try {
    const workflowRun = queryOne<WorkflowRun>('SELECT * FROM workflow_runs WHERE id = ?', [runId]);
    if (!workflowRun) return;

    const template = queryOne<WorkflowTemplate>('SELECT * FROM workflow_templates WHERE id = ?', [workflowRun.template_id]);
    if (!template) return;

    // Get all tasks for this run, ordered by step index
    const tasks = queryAll<Task>(
      'SELECT * FROM tasks WHERE workflow_run_id = ? ORDER BY workflow_step_index ASC',
      [runId]
    );

    // Get deliverables for each task
    type Deliverable = { task_id: string; title: string; description: string };
    const deliverablesByTask = new Map<string, Deliverable[]>();
    for (const task of tasks) {
      const delivs = queryAll<Deliverable>(
        'SELECT * FROM task_deliverables WHERE task_id = ? ORDER BY created_at ASC',
        [task.id]
      );
      deliverablesByTask.set(task.id, delivs);
    }

    // Build the output file content
    const triggerInput = workflowRun.trigger_input || workflowRun.name || 'untitled';
    const startedAt = workflowRun.started_at || workflowRun.created_at;
    const completedAt = workflowRun.completed_at || new Date().toISOString();

    const lines: string[] = [];
    lines.push(`# ${triggerInput}`);
    lines.push(`**Pipeline:** ${template.name}`);
    lines.push(`**Started:** ${formatTimestamp(startedAt)}`);
    lines.push(`**Completed:** ${formatTimestamp(completedAt)}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const task of tasks) {
      lines.push(`## ${task.title}`);
      lines.push('');

      const delivs = deliverablesByTask.get(task.id) || [];
      if (delivs.length > 0) {
        for (const d of delivs) {
          if (d.description) {
            lines.push(d.description);
            lines.push('');
          }
        }
      } else {
        lines.push('*(no output captured)*');
        lines.push('');
      }
    }

    // Build file path: {workspace}/pipeline-outputs/{template-slug}/{timestamp}_{trigger-slug}.md
    const workspacePath = resolveHome(getWorkspaceBasePath());
    const templateSlug = slugify(template.name);
    const triggerSlug = slugify(triggerInput).slice(0, 60);
    const timestamp = formatFileTimestamp(startedAt);
    const fileName = `${timestamp}_${triggerSlug}.md`;

    const outputDir = path.join(workspacePath, 'pipeline-outputs', templateSlug);
    fs.mkdirSync(outputDir, { recursive: true });

    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');

    // Store the file path in the run metadata
    run(
      'UPDATE workflow_runs SET outcome = ? WHERE id = ?',
      [`All steps completed successfully. Output: ${filePath}`, runId]
    );

    console.log(`[WorkflowEngine] Pipeline output written to: ${filePath}`);

    // Broadcast the file write event
    broadcast({
      type: 'pipeline_output',
      taskId: runId,
      message: `Pipeline output saved to ${filePath}`,
    });

  } catch (err) {
    console.error(`[WorkflowEngine] Failed to write run output:`, err);
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}

function formatFileTimestamp(iso: string): string {
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  const pad = (n: number) => String(n).padStart(2, '0');
  // Adjust for CST (-6)
  const cst = new Date(d.getTime() - 6 * 60 * 60 * 1000);
  return `${cst.getUTCFullYear()}-${pad(cst.getUTCMonth() + 1)}-${pad(cst.getUTCDate())}_${pad(cst.getUTCHours())}-${pad(cst.getUTCMinutes())}`;
}

function resolveHome(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(process.env.HOME || '/home/user', p.slice(2));
  }
  return p;
}

async function handleStepCompletion(taskId: string, output: string): Promise<void> {
  activeStepSessions.delete(taskId);

  const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task || task.status !== 'in_progress') return;

  console.log(`[WorkflowEngine] handleStepCompletion for "${task.title}" — output length: ${output.length}`);

  // Store output as a deliverable
  if (output) {
    try {
      const now = new Date().toISOString();
      const delivId = uuidv4();
      run(
        `INSERT INTO task_deliverables (id, task_id, deliverable_type, title, path, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [delivId, taskId, 'agent_output', `${task.title} — Output`, 'agent-output', output.slice(0, 5000), now]
      );
      console.log(`[WorkflowEngine] Stored deliverable for "${task.title}" (${output.length} chars)`);
    } catch (err) {
      console.error(`[WorkflowEngine] Failed to store deliverable:`, err);
    }
  }

  // Check if this step has a review checkpoint
  if (task.workflow_run_id) {
    const template = queryOne<WorkflowTemplate>(
      `SELECT wt.* FROM workflow_templates wt
       JOIN workflow_runs wr ON wr.template_id = wt.id
       WHERE wr.id = ?`,
      [task.workflow_run_id]
    );

    if (template) {
      const steps = parseSteps(template);
      const step = steps[task.workflow_step_index ?? 0];
      if (step?.review) {
        // Move to review instead of done — pass agent output for approval context
        updateTaskStatus(taskId, 'review');
        onStepReview(taskId, output);
        return;
      }
    }
  }

  // Mark done and advance — chain next step (awaited so /execute stays alive)
  updateTaskStatus(taskId, 'done');
  if (task.workflow_run_id) {
    await onStepCompleted(taskId);
  }
}

function handleStepFailure(taskId: string, error: string): void {
  activeStepSessions.delete(taskId);

  const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task || task.status !== 'in_progress') return;

  updateTaskStatus(taskId, 'inbox'); // Revert

  if (task.workflow_run_id) {
    updateRunStatus(task.workflow_run_id, 'failed', {
      outcome: `Step "${task.title}" failed: ${error}`,
    });
    recordOutcome(task.workflow_run_id);
  }
}

/**
 * Start the completion poller. Uses globalThis to survive HMR.
 */
export function startCompletionPoller(): void {
  console.log('[WorkflowEngine] startCompletionPoller called, existing:', !!(globalThis as Record<string, unknown>)[GLOBAL_POLLER_KEY]);
  const existing = (globalThis as Record<string, unknown>)[GLOBAL_POLLER_KEY];
  if (existing) return; // Already running

  const interval = setInterval(() => {
    console.log(`[WorkflowEngine] Polling... active sessions: ${activeStepSessions.size}`);
    pollActiveSteps().catch(err => console.error('[WorkflowEngine] Poll error:', err));
  }, POLL_INTERVAL_MS);
  (globalThis as Record<string, unknown>)[GLOBAL_POLLER_KEY] = interval;
  console.log('[WorkflowEngine] Completion poller STARTED (every 5s)');
}

/**
 * Stop the completion poller.
 */
export function stopCompletionPoller(): void {
  const interval = (globalThis as Record<string, unknown>)[GLOBAL_POLLER_KEY] as ReturnType<typeof setInterval> | undefined;
  if (interval) {
    clearInterval(interval);
    (globalThis as Record<string, unknown>)[GLOBAL_POLLER_KEY] = null;
  }
}

// Poller is started via @/lib/init — import init from any API route to activate.
