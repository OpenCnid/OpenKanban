'use client';

import { GitBranch, Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import type { WorkflowRun } from '@/lib/types';
import { useMissionControl } from '@/lib/store';

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

interface ActivePipelinesWidgetProps {
  onNavigate?: () => void;
}

export function ActivePipelinesWidget({ onNavigate }: ActivePipelinesWidgetProps) {
  const { workflowRuns, tasks } = useMissionControl();

  // Show active runs (running + paused) and recent completed (last 3)
  const activeRuns = workflowRuns.filter(r => r.status === 'running' || r.status === 'paused');
  const recentCompleted = workflowRuns
    .filter(r => r.status === 'completed' || r.status === 'failed')
    .slice(0, 3);
  const displayRuns = [...activeRuns, ...recentCompleted].slice(0, 6);

  if (displayRuns.length === 0) {
    return (
      <div className="bg-mc-bg-secondary border border-mc-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-mc-accent" />
            Active Pipelines
          </h3>
        </div>
        <div className="text-center py-6 text-mc-text-secondary">
          <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No pipelines running. Trigger one from the Pipelines tab.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-mc-accent" />
          Active Pipelines
        </h3>
        {onNavigate && (
          <button
            onClick={onNavigate}
            className="text-xs text-mc-accent hover:text-mc-accent/80"
          >
            View all →
          </button>
        )}
      </div>
      <div className="space-y-3">
        {displayRuns.map((run) => (
          <CompactPipelineRow key={run.id} run={run} tasks={tasks} />
        ))}
      </div>
    </div>
  );
}

function CompactPipelineRow({ run, tasks: allTasks }: { run: WorkflowRun; tasks: import('@/lib/types').Task[] }) {
  const runTasks = allTasks
    .filter(t => t.workflow_run_id === run.id)
    .sort((a, b) => (a.workflow_step_index ?? 0) - (b.workflow_step_index ?? 0));

  const statusIcon = {
    running: <Clock className="w-3.5 h-3.5 text-blue-400 animate-pulse" />,
    paused: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />,
    completed: <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />,
    failed: <AlertTriangle className="w-3.5 h-3.5 text-red-400" />,
    cancelled: <AlertTriangle className="w-3.5 h-3.5 text-mc-text-secondary" />,
    pending: <Clock className="w-3.5 h-3.5 text-mc-text-secondary" />,
  }[run.status] || <Clock className="w-3.5 h-3.5 text-mc-text-secondary" />;

  const doneCount = runTasks.filter(t => t.status === 'done').length;
  const totalCount = runTasks.length;

  return (
    <div className="flex items-center gap-3 p-2 rounded-md hover:bg-mc-bg/50 transition-colors">
      {statusIcon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{run.name}</span>
          {totalCount > 0 && (
            <span className="text-[10px] text-mc-text-secondary">
              {doneCount}/{totalCount}
            </span>
          )}
        </div>
        {/* Mini step chain */}
        <div className="flex items-center gap-0.5 mt-1">
          {runTasks.map((task) => {
            const colorMap: Record<string, string> = {
              done: 'bg-emerald-500',
              in_progress: 'bg-blue-500 animate-pulse',
              review: 'bg-amber-500',
              testing: 'bg-blue-400',
            };
            const color = colorMap[task.status] || 'bg-mc-text-secondary/30';
            return (
              <div
                key={task.id}
                className={`h-1.5 flex-1 rounded-full ${color}`}
                title={`${task.title}: ${task.status}`}
              />
            );
          })}
        </div>
      </div>
      <span className="text-[10px] text-mc-text-secondary whitespace-nowrap">
        {timeAgo(run.started_at)}
      </span>
    </div>
  );
}
