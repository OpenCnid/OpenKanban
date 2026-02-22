'use client';

import { GitBranch, Plus } from 'lucide-react';

interface PipelineViewProps {
  workspaceId: string;
}

export function PipelineView({ workspaceId }: PipelineViewProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-mc-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-mc-text-secondary" />
          <span className="text-sm font-medium uppercase tracking-wider">Pipelines</span>
        </div>
        <button
          className="flex items-center gap-2 px-3 py-1.5 bg-mc-accent text-mc-bg rounded text-sm font-medium hover:bg-mc-accent/90"
        >
          <Plus className="w-4 h-4" />
          New Workflow
        </button>
      </div>

      {/* Empty state */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-mc-text-secondary">
          <GitBranch className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium mb-1">No active pipelines.</p>
          <p className="text-sm">Click + New Workflow to get started.</p>
        </div>
      </div>
    </div>
  );
}
