'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, ChevronDown, ChevronUp, X, Loader2, Zap } from 'lucide-react';

interface MissionPromptProps {
  onClose: () => void;
  onSubmit: (input: string, options?: { templateId?: string }) => Promise<void>;
  templates?: Array<{ id: string; name: string; icon: string; description?: string }>;
}

export function MissionPrompt({ onClose, onSubmit, templates }: MissionPromptProps) {
  const [input, setInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSubmit = async () => {
    if (!input.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(input.trim(), selectedTemplate ? { templateId: selectedTemplate } : undefined);
      onClose();
    } catch {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const selectedTemplateName = templates?.find(t => t.id === selectedTemplate);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[12vh] z-50" onClick={onClose}>
      <div
        className="w-full max-w-xl mx-4 bg-mc-bg-secondary border border-mc-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-mc-accent" />
            <h2 className="text-sm font-semibold text-mc-text">New Mission</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main input */}
        <div className="px-5 pb-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What do you need? e.g. &quot;Analyze AAPL options flow&quot; or &quot;Prep the Wednesday show&quot;"
            rows={3}
            className="w-full px-0 py-2 bg-transparent text-mc-text text-base placeholder:text-mc-text-secondary/40 focus:outline-none resize-none border-b border-mc-border/50 focus:border-mc-accent/50 transition-colors"
          />
        </div>

        {/* Selected template indicator */}
        {selectedTemplateName && (
          <div className="mx-5 mb-2 flex items-center gap-2 px-3 py-1.5 bg-mc-accent/10 rounded-lg text-xs">
            <span>{selectedTemplateName.icon}</span>
            <span className="text-mc-accent font-medium">{selectedTemplateName.name}</span>
            <button
              onClick={() => setSelectedTemplate(null)}
              className="ml-auto text-mc-text-secondary hover:text-mc-text"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Advanced settings toggle */}
        <div className="px-5">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-xs text-mc-text-secondary hover:text-mc-text transition-colors py-1"
          >
            {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Advanced
          </button>
        </div>

        {/* Advanced: template selection */}
        {showAdvanced && templates && templates.length > 0 && (
          <div className="px-5 pb-3 pt-1">
            <p className="text-[10px] uppercase text-mc-text-secondary/60 font-medium mb-2 tracking-wider">
              Use a workflow template
            </p>
            <div className="grid grid-cols-1 gap-1.5 max-h-[180px] overflow-y-auto">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTemplate(selectedTemplate === t.id ? null : t.id)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                    selectedTemplate === t.id
                      ? 'bg-mc-accent/10 border border-mc-accent/30'
                      : 'border border-mc-border/30 hover:border-mc-accent/20 hover:bg-mc-bg-tertiary'
                  }`}
                >
                  <span className="text-base">{t.icon}</span>
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm ${selectedTemplate === t.id ? 'text-mc-accent font-medium' : 'text-mc-text'}`}>
                      {t.name}
                    </span>
                    {t.description && (
                      <p className="text-[11px] text-mc-text-secondary/60 truncate">{t.description}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer: submit */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-mc-border/50 bg-mc-bg-tertiary/30">
          <div className="text-[10px] text-mc-text-secondary/50">
            {selectedTemplate ? 'Template selected — agent will follow its steps' : 'Agent will decide how to approach this'}
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
      </div>
    </div>
  );
}
