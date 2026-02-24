import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import type { Task, TaskDeliverable, TaskStatus, WorkflowRun, WorkflowRunStatus } from '@/lib/types';
import { CONTENT_SCOUT_STEP_ORDER } from './seed';

const APP_ROOT = path.resolve(process.cwd());
const STATE_FILE = path.join(APP_ROOT, 'tmp', '_pipeline_state.json');
const DAILY_ROOT = path.join(APP_ROOT, 'content-vault', 'daily');
const OPTIONAL_FAILED_STEPS = new Set<string>(['notion', 'transcribe']);

const GLOBAL_POLLER_KEY = '__content_scout_state_poller__';
const GLOBAL_ACTIVE_RUNS_KEY = '__content_scout_active_runs__';
const POLL_INTERVAL_MS = 3000;

type PipelineStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

interface PipelineStepState {
  status?: PipelineStepStatus;
  message?: string;
  updatedAt?: string;
}

interface PipelineStateFile {
  date?: string;
  updatedAt?: string;
  steps?: Record<string, PipelineStepState>;
}

if (!(GLOBAL_ACTIVE_RUNS_KEY in globalThis)) {
  (globalThis as Record<string, unknown>)[GLOBAL_ACTIVE_RUNS_KEY] = new Set<string>();
}
const activeRunIds = (globalThis as unknown as Record<string, Set<string>>)[GLOBAL_ACTIVE_RUNS_KEY];

function readPipelineState(): PipelineStateFile | null {
  if (!fs.existsSync(STATE_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(content) as PipelineStateFile;
    return parsed;
  } catch (error) {
    console.warn('[ContentScoutPoller] Failed to read state file:', error);
    return null;
  }
}

function getRunTasks(runId: string): Task[] {
  return queryAll<Task>(
    'SELECT * FROM tasks WHERE workflow_run_id = ? ORDER BY workflow_step_index ASC',
    [runId]
  );
}

function getTaskForBroadcast(taskId: string): Task | undefined {
  return queryOne<Task>(
    `SELECT t.*, aa.name as assigned_agent_name, aa.avatar_emoji as assigned_agent_emoji
     FROM tasks t
     LEFT JOIN agents aa ON t.assigned_agent_id = aa.id
     WHERE t.id = ?`,
    [taskId]
  );
}

function updateTaskStatus(taskId: string, status: TaskStatus, note?: string): void {
  const now = new Date().toISOString();
  const updates = ['status = ?', 'updated_at = ?'];
  const params: unknown[] = [status, now];

  if (status === 'in_progress') {
    updates.push('started_at = ?');
    updates.push('completed_at = NULL');
    params.push(now);
  }

  if (status === 'done' || status === 'review' || status === 'failed') {
    updates.push('completed_at = ?');
    params.push(now);
  }

  if (note !== undefined) {
    updates.push('error_message = ?');
    params.push(note);
  } else if (status !== 'failed') {
    updates.push('error_message = NULL');
  }

  params.push(taskId);
  run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, params);

  const updatedTask = getTaskForBroadcast(taskId);
  if (updatedTask) {
    broadcast({ type: 'task_updated', payload: updatedTask });
  }
}

function updateRunStatus(runId: string, status: WorkflowRunStatus, outcome?: string): void {
  const now = new Date().toISOString();
  const updates = ['status = ?'];
  const params: unknown[] = [status];

  if (outcome !== undefined) {
    updates.push('outcome = ?');
    params.push(outcome);
  }

  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    updates.push('completed_at = ?');
    params.push(now);

    const runData = queryOne<WorkflowRun>('SELECT started_at FROM workflow_runs WHERE id = ?', [runId]);
    if (runData?.started_at) {
      const durationMs = new Date(now).getTime() - new Date(runData.started_at).getTime();
      updates.push('duration_seconds = ?');
      params.push(Math.round(durationMs / 1000));
    }
  }

  params.push(runId);
  run(`UPDATE workflow_runs SET ${updates.join(', ')} WHERE id = ?`, params);

  const updatedRun = queryOne<WorkflowRun>('SELECT * FROM workflow_runs WHERE id = ?', [runId]);
  if (updatedRun) {
    broadcast({ type: 'workflow_run_updated', payload: updatedRun });
  }
}

