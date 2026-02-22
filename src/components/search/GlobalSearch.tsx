'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Brain, GitBranch, LayoutList, ShieldCheck, X, Command, ArrowRight } from 'lucide-react';

interface SearchResults {
  memories: Array<{ id: string; memory?: string; text?: string; score?: number }>;
  workflows: Array<{ id: string; name: string; description?: string; icon?: string }>;
  tasks: Array<{ id: string; title: string; status: string; priority?: string }>;
  approvals: Array<{ id: string; task_title?: string; workflow_name?: string; status: string }>;
}

interface GlobalSearchProps {
  onNavigate?: (tab: string) => void;
}

export function GlobalSearch({ onNavigate }: GlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<NodeJS.Timeout | null>(null);

  // Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        handleClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleClose = () => {
    setOpen(false);
    setQuery('');
    setResults(null);
    setSelectedIndex(0);
  };

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=5`);
      if (res.ok) {
        setResults(await res.json());
        setSelectedIndex(0);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(value), 250);
  };

  // Flatten results for keyboard navigation
  const flatResults = results
    ? [
        ...results.memories.map((m) => ({ type: 'memory' as const, data: m })),
        ...results.workflows.map((w) => ({ type: 'workflow' as const, data: w })),
        ...results.tasks.map((t) => ({ type: 'task' as const, data: t })),
        ...results.approvals.map((a) => ({ type: 'approval' as const, data: a })),
      ]
    : [];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flatResults[selectedIndex]) {
      e.preventDefault();
      handleSelectResult(flatResults[selectedIndex]);
    }
  };

  const handleSelectResult = (result: (typeof flatResults)[0]) => {
    handleClose();
    if (result.type === 'memory' && onNavigate) {
      onNavigate('memory');
    } else if (result.type === 'workflow' && onNavigate) {
      onNavigate('pipelines');
    } else if (result.type === 'task' && onNavigate) {
      onNavigate('tasks');
    } else if (result.type === 'approval' && onNavigate) {
      onNavigate('approvals');
    }
  };

  const totalResults = flatResults.length;
  const hasResults = results !== null;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl mx-4 bg-mc-bg-secondary border border-mc-border rounded-xl shadow-2xl overflow-hidden">
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 border-b border-mc-border">
          <Search className="w-5 h-5 text-mc-text-secondary flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search memories, workflows, tasks..."
            className="flex-1 py-4 bg-transparent text-mc-text text-base placeholder:text-mc-text-secondary/50 focus:outline-none"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-mc-accent/30 border-t-mc-accent rounded-full animate-spin" />
          )}
          <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-mc-text-secondary bg-mc-bg-tertiary border border-mc-border rounded">
            ESC
          </kbd>
        </div>

        {/* Results */}
        {hasResults && (
          <div className="max-h-[400px] overflow-y-auto">
            {totalResults === 0 ? (
              <div className="py-8 text-center text-sm text-mc-text-secondary">
                No results for &ldquo;{query}&rdquo;
              </div>
            ) : (
              <div className="py-2">
                {/* Memories */}
                {results.memories.length > 0 && (
                  <ResultSection
                    title="Memories"
                    icon={<Brain className="w-3.5 h-3.5" />}
                  >
                    {results.memories.map((m, i) => {
                      const flatIndex = i;
                      return (
                        <ResultItem
                          key={m.id}
                          selected={selectedIndex === flatIndex}
                          onClick={() => handleSelectResult({ type: 'memory', data: m })}
                        >
                          <span className="text-sm text-mc-text line-clamp-1">
                            {m.memory || m.text || m.id}
                          </span>
                          {m.score != null && (
                            <span className="flex-shrink-0 text-[10px] text-mc-accent">
                              {(m.score * 100).toFixed(0)}%
                            </span>
                          )}
                        </ResultItem>
                      );
                    })}
                  </ResultSection>
                )}

                {/* Workflows */}
                {results.workflows.length > 0 && (
                  <ResultSection
                    title="Workflows"
                    icon={<GitBranch className="w-3.5 h-3.5" />}
                  >
                    {results.workflows.map((w, i) => {
                      const flatIndex = results.memories.length + i;
                      return (
                        <ResultItem
                          key={w.id}
                          selected={selectedIndex === flatIndex}
                          onClick={() => handleSelectResult({ type: 'workflow', data: w })}
                        >
                          <span className="mr-1.5">{w.icon || '⚡'}</span>
                          <span className="text-sm text-mc-text">{w.name}</span>
                          {w.description && (
                            <span className="text-xs text-mc-text-secondary ml-2 line-clamp-1">
                              {w.description}
                            </span>
                          )}
                        </ResultItem>
                      );
                    })}
                  </ResultSection>
                )}

                {/* Tasks */}
                {results.tasks.length > 0 && (
                  <ResultSection
                    title="Tasks"
                    icon={<LayoutList className="w-3.5 h-3.5" />}
                  >
                    {results.tasks.map((t, i) => {
                      const flatIndex = results.memories.length + results.workflows.length + i;
                      return (
                        <ResultItem
                          key={t.id}
                          selected={selectedIndex === flatIndex}
                          onClick={() => handleSelectResult({ type: 'task', data: t })}
                        >
                          <StatusDot status={t.status} />
                          <span className="text-sm text-mc-text">{t.title}</span>
                        </ResultItem>
                      );
                    })}
                  </ResultSection>
                )}

                {/* Approvals */}
                {results.approvals.length > 0 && (
                  <ResultSection
                    title="Approvals"
                    icon={<ShieldCheck className="w-3.5 h-3.5" />}
                  >
                    {results.approvals.map((a, i) => {
                      const flatIndex =
                        results.memories.length +
                        results.workflows.length +
                        results.tasks.length +
                        i;
                      return (
                        <ResultItem
                          key={a.id}
                          selected={selectedIndex === flatIndex}
                          onClick={() => handleSelectResult({ type: 'approval', data: a })}
                        >
                          <span className="text-sm text-mc-text">
                            {a.task_title || a.workflow_name || 'Approval'}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded ${
                              a.status === 'pending'
                                ? 'bg-amber-500/20 text-amber-400'
                                : a.status === 'approved'
                                ? 'bg-green-500/20 text-green-400'
                                : 'bg-red-500/20 text-red-400'
                            }`}
                          >
                            {a.status}
                          </span>
                        </ResultItem>
                      );
                    })}
                  </ResultSection>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer hint */}
        {!hasResults && !loading && (
          <div className="py-6 text-center text-xs text-mc-text-secondary/60">
            Type at least 2 characters to search across memories, workflows, tasks, and approvals
          </div>
        )}

        {/* Footer with keyboard hints */}
        {totalResults > 0 && (
          <div className="flex items-center gap-4 px-4 py-2 border-t border-mc-border text-[10px] text-mc-text-secondary">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-mc-bg-tertiary border border-mc-border rounded">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-mc-bg-tertiary border border-mc-border rounded">↵</kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-mc-bg-tertiary border border-mc-border rounded">esc</kbd>
              close
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1">
      <div className="flex items-center gap-2 px-4 py-1.5 text-[10px] font-semibold text-mc-text-secondary uppercase tracking-wider">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function ResultItem({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-4 py-2 text-left transition-colors ${
        selected
          ? 'bg-mc-accent/10 text-mc-text'
          : 'hover:bg-mc-bg-tertiary text-mc-text'
      }`}
    >
      {children}
      {selected && <ArrowRight className="w-3 h-3 ml-auto text-mc-accent" />}
    </button>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'done'
      ? 'bg-green-400'
      : status === 'in-progress'
      ? 'bg-blue-400'
      : status === 'review'
      ? 'bg-amber-400'
      : 'bg-mc-text-secondary/40';

  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />;
}
