'use client';

import { GitBranch, ShieldCheck, Zap, Users } from 'lucide-react';

interface StatsCardsProps {
  activeRuns: number;
  pendingApprovals: number;
  templates: number;
  agents: number;
}

const cards = [
  { key: 'activeRuns', label: 'Active Pipelines', icon: GitBranch, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  { key: 'pendingApprovals', label: 'Pending Approvals', icon: ShieldCheck, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  { key: 'templates', label: 'Templates', icon: Zap, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  { key: 'agents', label: 'Agents', icon: Users, color: 'text-purple-400', bg: 'bg-purple-500/10' },
] as const;

export function StatsCards({ activeRuns, pendingApprovals, templates, agents }: StatsCardsProps) {
  const values: Record<string, number> = { activeRuns, pendingApprovals, templates, agents };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.key}
            className="bg-mc-bg-secondary border border-mc-border rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`p-2 rounded-lg ${card.bg}`}>
                <Icon className={`w-4 h-4 ${card.color}`} />
              </div>
            </div>
            <div className="text-2xl font-bold">{values[card.key]}</div>
            <div className="text-xs text-mc-text-secondary mt-1">{card.label}</div>
          </div>
        );
      })}
    </div>
  );
}
