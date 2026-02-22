'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Filter } from 'lucide-react';
import { ApprovalCard } from './ApprovalCard';
import type { Approval } from '@/lib/types';

interface ApprovalWithJoins extends Approval {
  workflow_name?: string;
  task_title?: string;
}

interface ApprovalsListProps {
  workspaceId: string;
  onCountChange?: (pendingCount: number) => void;
}

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

export function ApprovalsList({ workspaceId, onCountChange }: ApprovalsListProps) {
  const [approvals, setApprovals] = useState<ApprovalWithJoins[]>([]);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [loading, setLoading] = useState(true);

  const fetchApprovals = useCallback(async () => {
    try {
      const params = new URLSearchParams({ workspace_id: workspaceId });
      if (filter !== 'all') params.set('status', filter);
      const res = await fetch(`/api/approvals?${params}`);
      if (res.ok) {
        const data = await res.json();
        setApprovals(data);
        // Count pending for badge
        const pendingCount = data.filter((a: ApprovalWithJoins) => a.status === 'pending').length;
        onCountChange?.(pendingCount);
      }
    } catch (err) {
      console.error('[Approvals] Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, filter, onCountChange]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  // Listen for SSE approval events
  useEffect(() => {
    const handleSSE = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.type === 'approval_created' || detail?.type === 'approval_updated') {
        fetchApprovals();
      }
    };
    window.addEventListener('sse-event', handleSSE);
    return () => window.removeEventListener('sse-event', handleSSE);
  }, [fetchApprovals]);

  const handleApprove = async (id: string, notes?: string) => {
    const res = await fetch(`/api/approvals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', resolution_notes: notes }),
    });
    if (res.ok) {
      await fetchApprovals();
    }
  };

  const handleReject = async (id: string, notes?: string) => {
    const res = await fetch(`/api/approvals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected', resolution_notes: notes }),
    });
    if (res.ok) {
      await fetchApprovals();
    }
  };

  const pendingCount = approvals.filter(a => a.status === 'pending').length;
  const filters: { id: FilterStatus; label: string; count?: number }[] = [
    { id: 'all', label: 'All', count: approvals.length },
    { id: 'pending', label: 'Pending', count: pendingCount },
    { id: 'approved', label: 'Approved' },
    { id: 'rejected', label: 'Rejected' },
  ];

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-mc-text-secondary animate-pulse">Loading approvals...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-mc-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-mc-accent" />
            <h2 className="text-lg font-bold">APPROVALS</h2>
            {pendingCount > 0 && (
              <span className="px-2 py-0.5 text-xs font-bold bg-amber-500/20 text-amber-400 rounded-full">
                {pendingCount} pending
              </span>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1">
          <Filter className="w-3.5 h-3.5 text-mc-text-secondary mr-1" />
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                filter === f.id
                  ? 'bg-mc-accent/20 text-mc-accent'
                  : 'text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg'
              }`}
            >
              {f.label}
              {f.count !== undefined && f.count > 0 && (
                <span className="ml-1 opacity-70">{f.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Approval Cards */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {approvals.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-mc-text-secondary">
            <ShieldCheck className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-lg font-medium">
              {filter === 'pending' ? 'No pending approvals' : 'No approvals found'}
            </p>
            <p className="text-sm mt-1">
              {filter === 'pending'
                ? 'Pipeline review steps will appear here.'
                : 'Approvals from pipeline runs will appear here.'}
            </p>
          </div>
        ) : (
          approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))
        )}
      </div>
    </div>
  );
}
