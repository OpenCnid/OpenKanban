'use client';

import { useState, useMemo, useCallback } from 'react';
import { GitBranch, Plus } from 'lucide-react';
import { PipelineCard, type PipelineRunData } from './PipelineCard';
import { PipelineFilters, type PipelineFilter } from './PipelineFilters';
import { WorkflowTemplatePicker } from './WorkflowTemplatePicker';
import { useMissionControl } from '@/lib/store';
import type { StepState, PipelineStep } from './PipelineStepChain';
import type { StepDetailData } from './PipelineStepDetail';
import type { Task, TaskStatus, WorkflowRun } from '@/lib/types';

interface PipelineViewProps {
  workspaceId: string;
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
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  const { workflowRuns, tasks, setWorkflowRuns } = useMissionControl();

  // Build PipelineRunData from real workflow runs + their tasks
  const pipelineRuns = useMemo((): PipelineRunData[] => {
    return workflowRuns.map((run) => {
      // Find tasks belonging to this run
      const runTasks = tasks
        .filter((t) => t.workflow_run_id === run.id)
        .sort((a, b) => (a.workflow_step_index ?? 0) - (b.workflow_step_index ?? 0));

      const steps: PipelineStep[] = runTasks.map((t) => ({
        name: t.title,
        state: run.status === 'failed' && t.status !== 'done'
          ? 'failed' as StepState
          : taskStatusToStepState(t.status),
        taskId: t.id,
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
  }, [workflowRuns, tasks]);

  const filteredRuns = useMemo(() => {
    if (filter === 'all') return pipelineRuns;
    return pipelineRuns.filter((r) => {
      if (filter === 'running') return r.status === 'running' || r.status === 'paused';
      return r.status === filter;
    });
  }, [pipelineRuns, filter]);

  const counts = useMemo(() => ({
    all: pipelineRuns.length,
    running: pipelineRuns.filter((r) => r.status === 'running' || r.status === 'paused').length,
    completed: pipelineRuns.filter((r) => r.status === 'completed').length,
    failed: pipelineRuns.filter((r) => r.status === 'failed' || r.status === 'cancelled').length,
  }), [pipelineRuns]);

  const handleTriggerRun = useCallback(async (templateId: string, triggerInput: string) => {
    try {
      const res = await fetch(`/api/workflows/${templateId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger_input: triggerInput }),
      });

      if (!res.ok) {
        console.error('Failed to trigger run:', await res.text());
        return;
      }

      // Re-fetch runs + tasks to get fresh data
      const [runsRes, tasksRes] = await Promise.all([
        fetch(`/api/workflows/runs?workspace_id=${workspaceId}`),
        fetch(`/api/tasks?workspace_id=${workspaceId}`),
      ]);

      if (runsRes.ok) {
        const runs = await runsRes.json();
        setWorkflowRuns(runs);
      }

      if (tasksRes.ok) {
        const tasksData = await tasksRes.json();
        useMissionControl.getState().setTasks(tasksData);
      }
    } catch (error) {
      console.error('Failed to trigger workflow run:', error);
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
          onClick={() => setShowTemplatePicker(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-mc-accent text-mc-bg rounded text-sm font-medium hover:bg-mc-accent/90"
        >
          <Plus className="w-4 h-4" />
          New Workflow
        </button>
      </div>

      {/* Pipeline list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredRuns.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-mc-text-secondary">
              <GitBranch className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium mb-1">
                {filter !== 'all' ? `No ${filter} pipelines.` : 'No active pipelines.'}
              </p>
              <p className="text-sm">Click + New Workflow to get started.</p>
            </div>
          </div>
        ) : (
          filteredRuns.map((run) => (
            <PipelineCard
              key={run.id}
              run={run}
              onApproveStep={handleApproveStep}
              onRejectStep={handleRejectStep}
              onCancelRun={handleCancelRun}
            />
          ))
        )}
      </div>

      {/* Template Picker Modal */}
      {showTemplatePicker && (
        <WorkflowTemplatePicker
          onClose={() => setShowTemplatePicker(false)}
          onTrigger={(templateId, triggerInput) => {
            handleTriggerRun(templateId, triggerInput);
            setShowTemplatePicker(false);
          }}
        />
      )}
    </div>
  );
}
