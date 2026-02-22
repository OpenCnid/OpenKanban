'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle, FileText, Download, ExternalLink } from 'lucide-react';
import { MarkdownContent } from '@/components/ui/MarkdownContent';

interface RunCompletedModalProps {
  runId: string;
  runName: string;
  onClose: () => void;
}

interface StepOutput {
  stepName: string;
  deliverables: Array<{
    id: string;
    title: string;
    description?: string;
  }>;
}

export function RunCompletedModal({ runId, runName, onClose }: RunCompletedModalProps) {
  const [steps, setSteps] = useState<StepOutput[]>([]);
  const [loading, setLoading] = useState(true);
  const [outputPath, setOutputPath] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        // Get all tasks for this run
        const tasksRes = await fetch(`/api/tasks?workspace_id=default&workflow_run_id=${runId}`);
        if (!tasksRes.ok) return;
        const tasks = await tasksRes.json();

        // Sort by step index
        const sorted = tasks.sort((a: { workflow_step_index?: number }, b: { workflow_step_index?: number }) =>
          (a.workflow_step_index ?? 0) - (b.workflow_step_index ?? 0)
        );

        // Fetch deliverables for each task
        const stepOutputs: StepOutput[] = [];
        for (const task of sorted) {
          const delivRes = await fetch(`/api/tasks/${task.id}/deliverables`);
          const delivs = delivRes.ok ? await delivRes.json() : [];
          stepOutputs.push({
            stepName: task.title,
            deliverables: Array.isArray(delivs) ? delivs : [],
          });
        }
        setSteps(stepOutputs);

        // Check if there's an output file path in the run outcome
        const runRes = await fetch(`/api/workflows/runs?workspace_id=default`);
        if (runRes.ok) {
          const runs = await runRes.json();
          const run = runs.find((r: { id: string }) => r.id === runId);
          if (run?.outcome?.includes('Output:')) {
            const path = run.outcome.split('Output:')[1]?.trim();
            if (path) setOutputPath(path);
          }
        }
      } catch {
        // Silent
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [runId]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[5vh] z-50" onClick={onClose}>
      <div
        className="w-full max-w-3xl mx-4 bg-mc-bg-secondary border border-mc-border rounded-xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-mc-border bg-mc-bg-tertiary/30">
          <CheckCircle className="w-5 h-5 text-emerald-400" />
          <div className="flex-1">
            <h2 className="text-base font-semibold text-mc-text">Pipeline Complete</h2>
            <p className="text-xs text-mc-text-secondary mt-0.5">{runName}</p>
          </div>
          {outputPath && (
            <div className="flex items-center gap-1 text-xs text-mc-accent bg-mc-accent/10 px-2.5 py-1 rounded-full">
              <Download className="w-3 h-3" />
              Saved to file
            </div>
          )}
          <button onClick={onClose} className="p-1 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-mc-text-secondary" />
            </div>
          ) : steps.length > 0 ? (
            steps.map((step, i) => (
              <div key={i} className="bg-mc-bg-tertiary/30 border border-mc-border/30 rounded-lg overflow-hidden">
                {/* Step header */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-mc-border/20 bg-mc-bg-tertiary/20">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <span className="text-xs font-medium text-emerald-400">{i + 1}</span>
                  </div>
                  <span className="text-sm font-medium text-mc-text">{step.stepName}</span>
                </div>

                {/* Step output */}
                <div className="px-4 py-3">
                  {step.deliverables.length > 0 ? (
                    step.deliverables.map((d, j) => (
                      <div key={j}>
                        {d.description ? (
                          <MarkdownContent content={d.description} />
                        ) : (
                          <p className="text-xs text-mc-text-secondary italic">No output captured</p>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-mc-text-secondary italic">No output captured</p>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12">
              <FileText className="w-8 h-8 mx-auto text-mc-text-secondary/20 mb-2" />
              <p className="text-sm text-mc-text-secondary">No output available</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-mc-border bg-mc-bg-tertiary/30">
          <div className="text-xs text-mc-text-secondary">
            {outputPath ? (
              <span className="flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />
                {outputPath.split('/').slice(-2).join('/')}
              </span>
            ) : (
              `${steps.length} steps completed`
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-mc-accent text-mc-bg rounded-lg text-sm font-medium hover:bg-mc-accent/90 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
