import '@/lib/init';
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run, transaction } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { startContentScoutPoller } from '@/lib/content-scout/poller';
import {
  CONTENT_SCOUT_DAILY_TEMPLATE_NAME,
  CONTENT_SCOUT_STEP_LABELS,
  CONTENT_SCOUT_STEP_ORDER,
} from '@/lib/content-scout/seed';
import type { Task, WorkflowRun, WorkflowStep, WorkflowTemplate } from '@/lib/types';

const APP_ROOT = path.resolve(process.cwd());
const VENV_PYTHON = path.join(APP_ROOT, '.venv', 'bin', 'python');
const PIPELINE_SCRIPT = path.join(APP_ROOT, 'scripts', 'content-scout', 'run_pipeline.py');
const STATE_FILE = path.join(APP_ROOT, 'tmp', '_pipeline_state.json');

interface PipelineStateSnapshot {
  steps?: Record<string, { status?: string }>;
}

function parseSteps(template: WorkflowTemplate): WorkflowStep[] {
  if (typeof template.steps === 'string') {
    return JSON.parse(template.steps as unknown as string) as WorkflowStep[];
  }
  return template.steps;
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

function markRunSpawnFailure(runId: string, message: string): void {
  const now = new Date().toISOString();
  const runData = queryOne<WorkflowRun>('SELECT started_at FROM workflow_runs WHERE id = ?', [runId]);
  const durationSeconds = runData?.started_at
    ? Math.round((new Date(now).getTime() - new Date(runData.started_at).getTime()) / 1000)
    : null;

  const updates = ['status = ?', 'outcome = ?', 'completed_at = ?'];
  const params: unknown[] = ['failed', message, now];
  if (durationSeconds !== null) {
    updates.push('duration_seconds = ?');
    params.push(durationSeconds);
  }
  params.push(runId);

  run(`UPDATE workflow_runs SET ${updates.join(', ')} WHERE id = ?`, params);

  const updatedRun = queryOne<WorkflowRun>('SELECT * FROM workflow_runs WHERE id = ?', [runId]);
  if (updatedRun) {
    broadcast({ type: 'workflow_run_updated', payload: updatedRun });
  }
}

/**
 * POST /api/content-scout/trigger
 *
 * Trigger a Content Scout pipeline run.
 * Body: { videoUrl?: string, dryRun?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { videoUrl, dryRun } = body as { videoUrl?: string; dryRun?: boolean };

    // Check if pipeline is already running
    if (fs.existsSync(STATE_FILE)) {
      try {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as PipelineStateSnapshot;
        const runningSteps = Object.values(state.steps || {}).filter(
          (s) => s.status === 'running'
        );
        if (runningSteps.length > 0) {
          return NextResponse.json(
            { error: 'Pipeline is already running', state },
            { status: 409 }
          );
        }
      } catch {
        // Corrupt state file — allow new run
      }
    }

    const template = queryOne<WorkflowTemplate>(
      `SELECT *
       FROM workflow_templates
       WHERE workspace_id = ?
         AND (name = ? OR name = 'content-scout-daily')
       ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END
       LIMIT 1`,
      ['default', CONTENT_SCOUT_DAILY_TEMPLATE_NAME, CONTENT_SCOUT_DAILY_TEMPLATE_NAME]
    );
    if (!template) {
      return NextResponse.json(
        { error: `Content Scout template "${CONTENT_SCOUT_DAILY_TEMPLATE_NAME}" not found` },
        { status: 500 }
      );
    }

    const templateSteps = parseSteps(template);
    const stepNames = CONTENT_SCOUT_STEP_ORDER.map((stepKey, index) => {
      return templateSteps[index]?.name || CONTENT_SCOUT_STEP_LABELS[stepKey];
    });

    const now = new Date().toISOString();
    const runId = uuidv4();
    const triggerInput = videoUrl || 'Daily pipeline';

    const created = transaction(() => {
      run(
        `INSERT INTO workflow_runs
          (id, template_id, name, status, trigger_input, trigger_method, workspace_id, started_at)
         VALUES (?, ?, ?, 'running', ?, 'content-scout', ?, ?)`,
        [runId, template.id, template.name, triggerInput, template.workspace_id || 'default', now]
      );

      const taskIds: string[] = [];

      for (let i = 0; i < stepNames.length; i++) {
        const taskId = uuidv4();
        taskIds.push(taskId);

        run(
          `INSERT INTO tasks
            (id, title, description, status, priority, workspace_id, workflow_run_id, workflow_step_index, created_at, updated_at)
           VALUES (?, ?, ?, 'inbox', 'normal', ?, ?, ?, ?, ?)`,
          [
            taskId,
            stepNames[i],
            `Content Scout step ${i + 1} of ${stepNames.length}`,
            template.workspace_id || 'default',
            runId,
            i,
            now,
            now,
          ]
        );
      }

      for (let i = 1; i < taskIds.length; i++) {
        run(
          `INSERT INTO task_dependencies (id, task_id, depends_on_task_id, dependency_type, created_at)
           VALUES (?, ?, ?, 'finish_to_start', ?)`,
          [uuidv4(), taskIds[i], taskIds[i - 1], now]
        );
      }

      if (taskIds.length > 0) {
        run(
          `UPDATE tasks
           SET status = 'in_progress', started_at = ?, completed_at = NULL, updated_at = ?
           WHERE id = ?`,
          [now, now, taskIds[0]]
        );
      }

      run(
        `UPDATE workflow_templates
         SET total_runs = total_runs + 1, last_used_at = ?, updated_at = ?
         WHERE id = ?`,
        [now, now, template.id]
      );

      return { runId, taskIds };
    });

    const workflowRun = queryOne<WorkflowRun>('SELECT * FROM workflow_runs WHERE id = ?', [created.runId]);
    if (workflowRun) {
      broadcast({ type: 'workflow_run_created', payload: workflowRun });
    }

    const runTasks = queryAll<Task>(
      `SELECT t.*, aa.name as assigned_agent_name, aa.avatar_emoji as assigned_agent_emoji
       FROM tasks t
       LEFT JOIN agents aa ON t.assigned_agent_id = aa.id
       WHERE t.workflow_run_id = ?
       ORDER BY t.workflow_step_index ASC`,
      [created.runId]
    );
    for (const task of runTasks) {
      broadcast({ type: 'task_created', payload: task });
    }

    startContentScoutPoller(created.runId);

    // Build command
    const args = [PIPELINE_SCRIPT];
    if (videoUrl) args.push('--video-url', videoUrl);
    if (dryRun) args.push('--dry-run');

    const pythonExecutable = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';

    // Spawn detached so it runs independently of this request
    const child = spawn(pythonExecutable, args, {
      cwd: APP_ROOT,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PYTHONPATH: path.join(APP_ROOT, 'scripts', 'content-scout'),
      },
    });
    child.on('error', (spawnError) => {
      console.error('[ContentScoutTrigger] Failed to spawn pipeline process:', spawnError);
      markRunSpawnFailure(
        created.runId,
        `Failed to spawn Content Scout process: ${spawnError.message}`
      );

      const firstTask = created.taskIds[0];
      if (firstTask) {
        run(
          `UPDATE tasks
           SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'in_progress'`,
          [spawnError.message, new Date().toISOString(), new Date().toISOString(), firstTask]
        );

        const updatedTask = getTaskForBroadcast(firstTask);
        if (updatedTask) {
          broadcast({ type: 'task_updated', payload: updatedTask });
        }
      }
    });

    child.unref();

    return NextResponse.json({
      ok: true,
      message: dryRun ? 'Dry run started' : 'Pipeline started',
      pid: child.pid,
      run_id: created.runId,
      runId: created.runId,
      videoUrl: videoUrl || null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to trigger pipeline' },
      { status: 500 }
    );
  }
}
