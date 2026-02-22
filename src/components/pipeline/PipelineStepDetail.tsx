'use client';

import { useState, useEffect } from 'react';
import { X, Check, XCircle, Square, Clock, Wrench, User, FileText, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import type { StepState } from './PipelineStepChain';

export interface StepDetailData {
  taskId: string;
  name: string;
  state: StepState;
  stepIndex: number;
  totalSteps: number;
  agentRole?: string;
  tools?: string[];
  description?: string;
  startedAt?: string;
  completedAt?: string;
  deliverables: Array<{ title: string; path?: string; content?: string }>;
  inputArtifacts: Array<{ title: string; content?: string; sourceStep?: string }>;
  sessionKey?: string;
  runId: string;
}

interface PipelineStepDetailProps {
  step: StepDetailData;
  onClose: () => void;
  onApprove?: (taskId: string) => void;
  onReject?: (taskId: string) => void;
  onCancel?: (taskId: string) => void;
}

const stateLabels: Record<StepState, { label: string; color: string; bg: string }> = {
  complete: { label: 'Complete', color: 'text-green-400', bg: 'bg-green-500/10' },
  running: { label: 'Running', color: 'text-teal-400', bg: 'bg-teal-500/10' },
  waiting: { label: 'Waiting', color: 'text-mc-text-secondary', bg: 'bg-mc-bg-tertiary' },
  pending: { label: 'Pending', color: 'text-mc-text-secondary/50', bg: 'bg-mc-bg' },
  review: { label: 'Needs Review', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  failed: { label: 'Failed', color: 'text-red-400', bg: 'bg-red-500/10' },
};

export function PipelineStepDetail({ step, onClose, onApprove, onReject, onCancel }: PipelineStepDetailProps) {
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [deliverables, setDeliverables] = useState(step.deliverables);
  const [loadingDeliverables, setLoadingDeliverables] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const stateConfig = stateLabels[step.state];

  // Lazy-load deliverables when step detail is opened
  useEffect(() => {
    if (step.deliverables.length > 0) {
      setDeliverables(step.deliverables);
      return;
    }

    // Fetch deliverables from the task
    let cancelled = false;
    const fetchDeliverables = async () => {
      setLoadingDeliverables(true);
      try {
        const res = await fetch(`/api/tasks/${step.taskId}/deliverables`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            setDeliverables(data.map((d: Record<string, unknown>) => ({
              title: (d.title as string) || (d.name as string) || 'Output',
              path: d.path as string | undefined,
              content: (d.description as string) || (d.content as string) || undefined,
            })));
          }
        }
      } catch {
        // Silent — deliverables are optional
      } finally {
        if (!cancelled) setLoadingDeliverables(false);
      }
    };

    fetchDeliverables();
    return () => { cancelled = true; };
  }, [step.taskId, step.deliverables]);

  const handleApprove = async () => {
    if (!onApprove) return;
    setIsApproving(true);
    onApprove(step.taskId);
  };

  const handleReject = async () => {
    if (!onReject) return;
    setIsRejecting(true);
    onReject(step.taskId);
  };

  const handleCancel = async () => {
    if (!onCancel) return;
    setIsCancelling(true);
    onCancel(step.taskId);
  };

  return (
    <div className="border-t border-mc-border/50 mt-3 pt-3 animate-in slide-in-from-top-2 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded ${stateConfig.bg} ${stateConfig.color}`}>
            {stateConfig.label}
          </span>
          <h4 className="text-sm font-medium">{step.name}</h4>
          <span className="text-[10px] text-mc-text-secondary/50">
            Step {step.stepIndex + 1} of {step.totalSteps}
          </span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
        {step.agentRole && (
          <div className="flex items-center gap-1.5 text-mc-text-secondary">
            <User className="w-3 h-3" />
            <span>Role: <span className="text-mc-text">{step.agentRole}</span></span>
          </div>
        )}
        {step.tools && step.tools.length > 0 && (
          <div className="flex items-center gap-1.5 text-mc-text-secondary">
            <Wrench className="w-3 h-3" />
            <span>{step.tools.join(', ')}</span>
          </div>
        )}
        {step.startedAt && (
          <div className="flex items-center gap-1.5 text-mc-text-secondary">
            <Clock className="w-3 h-3" />
            <span>Started: {new Date(step.startedAt).toLocaleTimeString()}</span>
          </div>
        )}
        {step.completedAt && (
          <div className="flex items-center gap-1.5 text-mc-text-secondary">
            <Clock className="w-3 h-3" />
            <span>Completed: {new Date(step.completedAt).toLocaleTimeString()}</span>
          </div>
        )}
      </div>

      {/* Step description / task details */}
      {step.description && (
        <div className="mb-3">
          <button
            onClick={() => setShowDescription(!showDescription)}
            className="flex items-center gap-1 text-[10px] uppercase text-mc-text-secondary/50 font-medium hover:text-mc-text-secondary"
          >
            {showDescription ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Task Details
          </button>
          {showDescription && (
            <div className="mt-1.5 p-2.5 bg-mc-bg/50 rounded border border-mc-border/20 text-xs text-mc-text-secondary leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">
              {step.description}
            </div>
          )}
        </div>
      )}

      {/* Input artifacts (from previous steps) */}
      {step.inputArtifacts.length > 0 && (
        <div className="mb-3">
          <h5 className="text-[10px] uppercase text-mc-text-secondary/50 mb-1 font-medium">Input</h5>
          <div className="space-y-1">
            {step.inputArtifacts.map((artifact, i) => (
              <div key={i} className="flex items-start gap-2 text-xs bg-mc-bg/50 rounded px-2 py-1.5 border border-mc-border/20">
                <FileText className="w-3 h-3 text-mc-text-secondary mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <span className="text-mc-text-secondary">{artifact.sourceStep} →</span>{' '}
                  <span className="font-medium">{artifact.title}</span>
                  {artifact.content && (
                    <p className="text-mc-text-secondary/70 mt-0.5 text-[11px] line-clamp-3">{artifact.content}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Output deliverables */}
      {loadingDeliverables ? (
        <div className="mb-3 flex items-center gap-2 text-xs text-mc-text-secondary">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading output...
        </div>
      ) : deliverables.length > 0 ? (
        <div className="mb-3">
          <h5 className="text-[10px] uppercase text-mc-text-secondary/50 mb-1 font-medium">Output</h5>
          <div className="space-y-1">
            {deliverables.map((d, i) => (
              <div key={i} className="flex items-start gap-2 text-xs bg-mc-bg/50 rounded px-2 py-1.5 border border-mc-border/20">
                <FileText className="w-3 h-3 text-green-400/60 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{d.title}</span>
                  {d.path && <span className="text-mc-text-secondary/50 text-[10px] ml-1">{d.path}</span>}
                  {d.content && (
                    <p className="text-mc-text-secondary/70 mt-0.5 text-[11px] whitespace-pre-wrap line-clamp-4">{d.content}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (step.state === 'complete' || step.state === 'review') ? (
        <div className="mb-3 text-xs text-mc-text-secondary/40 italic">
          No output artifacts recorded
        </div>
      ) : null}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {step.state === 'review' && (
          <>
            <button
              onClick={handleApprove}
              disabled={isApproving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 border border-green-500/40 text-green-400 rounded text-xs font-medium hover:bg-green-500/30 disabled:opacity-50"
            >
              <Check className="w-3 h-3" />
              {isApproving ? 'Approving...' : 'Approve'}
            </button>
            <button
              onClick={handleReject}
              disabled={isRejecting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 border border-red-500/40 text-red-400 rounded text-xs font-medium hover:bg-red-500/30 disabled:opacity-50"
            >
              <XCircle className="w-3 h-3" />
              {isRejecting ? 'Rejecting...' : 'Reject'}
            </button>
          </>
        )}
        {step.state === 'running' && (
          <button
            onClick={handleCancel}
            disabled={isCancelling}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-mc-bg-tertiary border border-mc-border/50 text-mc-text-secondary rounded text-xs font-medium hover:bg-mc-bg disabled:opacity-50"
          >
            <Square className="w-3 h-3" />
            {isCancelling ? 'Cancelling...' : 'Cancel Step'}
          </button>
        )}
      </div>
    </div>
  );
}
