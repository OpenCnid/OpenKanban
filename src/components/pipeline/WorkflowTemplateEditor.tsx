'use client';

import { useState } from 'react';
import { X, Plus, Trash2, GripVertical, CheckCircle, ArrowRight, Save } from 'lucide-react';

interface EditableStep {
  id: string;
  name: string;
  agent_role: string;
  depends_on: string;
  review: boolean;
}

interface WorkflowTemplateEditorProps {
  onClose: () => void;
  onSave: (template: {
    name: string;
    description: string;
    icon: string;
    steps: Array<{
      name: string;
      agent_role?: string;
      depends_on?: string;
      review?: boolean;
    }>;
  }) => Promise<void>;
  initial?: {
    name: string;
    description: string;
    icon: string;
    steps: EditableStep[];
  };
}

const ICONS = ['⚡', '🎬', '📈', '📊', '🔬', '📝', '🎯', '🚀', '🔧', '📦', '🌐', '💡'];

let stepCounter = 0;
function newStep(overrides?: Partial<EditableStep>): EditableStep {
  stepCounter++;
  return {
    id: `step-${Date.now()}-${stepCounter}`,
    name: '',
    agent_role: '',
    depends_on: '',
    review: false,
    ...overrides,
  };
}

export function WorkflowTemplateEditor({ onClose, onSave, initial }: WorkflowTemplateEditorProps) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [icon, setIcon] = useState(initial?.icon || '⚡');
  const [steps, setSteps] = useState<EditableStep[]>(
    initial?.steps || [newStep({ name: 'Step 1' })]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addStep = () => {
    const prevStep = steps[steps.length - 1];
    setSteps([...steps, newStep({
      name: `Step ${steps.length + 1}`,
      depends_on: prevStep?.name || '',
    })]);
  };

  const removeStep = (id: string) => {
    if (steps.length <= 1) return;
    const removed = steps.find(s => s.id === id);
    setSteps(prev => {
      const updated = prev.filter(s => s.id !== id);
      // Clear depends_on references to removed step
      return updated.map(s =>
        s.depends_on === removed?.name ? { ...s, depends_on: '' } : s
      );
    });
  };

  const updateStep = (id: string, field: keyof EditableStep, value: string | boolean) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const handleSave = async () => {
    setError('');

    if (!name.trim()) {
      setError('Workflow name is required');
      return;
    }

    const emptySteps = steps.filter(s => !s.name.trim());
    if (emptySteps.length > 0) {
      setError('All steps must have a name');
      return;
    }

    // Check for duplicate step names
    const names = steps.map(s => s.name.trim());
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length > 0) {
      setError(`Duplicate step name: "${dupes[0]}"`);
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        icon,
        steps: steps.map(s => ({
          name: s.name.trim(),
          agent_role: s.agent_role.trim() || undefined,
          depends_on: s.depends_on || undefined,
          review: s.review || undefined,
        })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  };

  // Available step names for depends_on dropdown (all steps except current)
  const stepNames = steps.map(s => s.name).filter(n => n.trim());

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-mc-bg-secondary border border-mc-border rounded-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-mc-border shrink-0">
          <h2 className="font-semibold text-lg">
            {initial ? 'Edit Workflow' : 'Create Workflow'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-mc-bg rounded text-mc-text-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Name + Icon */}
          <div className="flex gap-3">
            {/* Icon picker */}
            <div className="shrink-0">
              <label className="block text-xs font-medium text-mc-text-secondary mb-1">Icon</label>
              <div className="relative">
                <select
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  className="appearance-none w-12 h-10 text-center text-xl bg-mc-bg border border-mc-border rounded-lg cursor-pointer focus:outline-none focus:border-mc-accent/50"
                >
                  {ICONS.map(i => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-mc-text-secondary mb-1">Workflow Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. YouTube to Presentation"
                className="w-full px-3 py-2 bg-mc-bg border border-mc-border rounded-lg text-sm focus:outline-none focus:border-mc-accent/50"
                autoFocus
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-mc-text-secondary mb-1">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this workflow do?"
              className="w-full px-3 py-2 bg-mc-bg border border-mc-border rounded-lg text-sm focus:outline-none focus:border-mc-accent/50"
            />
          </div>

          {/* Steps */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium text-mc-text-secondary">Steps</label>
              <button
                onClick={addStep}
                className="flex items-center gap-1 text-xs text-mc-accent hover:text-mc-accent/80"
              >
                <Plus className="w-3 h-3" />
                Add Step
              </button>
            </div>

            {/* Step chain preview */}
            <div className="flex items-center gap-1 mb-3 px-2 py-1.5 bg-mc-bg rounded-lg overflow-x-auto">
              {steps.map((step, i) => (
                <div key={step.id} className="flex items-center gap-1 shrink-0">
                  {i > 0 && <ArrowRight className="w-3 h-3 text-mc-text-secondary/40" />}
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    step.review
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-mc-border/50 text-mc-text-secondary'
                  }`}>
                    {step.name || `Step ${i + 1}`}
                    {step.review && ' 🔍'}
                  </span>
                </div>
              ))}
            </div>

            {/* Step editors */}
            <div className="space-y-2">
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  className="flex items-start gap-2 p-3 bg-mc-bg rounded-lg border border-mc-border/50"
                >
                  <div className="text-mc-text-secondary/30 mt-2">
                    <GripVertical className="w-4 h-4" />
                  </div>

                  <div className="flex-1 grid grid-cols-2 gap-2">
                    {/* Step name */}
                    <input
                      value={step.name}
                      onChange={(e) => updateStep(step.id, 'name', e.target.value)}
                      placeholder="Step name"
                      className="px-2 py-1.5 bg-mc-bg-secondary border border-mc-border/50 rounded text-sm focus:outline-none focus:border-mc-accent/50"
                    />

                    {/* Agent role */}
                    <input
                      value={step.agent_role}
                      onChange={(e) => updateStep(step.id, 'agent_role', e.target.value)}
                      placeholder="Agent role (optional)"
                      className="px-2 py-1.5 bg-mc-bg-secondary border border-mc-border/50 rounded text-sm focus:outline-none focus:border-mc-accent/50"
                    />

                    {/* Depends on */}
                    <select
                      value={step.depends_on}
                      onChange={(e) => updateStep(step.id, 'depends_on', e.target.value)}
                      className="px-2 py-1.5 bg-mc-bg-secondary border border-mc-border/50 rounded text-sm focus:outline-none focus:border-mc-accent/50 text-mc-text-secondary"
                    >
                      <option value="">No dependency (starts immediately)</option>
                      {stepNames
                        .filter(n => n !== step.name)
                        .map(n => (
                          <option key={n} value={n}>{`After: ${n}`}</option>
                        ))
                      }
                    </select>

                    {/* Review checkbox */}
                    <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={step.review}
                        onChange={(e) => updateStep(step.id, 'review', e.target.checked)}
                        className="rounded border-mc-border"
                      />
                      <span className="text-xs text-mc-text-secondary">
                        <CheckCircle className="w-3 h-3 inline mr-1" />
                        Review checkpoint
                      </span>
                    </label>
                  </div>

                  {/* Delete */}
                  <button
                    onClick={() => removeStep(step.id)}
                    disabled={steps.length <= 1}
                    className="p-1 text-mc-text-secondary/40 hover:text-red-400 disabled:opacity-20 disabled:cursor-not-allowed mt-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-mc-border shrink-0">
          {error && (
            <p className="text-xs text-red-400 mb-2">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-mc-text-secondary hover:text-mc-text"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-mc-accent text-mc-bg rounded-lg text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Workflow'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
