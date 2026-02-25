'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Send, X, Loader2, Zap, Search, Clock, ArrowLeft, Sparkles } from 'lucide-react';

interface Template {
  id: string;
  name: string;
  icon: string;
  description?: string;
  trigger_type?: string;
  steps?: Array<{ name: string }> | string;
}

interface MissionPromptProps {
  onClose: () => void;
  onSubmit: (input: string, options?: { templateId?: string }) => Promise<void>;
  templates?: Template[];
}

type View = 'picker' | 'configure';

export function MissionPrompt({ onClose, onSubmit, templates = [] }: MissionPromptProps) {
  const [view, setView] = useState<View>('picker');
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus search on mount
  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 50);
  }, []);

  // Focus input when switching to configure view
  useEffect(() => {
    if (view === 'configure') {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [view]);

  // Parse step count from template
  const getStepCount = (t: Template): number => {
    if (!t.steps) return 0;
    if (Array.isArray(t.steps)) return t.steps.length;
    try { return JSON.parse(t.steps).length; } catch { return 0; }
  };

  // Parse step names from template
  const getStepNames = (t: Template): string[] => {
    if (!t.steps) return [];
    const steps = Array.isArray(t.steps) ? t.steps : (() => { try { return JSON.parse(t.steps as string); } catch { return []; } })();
    return steps.map((s: { name?: string }) => s.name || '?');
  };

  // Filter templates by search
  const filteredTemplates = useMemo(() => {
    if (!search.trim()) return templates;
    const q = search.toLowerCase();
    return templates.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q)
    );
  }, [templates, search]);

  // Separate scheduled vs manual
  const manualTemplates = filteredTemplates.filter(t => t.trigger_type !== 'schedule');
  const scheduledTemplates = filteredTemplates.filter(t => t.trigger_type === 'schedule');

  const handleSelectTemplate = (t: Template) => {
    setSelectedTemplate(t);
    setView('configure');
    setInput('');
  };

  const handleFreeform = () => {
    setSelectedTemplate(null);
    setView('configure');
    setInput(search); // carry search text into the input
  };

  const handleSubmit = async () => {
    if (!input.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(
        input.trim(),
        selectedTemplate ? { templateId: selectedTemplate.id } : undefined
      );
      onClose();
    } catch {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (view === 'configure') {
        handleSubmit();
      }
    }
    if (e.key === 'Escape') {
      if (view === 'configure') {
        setView('picker');
      } else {
        onClose();
      }
    }
  };

  const handleBack = () => {
    setView('picker');
    setSelectedTemplate(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[10vh] z-50" onClick={onClose}>
      <div
        className="w-full max-w-lg mx-4 bg-mc-bg-secondary border border-mc-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {view === 'picker' ? (
          /* ─── Template Picker View ─── */
          <>
            {/* Search header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-3">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-mc-bg-tertiary rounded-lg border border-mc-border/50 focus-within:border-mc-accent/50 transition-colors">
                <Search className="w-4 h-4 text-mc-text-secondary/50 flex-shrink-0" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      // If search matches exactly one template, select it
                      if (filteredTemplates.length === 1) {
                        handleSelectTemplate(filteredTemplates[0]);
                      } else {
                        handleFreeform();
                      }
                    }
                    if (e.key === 'Escape') onClose();
                  }}
                  placeholder="Search missions or describe what you need..."
                  className="flex-1 bg-transparent text-sm text-mc-text placeholder:text-mc-text-secondary/40 focus:outline-none"
                />
              </div>
              <button onClick={onClose} className="p-1.5 hover:bg-mc-bg-tertiary rounded-lg text-mc-text-secondary transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Template grid */}
            <div className="px-5 pb-2 max-h-[50vh] overflow-y-auto">
              {manualTemplates.length > 0 && (
                <div className="mb-3">
                  <div className="grid grid-cols-1 gap-1.5">
                    {manualTemplates.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => handleSelectTemplate(t)}
                        className="group flex items-start gap-3 px-3.5 py-3 rounded-lg text-left transition-all border border-transparent hover:border-mc-accent/20 hover:bg-mc-bg-tertiary"
                      >
                        <span className="text-xl mt-0.5 group-hover:scale-110 transition-transform">{t.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-mc-text group-hover:text-mc-accent transition-colors">
                              {t.name}
                            </span>
                            <span className="text-[10px] text-mc-text-secondary/40 bg-mc-bg-tertiary px-1.5 py-0.5 rounded">
                              {getStepCount(t)} steps
                            </span>
                          </div>
                          {t.description && (
                            <p className="text-xs text-mc-text-secondary/60 mt-0.5 line-clamp-2">{t.description}</p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {scheduledTemplates.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] uppercase text-mc-text-secondary/40 font-medium mb-1.5 tracking-wider flex items-center gap-1.5 px-1">
                    <Clock className="w-3 h-3" />
                    Scheduled
                  </p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {scheduledTemplates.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => handleSelectTemplate(t)}
                        className="group flex items-start gap-3 px-3.5 py-3 rounded-lg text-left transition-all border border-transparent hover:border-mc-accent/20 hover:bg-mc-bg-tertiary"
                      >
                        <span className="text-xl mt-0.5 group-hover:scale-110 transition-transform">{t.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-mc-text group-hover:text-mc-accent transition-colors">
                              {t.name}
                            </span>
                            <span className="text-[10px] text-mc-text-secondary/40 bg-mc-bg-tertiary px-1.5 py-0.5 rounded">
                              {getStepCount(t)} steps
                            </span>
                          </div>
                          {t.description && (
                            <p className="text-xs text-mc-text-secondary/60 mt-0.5 line-clamp-2">{t.description}</p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {filteredTemplates.length === 0 && search.trim() && (
                <div className="text-center py-6 text-mc-text-secondary/50 text-sm">
                  No templates match &ldquo;{search}&rdquo;
                </div>
              )}
            </div>

            {/* Freeform option at bottom */}
            <div className="px-5 py-3 border-t border-mc-border/30 bg-mc-bg-tertiary/20">
              <button
                onClick={handleFreeform}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm text-mc-text-secondary hover:text-mc-accent hover:bg-mc-bg-tertiary transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                <span>Describe something custom...</span>
              </button>
            </div>
          </>
        ) : (
          /* ─── Configure & Launch View ─── */
          <>
            {/* Header with back button */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-2">
              <button
                onClick={handleBack}
                className="p-1 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              {selectedTemplate ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-lg">{selectedTemplate.icon}</span>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-mc-text truncate">{selectedTemplate.name}</h2>
                    <p className="text-[10px] text-mc-text-secondary/50">{getStepCount(selectedTemplate)} steps</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-mc-accent" />
                  <h2 className="text-sm font-semibold text-mc-text">Custom Mission</h2>
                </div>
              )}
              <button onClick={onClose} className="p-1 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary ml-auto">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Step preview for templates */}
            {selectedTemplate && (
              <div className="px-5 pb-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {getStepNames(selectedTemplate).map((name, i, arr) => (
                    <span key={i} className="flex items-center gap-1.5 text-[11px] text-mc-text-secondary/50">
                      <span className="bg-mc-bg-tertiary px-2 py-0.5 rounded-full">{name}</span>
                      {i < arr.length - 1 && <span className="text-mc-border">→</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div className="px-5 pb-3">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  selectedTemplate
                    ? `What should this mission focus on? e.g. "AAPL earnings play" or a YouTube URL...`
                    : `Describe what you need...`
                }
                rows={3}
                className="w-full px-0 py-2 bg-transparent text-mc-text text-base placeholder:text-mc-text-secondary/40 focus:outline-none resize-none border-b border-mc-border/50 focus:border-mc-accent/50 transition-colors"
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-mc-border/50 bg-mc-bg-tertiary/30">
              <div className="text-[10px] text-mc-text-secondary/50">
                {selectedTemplate
                  ? `Agent follows ${getStepCount(selectedTemplate)} steps`
                  : 'Agent decides the approach'}
              </div>
              <button
                onClick={handleSubmit}
                disabled={!input.trim() || submitting}
                className="flex items-center gap-2 px-4 py-2 bg-mc-accent text-mc-bg rounded-lg text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Launching...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Launch
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
