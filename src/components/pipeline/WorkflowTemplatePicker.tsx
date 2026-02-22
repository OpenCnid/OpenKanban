'use client';

import { X } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import type { WorkflowTemplate } from '@/lib/types';

interface WorkflowTemplatePickerProps {
  onClose: () => void;
  onSelect: (template: WorkflowTemplate) => void;
}

export function WorkflowTemplatePicker({ onClose, onSelect }: WorkflowTemplatePickerProps) {
  const { workflowTemplates } = useMissionControl();

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-mc-bg-secondary border border-mc-border rounded-xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-mc-border">
          <h2 className="font-semibold text-lg">New Workflow</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Template list */}
        <div className="p-4 space-y-2 max-h-[400px] overflow-y-auto">
          {workflowTemplates.length === 0 ? (
            <div className="text-center py-8 text-mc-text-secondary">
              <p className="text-sm">No workflow templates available.</p>
              <p className="text-xs mt-1">Create one via the API first.</p>
            </div>
          ) : (
            workflowTemplates.map((template) => (
              <button
                key={template.id}
                onClick={() => onSelect(template)}
                className="w-full text-left p-3 rounded-lg border border-mc-border/50 hover:border-mc-accent/40 hover:bg-mc-bg-tertiary transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{template.icon}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm">{template.name}</h3>
                    {template.description && (
                      <p className="text-xs text-mc-text-secondary truncate mt-0.5">
                        {template.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-mc-text-secondary/60 uppercase">
                        {template.trigger_type}
                      </span>
                      <span className="text-[10px] text-mc-text-secondary/60">
                        {Array.isArray(template.steps) ? template.steps.length : 0} steps
                      </span>
                      {template.total_runs > 0 && (
                        <span className="text-[10px] text-mc-text-secondary/60">
                          {template.total_runs} runs
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
