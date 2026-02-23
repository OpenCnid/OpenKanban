'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { GitBranch, Plus } from 'lucide-react';
import { PipelineCard, type PipelineRunData } from './PipelineCard';
import { PipelineFilters, type PipelineFilter } from './PipelineFilters';
import { MissionPrompt } from './MissionPrompt';
import { RunCompletedModal } from './RunCompletedModal';
import { useMissionControl } from '@/lib/store';
import type { StepState, PipelineStep } from './PipelineStepChain';
import type { StepDetailData } from './PipelineStepDetail';
import type { Task, TaskStatus, WorkflowRun } from '@/lib/types';

interface PipelineViewProps {
  workspaceId: string;
}

interface ReviewToast {
  stepName: string;
  runId?: string;
}

// Map task status to step chain state
function taskStatusToStepState(status: TaskStatus): StepState {
  switch (status) {
    case 'done': return 'complete';
    case 'in_progress': return 'running';
    case 'testing': return 'running';
    case 'review': return 'review';
    case 'assigned': return 'waiting';
    case 'inbox': return 'pending';
    case 'planning': return 'pending';
    default: return 'pending';
  }
}

export function PipelineView({ workspaceId }: PipelineViewProps) {
  const [filter, setFilter] = useState<PipelineFilter>('all');
  const [showMissionPrompt, setShowMissionPrompt] = useState(false);
  const [completedRun, setCompletedRun] = useState<{ id: string; name: string } | null>(null);
  const [historyRuns, setHistoryRuns] = useState<WorkflowRun[]>([]);
  const [reviewToast, setReviewToast] = useState<ReviewToast | null>(null);
  const [highlightRunId, setHighlightRunId] = useState<string | null>(null);

  const { workflowRuns, workflowTemplates, tasks, setWorkflowRuns } = useMissionControl();

  // SSE-driven refresh — re-fetch runs + tasks when step/run events arrive
  useEffect(() => {
    const refreshData = async () => {
      try {
        const [runsRes, tasksRes] = await Promise.all([
          fetch(`/api/workflows/runs?workspace_id=${workspaceId}`),
          fetch(`/api/tasks?workspace_id=${workspaceId}`),
        ]);
        if (runsRes.ok) setWorkflowRuns(await runsRes.json());
        if (tasksRes.ok) useMissionControl.getState().setTasks(await tasksRes.json());
      } catch {
        // Silent
      }
    };

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const type = detail.type || '';

      if (type === 'approval_created') {
        const payload = detail.payload as Record<string, unknown> | undefined;
        const rawTitle = typeof payload?.title === 'string' ? payload.title : '';
        const stepName = rawTitle.replace(/^Review:\s*/i, '').trim() || 'Workflow step';
        setReviewToast({
          stepName,
          runId: typeof payload?.workflow_run_id === 'string' ? payload.workflow_run_id : undefined,
        });
      }

      // Refresh on workflow-related events
      if (type.includes('task') || type.includes('workflow') || type.includes('step') || type.includes('approval')) {
        refreshData();
      }
    };

    window.addEventListener('sse-event', handler);
    return () => window.removeEventListener('sse-event', handler);
  }, [workspaceId, setWorkflowRuns]);

  useEffect(() => {
    if (!reviewToast) return;
    const timeout = setTimeout(() => setReviewToast(null), 8000);
    return () => clearTimeout(timeout);
  }, [reviewToast]);

  // Fetch all runs (including dismissed) when history filter is active
  useEffect(() => {
    if (filter !== 'history') return;
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/workflows/runs?workspace_id=${workspaceId}&include=all`);
        if (res.ok) setHistoryRuns(await res.json());
      } catch { /* silent */ }
    };
    fetchHistory();
  }, [filter, workspaceId]);

  // Build PipelineRunData from workflow runs
  const sourceRuns = filter === 'history' ? historyRuns : workflowRuns;

  const pipelineRuns = useMemo((): PipelineRunData[] => {
    return sourceRuns.map((run) => {
      // Find tasks belonging to this run
      const runTasks = tasks
        .filter((t) => t.workflow_run_id === run.id)
        .sort((a, b) => (a.workflow_step_index ?? 0) - (b.workflow_step_index ?? 0));

      // Look up template to get agentId per step
      const template = workflowTemplates.find(wt => wt.id === run.template_id);
      const templateSteps = template?.steps || [];

      const steps: PipelineStep[] = runTasks.map((t, i) => ({
        name: t.title,
        state: run.status === 'failed' && t.status !== 'done'
          ? 'failed' as StepState
          : taskStatusToStepState(t.status),
        taskId: t.id,
        agentId: templateSteps[t.workflow_step_index ?? i]?.agentId,
        startedAt: t.started_at,
        completedAt: t.completed_at,
      }));

      // Build step details for expandable view
      const stepDetails: StepDetailData[] = runTasks.map((t, i) => ({
        taskId: t.id,
        name: t.title,
        state: run.status === 'failed' && t.status !== 'done'
          ? 'failed' as StepState
          : taskStatusToStepState(t.status),
        stepIndex: i,
        totalSteps: runTasks.length,
        description: t.description || undefined,
        startedAt: t.started_at,
        completedAt: t.completed_at,
        deliverables: [], // TODO: fetch from task_deliverables
        inputArtifacts: [], // TODO: fetch from task_deliverables where is_input=1
        runId: run.id,
      }));

      // Map workflow run status to pipeline card status
      let cardStatus: PipelineRunData['status'] = 'running';
      switch (run.status) {
        case 'completed': cardStatus = 'completed'; break;
        case 'failed': cardStatus = 'failed'; break;
        case 'paused': cardStatus = 'paused'; break;
        case 'pending': cardStatus = 'pending'; break;
        case 'cancelled': cardStatus = 'cancelled'; break;
        default: cardStatus = 'running';
      }

      // Parse trigger_input if it's JSON
      let triggerInput = '';
      if (run.trigger_input) {
        try {
          const parsed = JSON.parse(run.trigger_input);
          triggerInput = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
        } catch {
          triggerInput = run.trigger_input;
        }
      }

      // Get template icon from the joined data or default
      const icon = (run as unknown as Record<string, unknown>).template_icon as string || '⚡';

      return {
        id: run.id,
        name: run.name,
        icon,
        status: cardStatus,
        triggerInput: triggerInput || undefined,
        steps,
        stepDetails,
        startedAt: run.started_at,
        completedAt: run.completed_at,
      };
    });
  }, [sourceRuns, tasks, workflowTemplates]);

  const filteredRuns = useMemo(() => {
    if (filter === 'all') return pipelineRuns;
    if (filter === 'history') return pipelineRuns; // History shows all runs unfiltered
    return pipelineRuns.filter((r) => {
      if (filter === 'running') return r.status === 'running' || r.status === 'paused';
      return r.status === filter;
    });
  }, [pipelineRuns, filter]);

  // Counts based on the active (non-dismissed) runs only
  const activeRuns = useMemo((): PipelineRunData[] => {
    // When we're in history mode, pipelineRuns has ALL runs — count active from store
    const runs = filter === 'history'
      ? pipelineRuns.filter(r => !workflowRuns.find(wr => wr.id === r.id)?.dismissed)
      : pipelineRuns;
    return runs;
  }, [filter, pipelineRuns, workflowRuns]);

  const counts = useMemo(() => ({
    all: activeRuns.length,
    running: activeRuns.filter((r) => r.status === 'running' || r.status === 'paused').length,
    completed: activeRuns.filter((r) => r.status === 'completed').length,
    failed: activeRuns.filter((r) => r.status === 'failed' || r.status === 'cancelled').length,
    history: historyRuns.length,
  }), [activeRuns, historyRuns]);

  const handleLaunchMission = useCallback(async (input: string, options?: { templateId?: string }) => {
    try {
      if (options?.templateId) {
        // Direct template trigger
        const res = await fetch(`/api/workflows/${options.templateId}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trigger_input: input }),
        });
        if (!res.ok) {
          console.error('Failed to trigger run:', await res.text());
          return;
        }
        // Start step execution (separate request so it doesn't get killed)
        const data = await res.clone().json();
        if (data.id) {
          fetch(`/api/workflows/runs/${data.id}/execute`, { method: 'POST' }).catch(() => {});
        }
      } else {
        // Freeform trigger — route through semantic router
        const res = await fetch('/api/workflows/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input,
            source: 'dashboard',
            auto_execute: true,
          }),
        });
        if (!res.ok) {
          console.error('Failed to trigger:', await res.text());
          return;
        }
        const triggerData = await res.json();
        if (triggerData.run_id) {
          fetch(`/api/workflows/runs/${triggerData.run_id}/execute`, { method: 'POST' }).catch(() => {});
        }
      }

      // Re-fetch runs + tasks
      const [runsRes, tasksRes] = await Promise.all([
        fetch(`/api/workflows/runs?workspace_id=${workspaceId}`),
        fetch(`/api/tasks?workspace_id=${workspaceId}`),
      ]);

      if (runsRes.ok) setWorkflowRuns(await runsRes.json());
      if (tasksRes.ok) useMissionControl.getState().setTasks(await tasksRes.json());

      // Switch to 'all' or 'running' filter so user sees the new run
      setFilter('all');
    } catch (error) {
      console.error('Failed to launch mission:', error);
    }
  }, [workspaceId, setWorkflowRuns]);

  const handleApproveStep = useCallback(async (runId: string, taskId: string) => {
    try {
      const res = await fetch(`/api/workflows/runs/${runId}/steps/${taskId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        console.error('Failed to approve step:', await res.text());
        return;
      }

      // Re-fetch to get updated state
      const [runsRes, tasksRes] = await Promise.all([
        fetch(`/api/workflows/runs?workspace_id=${workspaceId}`),
        fetch(`/api/tasks?workspace_id=${workspaceId}`),
      ]);

      if (runsRes.ok) setWorkflowRuns(await runsRes.json());
      if (tasksRes.ok) useMissionControl.getState().setTasks(await tasksRes.json());
    } catch (error) {
      console.error('Failed to approve step:', error);
    }
  }, [workspaceId, setWorkflowRuns]);

  const handleRejectStep = useCallback(async (runId: string, taskId: string) => {
    try {
      const res = await fetch(`/api/workflows/runs/${runId}/steps/${taskId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        console.error('Failed to reject step:', await res.text());
        return;
      }

      const [runsRes, tasksRes] = await Promise.all([
        fetch(`/api/workflows/runs?workspace_id=${workspaceId}`),
        fetch(`/api/tasks?workspace_id=${workspaceId}`),
      ]);

      if (runsRes.ok) setWorkflowRuns(await runsRes.json());
      if (tasksRes.ok) useMissionControl.getState().setTasks(await tasksRes.json());
    } catch (error) {
      console.error('Failed to reject step:', error);
    }
  }, [workspaceId, setWorkflowRuns]);

  const handleCancelRun = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/workflows/runs/${runId}/cancel`, {
        method: 'POST',
      });

      if (!res.ok) {
        console.error('Failed to cancel run:', await res.text());
        return;
      }

      const [runsRes, tasksRes] = await Promise.all([
        fetch(`/api/workflows/runs?workspace_id=${workspaceId}`),
        fetch(`/api/tasks?workspace_id=${workspaceId}`),
      ]);

      if (runsRes.ok) setWorkflowRuns(await runsRes.json());
      if (tasksRes.ok) useMissionControl.getState().setTasks(await tasksRes.json());
    } catch (error) {
      console.error('Failed to cancel run:', error);
    }
  }, [workspaceId, setWorkflowRuns]);

  const handleDismissRun = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/workflows/runs/${runId}`, { method: 'DELETE' });
      if (!res.ok) {
        console.error('Failed to dismiss run:', await res.text());
        return;
      }
      // Re-fetch active runs (dismissed ones are now hidden)
      const runsRes = await fetch(`/api/workflows/runs?workspace_id=${workspaceId}`);
      if (runsRes.ok) setWorkflowRuns(await runsRes.json());
    } catch (error) {
      console.error('Failed to dismiss run:', error);
    }
  }, [workspaceId, setWorkflowRuns]);

  const handleReviewToastClick = useCallback(() => {
    if (!reviewToast?.runId) {
      setReviewToast(null);
      return;
    }

    const targetRunId = reviewToast.runId;
    setReviewToast(null);
    setFilter('all');
    setHighlightRunId(targetRunId);

    setTimeout(() => {
      const target = document.getElementById(`pipeline-run-${targetRunId}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);

    setTimeout(() => {
      setHighlightRunId((current) => (current === targetRunId ? null : current));
    }, 2600);
  }, [reviewToast]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-mc-border flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-mc-text-secondary" />
            <span className="text-sm font-medium uppercase tracking-wider">Pipelines</span>
          </div>
          <PipelineFilters
            activeFilter={filter}
            onFilterChange={setFilter}
            counts={counts}
          />
        </div>
        <button
          onClick={() => setShowMissionPrompt(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-mc-accent text-mc-bg rounded text-sm font-medium hover:bg-mc-accent/90"
        >
          <Plus className="w-4 h-4" />
          New Mission
        </button>
      </div>

      {reviewToast && (
        <div className="px-4 pt-3">
          <button
            onClick={handleReviewToastClick}
            className="w-full text-left rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300 hover:bg-amber-500/15"
          >
            🔔 Review needed: {reviewToast.stepName}
          </button>
        </div>
      )}

      {/* Pipeline list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredRuns.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-mc-text-secondary">
              <GitBranch className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium mb-1">
                {filter === 'history' ? 'No pipeline history yet.' : filter !== 'all' ? `No ${filter} pipelines.` : 'No active missions.'}
              </p>
              <p className="text-sm">Click <span className="text-mc-accent">+ New Mission</span> to tell the agent what you need.</p>
            </div>
          </div>
        ) : (
          filteredRuns.map((run) => (
            <div
              key={run.id}
              id={`pipeline-run-${run.id}`}
              className={`rounded-lg transition-shadow ${
                highlightRunId === run.id ? 'ring-2 ring-amber-400/70 ring-offset-2 ring-offset-mc-bg' : ''
              }`}
            >
              <PipelineCard
                run={run}
                onApproveStep={handleApproveStep}
                onRejectStep={handleRejectStep}
                onCancelRun={handleCancelRun}
                onDismissRun={handleDismissRun}
                onViewResults={(id, name) => setCompletedRun({ id, name })}
              />
            </div>
          ))
        )}
      </div>

      {/* Mission Prompt Modal */}
      {showMissionPrompt && (
        <MissionPrompt
          onClose={() => setShowMissionPrompt(false)}
          onSubmit={handleLaunchMission}
          templates={workflowTemplates.filter(t => t.enabled).map(t => ({
            id: t.id,
            name: t.name,
            icon: t.icon || '⚡',
            description: t.description,
          }))}
        />
      )}

      {/* Run Completed Modal — shows full synthesis when pipeline finishes */}
      {completedRun && (
        <RunCompletedModal
          runId={completedRun.id}
          runName={completedRun.name}
          onClose={() => setCompletedRun(null)}
        />
      )}
    </div>
  );
}
