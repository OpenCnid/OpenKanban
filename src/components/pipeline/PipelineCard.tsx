'use client';

import { useState, useCallback, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { XCircle } from 'lucide-react';
import { PipelineStepChain, type PipelineStep } from './PipelineStepChain';
import { PipelineStepDetail, type StepDetailData } from './PipelineStepDetail';

export type PipelineRunStatus = 'running' | 'completed' | 'failed' | 'paused' | 'pending' | 'cancelled';

export interface PipelineRunData {
  id: string;
  name: string;
  icon: string;
  status: PipelineRunStatus;
  triggerInput?: string;
  steps: PipelineStep[];
  startedAt: string;
  completedAt?: string;
  // Extended data for step detail
  stepDetails?: StepDetailData[];
}

interface PipelineCardProps {
  run: PipelineRunData;
  onApproveStep?: (runId: string, taskId: string) => void;
  onRejectStep?: (runId: string, taskId: string) => void;
  onCancelRun?: (runId: string) => void;
}

const statusConfig: Record<PipelineRunStatus, { label: string; color: string; dot: string }> = {
  running: { label: 'Running', color: 'text-teal-400', dot: 'bg-teal-400 animate-pulse' },
  completed: { label: 'Completed', color: 'text-green-400', dot: 'bg-green-400' },
  failed: { label: 'Failed', color: 'text-red-400', dot: 'bg-red-400' },
  paused: { label: 'Review', color: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' },
  pending: { label: 'Pending', color: 'text-mc-text-secondary', dot: 'bg-mc-text-secondary' },
  cancelled: { label: 'Cancelled', color: 'text-mc-text-secondary/50', dot: 'bg-mc-text-secondary/50' },
};

export function PipelineCard({ run, onApproveStep, onRejectStep, onCancelRun }: PipelineCardProps) {
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const config = statusConfig[run.status] || statusConfig.pending;
  const completedSteps = run.steps.filter((s) => s.state === 'complete').length;

  const handleStepClick = useCallback((index: number) => {
    setSelectedStep(prev => prev === index ? null : index);
  }, []);

  const handleApprove = useCallback((taskId: string) => {
    onApproveStep?.(run.id, taskId);
    setSelectedStep(null);
  }, [run.id, onApproveStep]);

  const handleReject = useCallback((taskId: string) => {
    onRejectStep?.(run.id, taskId);
    setSelectedStep(null);
  }, [run.id, onRejectStep]);

  const handleCancel = useCallback(() => {
    onCancelRun?.(run.id);
  }, [run.id, onCancelRun]);

  // Running duration timer
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    if (run.status !== 'running' && run.status !== 'paused') {
      setElapsed('');
      return;
    }
    const startTime = new Date(run.startedAt).getTime();
    const update = () => {
      const diff = Math.floor((Date.now() - startTime) / 1000);
      const mins = Math.floor(diff / 60);
      const secs = diff % 60;
      setElapsed(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [run.status, run.startedAt]);

  const selectedStepDetail = selectedStep !== null ? run.stepDetails?.[selectedStep] : null;

  return (
    <div className={`bg-mc-bg-secondary border rounded-lg p-4 transition-colors ${
      run.status === 'paused'
        ? 'border-amber-500/40 hover:border-amber-500/60'
        : 'border-mc-border/50 hover:border-mc-accent/30'
    }`}>
      {/* Top row: icon + name + status + actions */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{run.icon}</span>
          <h3 className="font-medium text-sm">{run.name}</h3>
        </div>
        <div className="flex items-center gap-2">
          {(run.status === 'running' || run.status === 'paused') && onCancelRun && (
            <button
              onClick={handleCancel}
              className="p-1 hover:bg-red-500/10 rounded text-mc-text-secondary/40 hover:text-red-400 transition-colors"
              title="Cancel pipeline"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
          )}
          <div className={`flex items-center gap-1.5 text-xs ${config.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
            {config.label}
            <span className="text-mc-text-secondary ml-1">
              {completedSteps}/{run.steps.length}
            </span>
          </div>
        </div>
      </div>

      {/* Trigger input / description */}
      {run.triggerInput && (
        <p className="text-xs text-mc-text-secondary mb-3 truncate">
          &ldquo;{run.triggerInput}&rdquo;
        </p>
      )}

      {/* Step chain — clickable */}
      <div className="mb-3">
        <PipelineStepChain
          steps={run.steps}
          selectedStepIndex={selectedStep}
          onStepClick={handleStepClick}
        />
      </div>

      {/* Expanded step detail */}
      {selectedStepDetail && (
        <PipelineStepDetail
          step={selectedStepDetail}
          onClose={() => setSelectedStep(null)}
          onApprove={onApproveStep ? handleApprove : undefined}
          onReject={onRejectStep ? handleReject : undefined}
          onCancel={undefined}
        />
      )}

      {/* Footer: timing */}
      <div className="flex items-center justify-between text-[10px] text-mc-text-secondary/60">
        <span>
          Started {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
        </span>
        {elapsed && (
          <span className="font-mono text-mc-text-secondary/80">
            ⏱ {elapsed}
          </span>
        )}
        {run.completedAt && (
          <span>
            Completed {formatDistanceToNow(new Date(run.completedAt), { addSuffix: true })}
          </span>
        )}
      </div>
    </div>
  );
}