function maybeAttachBriefDeliverable(runId: string, tasks: Task[], pipelineDate?: string): void {
  const safeDate = (pipelineDate && /^\d{4}-\d{2}-\d{2}$/.test(pipelineDate))
    ? pipelineDate
    : new Date().toISOString().split('T')[0];

  const dailyDir = path.join(DAILY_ROOT, safeDate);
  if (!fs.existsSync(dailyDir)) {
    return;
  }

  const briefCandidates = fs.readdirSync(dailyDir)
    .filter((fileName) => /^_brief-.*\.md$/i.test(fileName))
    .map((fileName) => {
      const absPath = path.join(dailyDir, fileName);
      const stat = fs.statSync(absPath);
      return { absPath, fileName, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const latestBrief = briefCandidates[0];
  if (!latestBrief) {
    return;
  }

  const lastCompletedTask = [...tasks]
    .sort((a, b) => (a.workflow_step_index ?? 0) - (b.workflow_step_index ?? 0))
    .reverse()
    .find((task) => task.status === 'done');

  if (!lastCompletedTask) {
    return;
  }

  const relativePath = path.relative(APP_ROOT, latestBrief.absPath).replace(/\\/g, '/');
  const existing = queryOne<{ id: string }>(
    'SELECT id FROM task_deliverables WHERE task_id = ? AND path = ? LIMIT 1',
    [lastCompletedTask.id, relativePath]
  );
  if (existing?.id) {
    return;
  }

  const deliverableId = uuidv4();
  const now = new Date().toISOString();
  run(
    `INSERT INTO task_deliverables
      (id, task_id, deliverable_type, title, path, description, is_input, created_at)
     VALUES (?, ?, 'file', ?, ?, ?, 0, ?)`,
    [
      deliverableId,
      lastCompletedTask.id,
      'Daily Brief',
      relativePath,
      `Generated Content Scout brief for ${safeDate}`,
      now,
    ]
  );

  const deliverable = queryOne<TaskDeliverable>(
    'SELECT * FROM task_deliverables WHERE id = ?',
    [deliverableId]
  );
  if (deliverable) {
    broadcast({ type: 'deliverable_added', payload: deliverable });
  }
}

function isTerminalStepStatus(status?: PipelineStepStatus): boolean {
  return status === 'completed' || status === 'failed';
}

function pollRun(runId: string): void {
  const workflowRun = queryOne<WorkflowRun>('SELECT * FROM workflow_runs WHERE id = ?', [runId]);
  if (!workflowRun || workflowRun.status !== 'running') {
    activeRunIds.delete(runId);
    return;
  }

  const tasks = getRunTasks(runId);
  if (tasks.length === 0) {
    return;
  }

  const pipelineState = readPipelineState();
  if (!pipelineState?.steps) {
    return;
  }

  // Ignore stale state from an earlier run (common before Python rewrites state).
  if (pipelineState.updatedAt && workflowRun.started_at) {
    const stateUpdatedAt = new Date(pipelineState.updatedAt).getTime();
    const runStartedAt = new Date(workflowRun.started_at).getTime();
    if (!Number.isNaN(stateUpdatedAt) && !Number.isNaN(runStartedAt) && stateUpdatedAt < runStartedAt) {
      return;
    }
  }

  const taskStatuses = new Map<string, TaskStatus>(tasks.map((task) => [task.id, task.status]));

  for (let i = 0; i < CONTENT_SCOUT_STEP_ORDER.length; i++) {
    const stepKey = CONTENT_SCOUT_STEP_ORDER[i];
    const stepState = pipelineState.steps[stepKey];
    const task = tasks[i];

    if (!stepState || !task) {
      continue;
    }

    const stepStatus = stepState.status;
    const stepMessage = typeof stepState.message === 'string' ? stepState.message.trim() : '';
    const currentTaskStatus = taskStatuses.get(task.id) ?? task.status;

    if (stepStatus === 'running' && currentTaskStatus === 'inbox') {
      updateTaskStatus(task.id, 'in_progress');
      taskStatuses.set(task.id, 'in_progress');
      continue;
    }

    if (
      stepStatus === 'completed' &&
      (currentTaskStatus === 'in_progress' || currentTaskStatus === 'inbox')
    ) {
      updateTaskStatus(task.id, 'done');
      taskStatuses.set(task.id, 'done');
      continue;
    }

    if (stepStatus === 'failed') {
      if (OPTIONAL_FAILED_STEPS.has(stepKey)) {
        if (currentTaskStatus !== 'done') {
          const note = stepMessage || 'Optional step failed in Content Scout pipeline.';
          updateTaskStatus(task.id, 'done', `Optional step failed: ${note}`);
          taskStatuses.set(task.id, 'done');
        }
        continue;
      }

      if (currentTaskStatus !== 'failed') {
        const failureMessage = stepMessage || 'Required step failed in Content Scout pipeline.';
        updateTaskStatus(task.id, 'failed', failureMessage);
      }

      updateRunStatus(
        runId,
        'failed',
        `Content Scout failed at step "${stepKey}"${stepMessage ? `: ${stepMessage}` : ''}`
      );
      activeRunIds.delete(runId);
      return;
    }
  }

  const allStepsTerminal = CONTENT_SCOUT_STEP_ORDER.every((stepKey) =>
    isTerminalStepStatus(pipelineState.steps?.[stepKey]?.status)
  );

  if (!allStepsTerminal) {
    return;
  }

  const refreshedTasks = getRunTasks(runId);
  maybeAttachBriefDeliverable(runId, refreshedTasks, pipelineState.date);
  updateRunStatus(runId, 'completed', 'Content Scout pipeline completed');
  activeRunIds.delete(runId);
}

function pollActiveRuns(): void {
  const runIds = Array.from(activeRunIds);

  for (const runId of runIds) {
    try {
      pollRun(runId);
    } catch (error) {
      console.error(`[ContentScoutPoller] Error polling run ${runId}:`, error);
    }
  }

  if (activeRunIds.size === 0) {
    stopContentScoutPoller();
  }
}

/**
 * Start the Content Scout state-file poller and watch the given run.
 */
export function startContentScoutPoller(runId: string): void {
  activeRunIds.add(runId);

  const existing = (globalThis as Record<string, unknown>)[GLOBAL_POLLER_KEY] as ReturnType<typeof setInterval> | undefined;
  if (existing) {
    return;
  }

  const interval = setInterval(() => {
    pollActiveRuns();
  }, POLL_INTERVAL_MS);

  (globalThis as Record<string, unknown>)[GLOBAL_POLLER_KEY] = interval;
  console.log('[ContentScoutPoller] Started (every 3s)');
}

/**
 * Stop the Content Scout state-file poller.
 */
export function stopContentScoutPoller(): void {
  const interval = (globalThis as Record<string, unknown>)[GLOBAL_POLLER_KEY] as ReturnType<typeof setInterval> | null | undefined;
  if (interval) {
    clearInterval(interval);
  }
  (globalThis as Record<string, unknown>)[GLOBAL_POLLER_KEY] = null;
}
