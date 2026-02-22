'use client';

import { useState, useEffect } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { StatsCards } from './StatsCards';
import { ActivePipelinesWidget } from './ActivePipelinesWidget';
import { useMissionControl } from '@/lib/store';

interface DashboardHomeProps {
  workspaceId: string;
  onNavigateToPipelines: () => void;
}

export function DashboardHome({ workspaceId, onNavigateToPipelines }: DashboardHomeProps) {
  const { workflowRuns, workflowTemplates, agents, tasks } = useMissionControl();
  const [pendingApprovals, setPendingApprovals] = useState(0);

  // Fetch pending approval count
  useEffect(() => {
    async function fetchApprovalCount() {
      try {
        const res = await fetch(`/api/approvals?workspace_id=${workspaceId}&status=pending`);
        if (res.ok) {
          const data = await res.json();
          setPendingApprovals(data.length);
        }
      } catch {
        // Silently fail
      }
    }
    fetchApprovalCount();
  }, [workspaceId]);

  const activeRuns = workflowRuns.filter(r => r.status === 'running' || r.status === 'paused').length;
  const enabledTemplates = workflowTemplates.filter(t => t.enabled).length;
  const activeAgents = agents.filter(a => a.status !== 'offline').length;

  // Recent activity summary
  const recentTasks = tasks
    .filter(t => t.workflow_run_id)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 5);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-2">
          <LayoutDashboard className="w-5 h-5 text-mc-accent" />
          <h2 className="text-lg font-bold">OVERVIEW</h2>
        </div>

        {/* Stats */}
        <StatsCards
          activeRuns={activeRuns}
          pendingApprovals={pendingApprovals}
          templates={enabledTemplates}
          agents={activeAgents}
        />

        {/* Main content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active Pipelines — takes 2 columns */}
          <div className="lg:col-span-2">
            <ActivePipelinesWidget onNavigate={onNavigateToPipelines} />
          </div>

          {/* Recent Activity */}
          <div className="bg-mc-bg-secondary border border-mc-border rounded-lg p-6">
            <h3 className="font-bold mb-4 text-sm">Recent Step Activity</h3>
            {recentTasks.length === 0 ? (
              <p className="text-sm text-mc-text-secondary">No recent workflow activity.</p>
            ) : (
              <div className="space-y-2">
                {recentTasks.map((task) => {
                  const emojiMap: Record<string, string> = {
                    done: '✅',
                    in_progress: '🔄',
                    review: '🔍',
                    testing: '🧪',
                    inbox: '📥',
                  };
                  const statusEmoji = emojiMap[task.status] || '○';
                  return (
                    <div key={task.id} className="flex items-start gap-2 text-sm">
                      <span className="text-xs mt-0.5">{statusEmoji}</span>
                      <div className="flex-1 min-w-0">
                        <span className="truncate block">{task.title}</span>
                        <span className="text-[10px] text-mc-text-secondary">{task.status}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
