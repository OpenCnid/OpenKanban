'use client';

import { formatDistanceToNow } from 'date-fns';
import { PipelineStepChain, type PipelineStep } from './PipelineStepChain';

export type PipelineRunStatus = 'running' | 'completed' | 'failed' | 'paused' | 'pending';

export interface PipelineRunData {
  id: string;
  name: string;
  icon: string;
  status: PipelineRunStatus;
  triggerInput?: string;
  steps: PipelineStep[];
  startedAt: string;
  completedAt?: string;
}

interface PipelineCardProps {
  run: PipelineRunData;
}

const statusConfig: Record<PipelineRunStatus, { label: string; color: string; dot: string }> = {
  running: { label: 'Running', color: 'text-teal-400', dot: 'bg-teal-400 animate-pulse' },
  completed: { label: 'Completed', color: 'text-green-400', dot: 'bg-green-400' },
  failed: { label: 'Failed', color: 'text-red-400', dot: 'bg-red-400' },
  paused: { label: 'Paused', color: 'text-amber-400', dot: 'bg-amber-400' },
  pending: { label: 'Pending', color: 'text-mc-text-secondary', dot: 'bg-mc-text-secondary' },
};

export function PipelineCard({ run }: PipelineCardProps) {
  const config = statusConfig[run.status];
  const completedSteps = run.steps.filter((s) => s.state === 'complete').length;

  return (
    <div className="bg-mc-bg-secondary border border-mc-border/50 rounded-lg p-4 hover:border-mc-accent/30 transition-colors">
      {/* Top row: icon + name + status */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{run.icon}</span>
          <h3 className="font-medium text-sm">{run.name}</h3>
        </div>
        <div className={`flex items-center gap-1.5 text-xs ${config.color}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
          {config.label}
          <span className="text-mc-text-secondary ml-1">
            {completedSteps}/{run.steps.length}
          </span>
        </div>
      </div>

      {/* Trigger input / description */}
      {run.triggerInput && (
        <p className="text-xs text-mc-text-secondary mb-3 truncate">
          &ldquo;{run.triggerInput}&rdquo;
        </p>
      )}

      {/* Step chain */}
      <div className="mb-3">
        <PipelineStepChain steps={run.steps} />
      </div>

      {/* Footer: timing */}
      <div className="flex items-center justify-between text-[10px] text-mc-text-secondary/60">
        <span>
          Started {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
        </span>
        {run.completedAt && (
          <span>
            Completed {formatDistanceToNow(new Date(run.completedAt), { addSuffix: true })}
          </span>
        )}
      </div>
    </div>
  );
}
