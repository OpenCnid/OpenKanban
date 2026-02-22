/**
 * Workflow Intelligence — outcome tracking, template health scoring,
 * and promotion/deprecation signals.
 *
 * Tracks:
 * - Per-run outcomes (success, partial, failed, cancelled)
 * - Rolling success rate (last N runs per template)
 * - Template health classification (healthy, warning, review, retired)
 * - Counterexamples (failures worth remembering)
 */

import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run } from '@/lib/db';
import type { WorkflowRun, WorkflowTemplate } from '@/lib/types';

// --- Constants ---

const ROLLING_WINDOW = 10; // Last N runs for success rate
const HEALTHY_THRESHOLD = 0.8; // ≥ 80% success = healthy
const WARNING_THRESHOLD = 0.6; // 60-80% = warning
const REVIEW_THRESHOLD = 0.6; // < 60% = flagged for review
const MIN_RUNS_FOR_REVIEW = 5; // Need at least N runs before flagging

// --- Types ---

export type TemplateHealthStatus = 'healthy' | 'warning' | 'review' | 'new' | 'retired';

export interface TemplateHealth {
  templateId: string;
  name: string;
  healthStatus: TemplateHealthStatus;
  successRate: number | null;
  totalRuns: number;
  recentRuns: number; // Runs in rolling window
  avgDurationSeconds: number | null;
  approvalRate: number | null; // % of review steps approved first try
  lastUsedAt: string | null;
  retrievalCount: number;
  counterexampleCount: number;
}

export interface RunOutcome {
  runId: string;
  templateId: string;
  outcome: 'success' | 'partial' | 'failed' | 'cancelled';
  approvalCount: number;
  rejectionCount: number;
  durationSeconds: number | null;
  stepCount: number;
  completedSteps: number;
}

// --- Core Functions ---

/**
 * Record the outcome of a completed workflow run.
 * Called when a run reaches a terminal state (completed, failed, cancelled).
 */
export function recordOutcome(runId: string): RunOutcome | null {
  const workflowRun = queryOne<WorkflowRun>('SELECT * FROM workflow_runs WHERE id = ?', [runId]);
  if (!workflowRun) return null;

  // Count steps
  const tasks = queryAll<{ status: string }>(
    'SELECT status FROM tasks WHERE workflow_run_id = ?',
    [runId]
  );
  const stepCount = tasks.length;
  const completedSteps = tasks.filter(t => t.status === 'done').length;

  // Determine outcome
  let outcome: RunOutcome['outcome'];
  if (workflowRun.status === 'completed') {
    outcome = completedSteps === stepCount ? 'success' : 'partial';
  } else if (workflowRun.status === 'cancelled') {
    outcome = 'cancelled';
  } else {
    outcome = 'failed';
  }

  // Update the run with outcome details
  run(
    'UPDATE workflow_runs SET outcome = ? WHERE id = ?',
    [outcome, runId]
  );

  // Update template stats
  updateTemplateStats(workflowRun.template_id);

  // Check for counterexample (failure worth recording)
  if (outcome === 'failed') {
    recordCounterexample(workflowRun);
  }

  return {
    runId,
    templateId: workflowRun.template_id,
    outcome,
    approvalCount: workflowRun.approval_count,
    rejectionCount: workflowRun.rejection_count,
    durationSeconds: workflowRun.duration_seconds ?? null,
    stepCount,
    completedSteps,
  };
}

/**
 * Update a template's aggregate stats from its run history.
 */
export function updateTemplateStats(templateId: string): void {
  // Get recent runs (rolling window)
  const recentRuns = queryAll<{ status: string; outcome: string | null; duration_seconds: number | null; approval_count: number; rejection_count: number }>(
    `SELECT status, outcome, duration_seconds, approval_count, rejection_count
     FROM workflow_runs
     WHERE template_id = ?
     ORDER BY started_at DESC
     LIMIT ?`,
    [templateId, ROLLING_WINDOW]
  );

  const totalRuns = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM workflow_runs WHERE template_id = ?',
    [templateId]
  )?.count || 0;

  // Success rate (rolling window)
  const terminalRuns = recentRuns.filter(r => r.status === 'completed' || r.status === 'failed');
  const successCount = terminalRuns.filter(r => r.outcome === 'success').length;
  const successRate = terminalRuns.length > 0 ? successCount / terminalRuns.length : null;

  // Average duration (only completed runs)
  const completedRuns = recentRuns.filter(r => r.duration_seconds != null);
  const avgDuration = completedRuns.length > 0
    ? Math.round(completedRuns.reduce((sum, r) => sum + (r.duration_seconds || 0), 0) / completedRuns.length)
    : null;

  // Update template
  const now = new Date().toISOString();
  run(
    `UPDATE workflow_templates
     SET success_rate = ?, total_runs = ?, last_used_at = ?, updated_at = ?
     WHERE id = ?`,
    [successRate, totalRuns, now, now, templateId]
  );

  // Auto-flag for review if below threshold
  if (totalRuns >= MIN_RUNS_FOR_REVIEW && successRate !== null && successRate < REVIEW_THRESHOLD) {
    const template = queryOne<WorkflowTemplate>('SELECT status FROM workflow_templates WHERE id = ?', [templateId]);
    if (template && template.status === 'active') {
      run(
        'UPDATE workflow_templates SET status = ? WHERE id = ?',
        ['review', templateId]
      );
      console.log(`[WorkflowIntelligence] Template ${templateId} flagged for review (success rate: ${(successRate * 100).toFixed(0)}%)`);
    }
  }
}

