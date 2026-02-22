'use client';

import { useState, useMemo } from 'react';
import { GitBranch, Plus } from 'lucide-react';
import { PipelineCard, type PipelineRunData } from './PipelineCard';
import { PipelineFilters, type PipelineFilter } from './PipelineFilters';
import { WorkflowTemplatePicker } from './WorkflowTemplatePicker';

interface PipelineViewProps {
  workspaceId: string;
}

// Mock data for development — will be replaced in Task 6
const MOCK_RUNS: PipelineRunData[] = [
  {
    id: 'mock-1',
    name: 'YouTube → Presentation',
    icon: '🎬',
    status: 'running',
    triggerInput: 'How to Read Options Flow',
    steps: [
      { name: 'Extract Transcript', state: 'complete' },
      { name: 'Summarize', state: 'running' },
      { name: 'Generate Gamma Deck', state: 'waiting' },
      { name: 'Distribute', state: 'pending' },
    ],
    startedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
  },
  {
    id: 'mock-2',
    name: 'Market Research Pipeline',
    icon: '📊',
    status: 'running',
    triggerInput: 'AAPL earnings analysis Q1 2026',
    steps: [
      { name: 'Gather Data', state: 'complete' },
      { name: 'Analyze Trends', state: 'complete' },
      { name: 'Review Findings', state: 'review' },
      { name: 'Generate Report', state: 'pending' },
      { name: 'Distribute', state: 'pending' },
    ],
    startedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  },
  {
    id: 'mock-3',
    name: 'Content Distribution',
    icon: '📢',
    status: 'completed',
    triggerInput: 'Weekly market update post',
    steps: [
      { name: 'Draft Content', state: 'complete' },
      { name: 'Review', state: 'complete' },
      { name: 'Post to Discord', state: 'complete' },
      { name: 'Post to Twitter', state: 'complete' },
    ],
    startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'mock-4',
    name: 'Excel Monitor Alert',
    icon: '🚨',
    status: 'failed',
    triggerInput: 'TSLA position threshold breach',
    steps: [
      { name: 'Validate Alert', state: 'complete' },
      { name: 'Analyze Position', state: 'failed' },
      { name: 'Notify', state: 'pending' },
    ],
    startedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
  },
];

export function PipelineView({ workspaceId }: PipelineViewProps) {
  const [filter, setFilter] = useState<PipelineFilter>('all');
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // Use mock data for now
  const allRuns = MOCK_RUNS;

  const filteredRuns = useMemo(() => {
    if (filter === 'all') return allRuns;
    return allRuns.filter((r) => r.status === filter);
  }, [allRuns, filter]);

  const counts = useMemo(() => ({
    all: allRuns.length,
    running: allRuns.filter((r) => r.status === 'running').length,
    completed: allRuns.filter((r) => r.status === 'completed').length,
    failed: allRuns.filter((r) => r.status === 'failed').length,
  }), [allRuns]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-mc-border flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-mc-text-secondary" />
            <span className="text-sm font-medium uppercase tracking-wider">Pipelines</span>
          </div>
          <PipelineFilters
            activeFilter={filter}
            onFilterChange={setFilter}
            counts={counts}
          />
        </div>
        <button
          onClick={() => setShowTemplatePicker(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-mc-accent text-mc-bg rounded text-sm font-medium hover:bg-mc-accent/90"
        >
          <Plus className="w-4 h-4" />
          New Workflow
        </button>
      </div>

      {/* Pipeline list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredRuns.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-mc-text-secondary">
              <GitBranch className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium mb-1">No {filter !== 'all' ? filter : ''} pipelines.</p>
              <p className="text-sm">Click + New Workflow to get started.</p>
            </div>
          </div>
        ) : (
          filteredRuns.map((run) => (
            <PipelineCard key={run.id} run={run} />
          ))
        )}
      </div>

      {/* Template Picker Modal */}
      {showTemplatePicker && (
        <WorkflowTemplatePicker
          onClose={() => setShowTemplatePicker(false)}
          onSelect={(template) => {
            // Will be wired to create a run in Task 6
            console.log('Selected template:', template.name);
            setShowTemplatePicker(false);
          }}
        />
      )}
    </div>
  );
}
