'use client';

export type StepState = 'complete' | 'running' | 'waiting' | 'pending' | 'review' | 'failed';

export interface PipelineStep {
  name: string;
  state: StepState;
}

interface PipelineStepChainProps {
  steps: PipelineStep[];
}

const stateConfig: Record<StepState, { icon: string; bg: string; text: string; pulse?: boolean }> = {
  complete: { icon: '✅', bg: 'bg-green-500/20 border-green-500/40', text: 'text-green-400' },
  running: { icon: '🔄', bg: 'bg-teal-500/20 border-teal-500/40', text: 'text-teal-400', pulse: true },
  waiting: { icon: '⏳', bg: 'bg-mc-bg-tertiary border-mc-border/40', text: 'text-mc-text-secondary' },
  pending: { icon: '○', bg: 'bg-transparent border-mc-border/30', text: 'text-mc-text-secondary/50' },
  review: { icon: '🔍', bg: 'bg-amber-500/20 border-amber-500/40', text: 'text-amber-400' },
  failed: { icon: '❌', bg: 'bg-red-500/20 border-red-500/40', text: 'text-red-400' },
};

export function PipelineStepChain({ steps }: PipelineStepChainProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {steps.map((step, i) => {
        const config = stateConfig[step.state];
        return (
          <div key={i} className="flex items-center gap-1 flex-shrink-0">
            {i > 0 && (
              <div className={`w-4 h-px ${
                step.state === 'complete' || step.state === 'running'
                  ? 'bg-mc-accent/40'
                  : 'bg-mc-border/30'
              }`} />
            )}
            <div
              className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs ${config.bg} ${config.text} ${
                config.pulse ? 'animate-pulse' : ''
              }`}
              title={`${step.name} — ${step.state}`}
            >
              <span className="text-xs">{config.icon}</span>
              <span className="truncate max-w-[100px]">{step.name}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