/**
 * Record a counterexample for a failed run.
 */
function recordCounterexample(workflowRun: WorkflowRun): void {
  // Find the failing task
  const failedTask = queryOne<{ title: string; status: string }>(
    `SELECT title, status FROM tasks
     WHERE workflow_run_id = ? AND status NOT IN ('done', 'inbox')
     ORDER BY workflow_step_index ASC LIMIT 1`,
    [workflowRun.id]
  );

  const failureType = workflowRun.rejection_count > 0 ? 'rejected' : 'step_failed';

  run(
    `INSERT INTO workflow_counterexamples (id, template_id, run_id, failure_type, description, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [
      uuidv4(),
      workflowRun.template_id,
      workflowRun.id,
      failureType,
      `Run failed at step "${failedTask?.title || 'unknown'}". Outcome: ${workflowRun.outcome || 'unknown'}`,
    ]
  );
}

/**
 * Get health assessment for a template.
 */
export function getTemplateHealth(templateId: string): TemplateHealth | null {
  const template = queryOne<WorkflowTemplate>('SELECT * FROM workflow_templates WHERE id = ?', [templateId]);
  if (!template) return null;

  const recentRuns = queryAll<{ status: string; outcome: string | null; duration_seconds: number | null; approval_count: number }>(
    `SELECT status, outcome, duration_seconds, approval_count
     FROM workflow_runs
     WHERE template_id = ?
     ORDER BY started_at DESC
     LIMIT ?`,
    [templateId, ROLLING_WINDOW]
  );

  const terminalRuns = recentRuns.filter(r => r.status === 'completed' || r.status === 'failed');
  const successCount = terminalRuns.filter(r => r.outcome === 'success').length;
  const successRate = terminalRuns.length > 0 ? successCount / terminalRuns.length : null;

  const completedRuns = recentRuns.filter(r => r.duration_seconds != null);
  const avgDuration = completedRuns.length > 0
    ? Math.round(completedRuns.reduce((sum, r) => sum + (r.duration_seconds || 0), 0) / completedRuns.length)
    : null;

  // Approval rate
  const totalApprovals = recentRuns.reduce((sum, r) => sum + (r.approval_count || 0), 0);
  // Count review steps from template
  const steps = typeof template.steps === 'string' ? JSON.parse(template.steps as unknown as string) : template.steps;
  const reviewStepCount = (steps as Array<{ review?: boolean }>).filter(s => s.review).length;
  const totalReviewOps = terminalRuns.length * reviewStepCount;
  const approvalRate = totalReviewOps > 0 ? totalApprovals / totalReviewOps : null;

  const counterexampleCount = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM workflow_counterexamples WHERE template_id = ?',
    [templateId]
  )?.count || 0;

  // Determine health status
  let healthStatus: TemplateHealthStatus;
  if (template.status === 'retired') {
    healthStatus = 'retired';
  } else if (template.total_runs < MIN_RUNS_FOR_REVIEW) {
    healthStatus = 'new';
  } else if (successRate !== null && successRate >= HEALTHY_THRESHOLD) {
    healthStatus = 'healthy';
  } else if (successRate !== null && successRate >= WARNING_THRESHOLD) {
    healthStatus = 'warning';
  } else {
    healthStatus = 'review';
  }

  return {
    templateId,
    name: template.name,
    healthStatus,
    successRate,
    totalRuns: template.total_runs,
    recentRuns: recentRuns.length,
    avgDurationSeconds: avgDuration,
    approvalRate,
    lastUsedAt: template.last_used_at ?? null,
    retrievalCount: template.retrieval_count,
    counterexampleCount,
  };
}

/**
 * Get health for all templates in a workspace.
 */
export function getAllTemplateHealth(workspaceId: string = 'default'): TemplateHealth[] {
  const templates = queryAll<WorkflowTemplate>(
    'SELECT id FROM workflow_templates WHERE workspace_id = ? AND enabled = 1',
    [workspaceId]
  );

  return templates
    .map(t => getTemplateHealth(t.id))
    .filter((h): h is TemplateHealth => h !== null);
}

/**
 * Increment retrieval count — called when a template is selected by the router.
 */
export function recordRetrieval(templateId: string): void {
  run(
    'UPDATE workflow_templates SET retrieval_count = retrieval_count + 1 WHERE id = ?',
    [templateId]
  );
}
