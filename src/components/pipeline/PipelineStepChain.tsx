'use client';

import { useEffect, useMemo, useState } from 'react';

export type StepState = 'complete' | 'running' | 'waiting' | 'pending' | 'review' | 'failed';

export interface PipelineStep {
  name: string;
  state: StepState;
  taskId?: string;
  agentId?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

interface PipelineStepChainProps {
  steps: PipelineStep[];
  selectedStepIndex?: number | null;
  onStepClick?: (index: number) => void;
  onApproveReviewStep?: (taskId: string) => void;
  onRejectReviewStep?: (taskId: string) => void;
}

const agentEmoji: Record<string, string> = {
  'market-data': '📊',
  'analyst': '🧠',
  'recorder': '📝',
};

const stateConfig: Record<StepState, { icon: string; bg: string; text: string; pulse?: boolean }> = {
  complete: { icon: '✅', bg: 'bg-green-500/20 border-green-500/40', text: 'text-green-400' },
  running: { icon: '🔄', bg: 'bg-teal-500/20 border-teal-500/40', text: 'text-teal-400', pulse: true },
  waiting: { icon: '⏳', bg: 'bg-mc-bg-tertiary border-mc-border/40', text: 'text-mc-text-secondary' },
  pending: { icon: '○', bg: 'bg-transparent border-mc-border/30', text: 'text-mc-text-secondary/50' },
  review: { icon: '🔍', bg: 'bg-amber-500/20 border-amber-500/40', text: 'text-amber-400' },
  failed: { icon: '❌', bg: 'bg-red-500/20 border-red-500/40', text: 'text-red-400' },
};

function formatDuration(startedAt?: string, completedAt?: string, nowMs: number = Date.now()): string | null {
  if (!startedAt) return null;

  const startMs = new Date(startedAt).getTime();
  if (Number.isNaN(startMs)) return null;

  const endMs = completedAt ? new Date(completedAt).getTime() : nowMs;
  if (Number.isNaN(endMs)) return null;

  const diffSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const hours = Math.floor(diffSeconds / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function PipelineStepChain({
  steps,
  selectedStepIndex,
  onStepClick,
  onApproveReviewStep,
  onRejectReviewStep,
}: PipelineStepChainProps) {
  const hasRunningStep = useMemo(
    () => steps.some((s) => s.state === 'running' && !!s.startedAt),
    [steps]
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!hasRunningStep) return;

    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [hasRunningStep]);

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {steps.map((step, i) => {
        const config = stateConfig[step.state];
        const isSelected = selectedStepIndex === i;
        const isClickable = !!onStepClick;
        const reviewTaskId = step.taskId;
        const duration = step.state === 'complete'
          ? formatDuration(step.startedAt, step.completedAt)
          : step.state === 'running'
            ? formatDuration(step.startedAt, undefined, nowMs)
            : null;

        return (
          <div key={i} className="relative flex items-center gap-1 flex-shrink-0">
            {i > 0 && (
              <div className={`w-4 h-px ${
                step.state === 'complete' || step.state === 'running'
                  ? 'bg-mc-accent/40'
                  : 'bg-mc-border/30'
              }`} />
            )}
            <button
              type="button"
              onClick={() => onStepClick?.(i)}
              disabled={!isClickable}
              className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs ${config.bg} ${config.text} ${
                config.pulse ? 'animate-pulse' : ''
              } ${isSelected ? 'ring-1 ring-mc-accent ring-offset-1 ring-offset-mc-bg-secondary' : ''} ${
                isClickable ? 'cursor-pointer hover:brightness-110' : ''
              }`}
              title={`${step.name} — ${step.state}`}
            >
              <span className="text-xs">{config.icon}</span>
              {step.agentId && <span className="text-xs opacity-70" title={step.agentId}>{agentEmoji[step.agentId] || '🤖'}</span>}
              <span className="truncate max-w-[100px]">{step.name}</span>
              {duration && (
                <span className="font-mono text-[10px] opacity-80">
                  {duration}
                </span>
              )}
            </button>
            {step.state === 'failed' && step.errorMessage && (
              <div className="absolute top-full left-0 mt-1 z-10 max-w-[220px] px-2 py-1 rounded bg-red-500/10 border border-red-500/30 text-[10px] text-red-400 leading-tight whitespace-normal">
                {step.errorMessage.length > 120 ? step.errorMessage.slice(0, 120) + '…' : step.errorMessage}
              </div>
            )}
            {step.state === 'review' && reviewTaskId && (
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => onApproveReviewStep?.(reviewTaskId)}
                  disabled={!onApproveReviewStep}
                  className="w-5 h-5 flex items-center justify-center rounded border border-green-500/50 bg-green-500/10 text-green-400 text-[10px] hover:bg-green-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={`Approve ${step.name}`}
                >
                  ✓
                </button>
                <button
                  type="button"
                  onClick={() => onRejectReviewStep?.(reviewTaskId)}
                  disabled={!onRejectReviewStep}
                  className="w-5 h-5 flex items-center justify-center rounded border border-red-500/50 bg-red-500/10 text-red-400 text-[10px] hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={`Reject ${step.name}`}
                >
                  ✗
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
