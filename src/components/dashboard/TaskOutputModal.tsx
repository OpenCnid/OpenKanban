'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle, Clock, AlertCircle, FileText } from 'lucide-react';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import type { Task } from '@/lib/types';

interface TaskOutputModalProps {
  task: Task;
  onClose: () => void;
}

interface Deliverable {
  id: string;
  title: string;
  path: string;
  description?: string;
  created_at: string;
}

export function TaskOutputModal({ task, onClose }: TaskOutputModalProps) {
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/tasks/${task.id}/deliverables`);
        if (res.ok) {
          const data = await res.json();
          setDeliverables(Array.isArray(data) ? data : []);
        }
      } catch {
        // Silent
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [task.id]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const statusIcon = {
    done: <CheckCircle className="w-5 h-5 text-green-400" />,
    in_progress: <Clock className="w-5 h-5 text-teal-400 animate-pulse" />,
    review: <AlertCircle className="w-5 h-5 text-amber-400" />,
    inbox: <Clock className="w-5 h-5 text-mc-text-secondary" />,
  }[task.status] || <Clock className="w-5 h-5 text-mc-text-secondary" />;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[10vh] z-50" onClick={onClose}>
      <div
        className="w-full max-w-2xl mx-4 bg-mc-bg-secondary border border-mc-border rounded-xl shadow-2xl overflow-hidden max-h-[75vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-mc-border">
          {statusIcon}
          <div className="flex-1">
            <h2 className="text-base font-semibold text-mc-text">{task.title}</h2>
            <p className="text-xs text-mc-text-secondary mt-0.5">
              Step {(task.workflow_step_index ?? 0) + 1} · {task.status.toUpperCase()}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-mc-text-secondary" />
            </div>
          ) : deliverables.length > 0 ? (
            deliverables.map((d) => (
              <div key={d.id} className="bg-mc-bg-tertiary/50 border border-mc-border/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-mc-accent" />
                  <h3 className="text-sm font-medium text-mc-text">{d.title}</h3>
                </div>
                {d.description && (
                  <div className="max-h-[300px] overflow-y-auto">
                    <MarkdownContent content={d.description} />
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="text-center py-8">
              <FileText className="w-8 h-8 mx-auto text-mc-text-secondary/20 mb-2" />
              <p className="text-sm text-mc-text-secondary">No output captured for this step.</p>
              <p className="text-xs text-mc-text-secondary/50 mt-1">
                The agent completed the task but didn't produce stored output.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
