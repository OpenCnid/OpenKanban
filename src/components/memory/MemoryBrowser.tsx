'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Brain, RefreshCw, Plus, Database, Clock, Filter, X } from 'lucide-react';
import { MemoryCard } from './MemoryCard';

interface Memory {
  id: string;
  memory?: string;
  text?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
  score?: number;
}

interface MemoryBrowserProps {
  workspaceId: string;
}

export function MemoryBrowser({ workspaceId }: MemoryBrowserProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [scope, setScope] = useState<'long-term' | 'session' | 'all'>('long-term');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMemoryText, setNewMemoryText] = useState('');
  const [saving, setSaving] = useState(false);

  const loadMemories = useCallback(async (query?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ scope });
      if (query) {
        params.set('q', query);
        params.set('limit', '30');
      }
      const res = await fetch(`/api/memory?${params}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setMemories(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String(err));
      setMemories([]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    loadMemories(activeSearch || undefined);
  }, [loadMemories, activeSearch]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveSearch(searchQuery);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setActiveSearch('');
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/memory/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setMemories((prev) => prev.filter((m) => m.id !== id));
    }
  };

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemoryText.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newMemoryText, longTerm: scope === 'long-term' }),
      });
      if (res.ok) {
        setNewMemoryText('');
        setShowAddForm(false);
        // Refresh the list
        loadMemories(activeSearch || undefined);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-mc-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-mc-accent" />
            <h2 className="text-lg font-semibold">Agent Memory</h2>
            {!loading && (
              <span className="text-xs text-mc-text-secondary bg-mc-bg-tertiary px-2 py-0.5 rounded-full">
                {memories.length} {activeSearch ? 'results' : 'memories'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-mc-accent/10 text-mc-accent hover:bg-mc-accent/20 rounded-md transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Memory
            </button>
            <button
              onClick={() => loadMemories(activeSearch || undefined)}
              disabled={loading}
              className="p-1.5 text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary rounded transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Search + Filter bar */}
        <div className="flex items-center gap-2">
          <form onSubmit={handleSearch} className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mc-text-secondary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search memories..."
              className="w-full pl-9 pr-8 py-2 bg-mc-bg-tertiary border border-mc-border rounded-lg text-sm text-mc-text placeholder:text-mc-text-secondary/50 focus:outline-none focus:border-mc-accent/50"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-mc-text-secondary hover:text-mc-text"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </form>

          {/* Scope filter */}
          <div className="flex items-center bg-mc-bg-tertiary rounded-lg border border-mc-border">
            {(['long-term', 'session', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  scope === s
                    ? 'text-mc-accent bg-mc-accent/10'
                    : 'text-mc-text-secondary hover:text-mc-text'
                }`}
              >
                {s === 'long-term' ? 'Long-term' : s === 'session' ? 'Session' : 'All'}
              </button>
            ))}
          </div>
        </div>

        {/* Active search indicator */}
        {activeSearch && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-mc-text-secondary">
              Showing results for &ldquo;{activeSearch}&rdquo;
            </span>
            <button
              onClick={clearSearch}
              className="text-xs text-mc-accent hover:underline"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Add Memory Form */}
      {showAddForm && (
        <div className="flex-shrink-0 p-4 border-b border-mc-border bg-mc-bg-secondary/50">
          <form onSubmit={handleAddMemory} className="flex gap-2">
            <input
              type="text"
              value={newMemoryText}
              onChange={(e) => setNewMemoryText(e.target.value)}
              placeholder="Add a memory for the agent to remember..."
              className="flex-1 px-3 py-2 bg-mc-bg-tertiary border border-mc-border rounded-lg text-sm text-mc-text placeholder:text-mc-text-secondary/50 focus:outline-none focus:border-mc-accent/50"
              autoFocus
            />
            <button
              type="submit"
              disabled={saving || !newMemoryText.trim()}
              className="px-4 py-2 bg-mc-accent text-mc-bg text-sm font-medium rounded-lg hover:bg-mc-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setNewMemoryText(''); }}
              className="px-3 py-2 text-sm text-mc-text-secondary hover:text-mc-text"
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      {/* Memory List */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="p-4 bg-mc-bg-secondary border border-mc-border rounded-lg animate-pulse">
                <div className="h-4 bg-mc-bg-tertiary rounded w-3/4 mb-2" />
                <div className="h-3 bg-mc-bg-tertiary rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Database className="w-10 h-10 text-red-400/50 mb-3" />
            <p className="text-sm text-red-400 mb-1">Failed to load memories</p>
            <p className="text-xs text-mc-text-secondary max-w-md">{error}</p>
            <button
              onClick={() => loadMemories(activeSearch || undefined)}
              className="mt-3 text-xs text-mc-accent hover:underline"
            >
              Retry
            </button>
          </div>
        ) : memories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Brain className="w-10 h-10 text-mc-text-secondary/30 mb-3" />
            <p className="text-sm text-mc-text-secondary">
              {activeSearch ? 'No memories match your search.' : 'No memories stored yet.'}
            </p>
            {activeSearch && (
              <button
                onClick={clearSearch}
                className="mt-2 text-xs text-mc-accent hover:underline"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {memories.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                onDelete={handleDelete}
                showScore={!!activeSearch}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
