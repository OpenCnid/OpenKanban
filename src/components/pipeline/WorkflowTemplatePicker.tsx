'use client';

import { useState } from 'react';
import { X, ArrowLeft, Play, Plus } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { WorkflowTemplateEditor } from './WorkflowTemplateEditor';
import type { WorkflowTemplate } from '@/lib/types';

interface WorkflowTemplatePickerProps {
  onClose: () => void;
  onTrigger: (templateId: string, triggerInput: string) => void;
}

export function WorkflowTemplatePicker({ onClose, onTrigger }: WorkflowTemplatePickerProps) {
  const { workflowTemplates, addWorkflowTemplate } = useMissionControl();
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);
  const [triggerInput, setTriggerInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  const handleCreateTemplate = async (template: {
    name: string;
    description: string;
    icon: string;
    steps: Array<{ name: string; agent_role?: string; depends_on?: string; review?: boolean }>;
  }) => {
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: template.name,
        description: template.description,
        icon: template.icon,
        trigger_type: 'manual',
        steps: template.steps,
      }),
    });

    if (!res.ok) {
      throw new Error('Failed to create workflow template');
    }

    const created = await res.json();
    addWorkflowTemplate(created);
    setShowEditor(false);
  };

  const handleSubmit = async () => {
    if (!selectedTemplate) return;
    setIsSubmitting(true);
    onTrigger(selectedTemplate.id, triggerInput);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-mc-bg-secondary border border-mc-border rounded-xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-mc-border">
          <div className="flex items-center gap-2">
            {selectedTemplate && (
              <button
                onClick={() => { setSelectedTemplate(null); setTriggerInput(''); }}
                className="p-1 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="font-semibold text-lg">
              {selectedTemplate ? selectedTemplate.name : 'New Workflow'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {!selectedTemplate ? (
          // Template list
          <div className="p-4 space-y-2 max-h-[400px] overflow-y-auto">
            {/* Create new button */}
            <button
              onClick={() => setShowEditor(true)}
              className="w-full text-left p-3 rounded-lg border border-dashed border-mc-accent/30 hover:border-mc-accent/60 hover:bg-mc-accent/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-mc-accent/10 flex items-center justify-center">
                  <Plus className="w-4 h-4 text-mc-accent" />
                </div>
                <div>
                  <h3 className="font-medium text-sm text-mc-accent">Create New Workflow</h3>
                  <p className="text-xs text-mc-text-secondary mt-0.5">Define steps, dependencies, and review checkpoints</p>
                </div>
              </div>
            </button>

            {workflowTemplates.length === 0 ? (
              <div className="text-center py-4 text-mc-text-secondary">
                <p className="text-xs">No templates yet — create your first one above.</p>
              </div>
            ) : (
              workflowTemplates.filter(t => t.enabled).map((template) => (
                <button
                  key={template.id}
                  onClick={() => setSelectedTemplate(template)}
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
        ) : (
          // Trigger input form
          <div className="p-4">
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-3 text-mc-text-secondary text-xs">
                <span className="text-lg">{selectedTemplate.icon}</span>
                <span>
                  {Array.isArray(selectedTemplate.steps) ? selectedTemplate.steps.length : 0} steps
                </span>
                {selectedTemplate.description && (
                  <>
                    <span>·</span>
                    <span className="truncate">{selectedTemplate.description}</span>
                  </>
                )}
              </div>

              <label className="block text-sm font-medium mb-2">
                Input
              </label>
              <textarea
                value={triggerInput}
                onChange={(e) => setTriggerInput(e.target.value)}
                placeholder="YouTube URL, text description, or other input..."
                className="w-full px-3 py-2 bg-mc-bg border border-mc-border rounded-lg text-sm resize-none focus:outline-none focus:border-mc-accent/50 min-h-[80px]"
                autoFocus
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-mc-accent text-mc-bg rounded-lg text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              {isSubmitting ? 'Starting...' : 'Run Workflow'}
            </button>
          </div>
        )}
      </div>

      {/* Template Editor Modal */}
      {showEditor && (
        <WorkflowTemplateEditor
          onClose={() => setShowEditor(false)}
          onSave={handleCreateTemplate}
        />
      )}
    </div>
  );
}
