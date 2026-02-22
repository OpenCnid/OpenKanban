'use client';

import { useState, useEffect } from 'react';
import { Check, X, Clock, ChevronDown, ChevronUp, GitBranch, FileText, Loader2 } from 'lucide-react';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import type { Approval } from '@/lib/types';

interface ApprovalWithJoins extends Approval {
  workflow_name?: string;
  task_title?: string;
}

interface ApprovalCardProps {
  approval: ApprovalWithJoins;
  onApprove: (id: string, notes?: string) => Promise<void>;
  onReject: (id: string, notes?: string) => Promise<void>;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export function ApprovalCard({ approval, onApprove, onReject }: ApprovalCardProps) {
  const [expanded, setExpanded] = useState(approval.status === 'pending');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [deliverables, setDeliverables] = useState<Array<{ title: string; description?: string }>>([]);
  const [loadingDeliverables, setLoadingDeliverables] = useState(false);

  // Fetch deliverables when expanded (to show agent output)
  useEffect(() => {
    if (expanded && approval.source_task_id && deliverables.length === 0) {
      setLoadingDeliverables(true);
      fetch(`/api/tasks/${approval.source_task_id}/deliverables`)
        .then(r => r.ok ? r.json() : [])
        .then(d => setDeliverables(Array.isArray(d) ? d : []))
        .catch(() => {})
        .finally(() => setLoadingDeliverables(false));
    }
  }, [expanded, approval.source_task_id, deliverables.length]);

  const isPending = approval.status === 'pending';
  const statusColor = {
    pending: 'text-amber-400',
    approved: 'text-emerald-400',
    rejected: 'text-red-400',
  }[approval.status] || 'text-mc-text-secondary';

  const statusIcon = {
    pending: <Clock className="w-4 h-4" />,
    approved: <Check className="w-4 h-4" />,
    rejected: <X className="w-4 h-4" />,
  }[approval.status];

  const statusBorder = {
    pending: 'border-l-amber-500',
    approved: 'border-l-emerald-500',
    rejected: 'border-l-red-500',
  }[approval.status] || 'border-l-mc-border';

  const handleApprove = async () => {
    setLoading(true);
    try {
      await onApprove(approval.id, notes || undefined);
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    try {
      await onReject(approval.id, notes || undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`bg-mc-bg-secondary rounded-lg border border-mc-border border-l-4 ${statusBorder}`}>
      {/* Header */}
      <div
        className="flex items-start justify-between p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`flex items-center gap-1 text-xs font-medium ${statusColor}`}>
              {statusIcon}
              {approval.status.toUpperCase()}
            </span>
            <span className="text-xs text-mc-text-secondary">·</span>
            <span className="text-xs text-mc-text-secondary">{approval.type}</span>
          </div>
          <h3 className="font-medium text-sm truncate">{approval.title}</h3>
          {approval.workflow_name && (
            <div className="flex items-center gap-1 mt-1 text-xs text-mc-text-secondary">
              <GitBranch className="w-3 h-3" />
              {approval.workflow_name}
              {approval.task_title && ` · ${approval.task_title}`}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 ml-3">
          <span className="text-xs text-mc-text-secondary whitespace-nowrap">
            {timeAgo(approval.created_at)}
          </span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-mc-text-secondary" />
          ) : (
            <ChevronDown className="w-4 h-4 text-mc-text-secondary" />
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-mc-border/50 pt-3">
          {approval.description && (
            <p className="text-sm text-mc-text-secondary mb-3">{approval.description}</p>
          )}

          {/* Agent output from deliverables */}
          {loadingDeliverables && (
            <div className="flex items-center gap-2 text-sm text-mc-text-secondary mb-3">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading agent output...
            </div>
          )}
          {deliverables.map((d, i) => (
            <div key={i} className="bg-mc-bg rounded-lg border border-mc-border/30 p-4 mb-3">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-mc-accent" />
                <span className="text-xs font-medium text-mc-text">{d.title}</span>
              </div>
              {d.description && (
                <div className="max-h-[400px] overflow-y-auto">
                  <MarkdownContent content={d.description} />
                </div>
              )}
            </div>
          ))}

          {approval.content && (
            <div className="bg-mc-bg rounded-md p-3 mb-3 text-sm font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
              {approval.content}
            </div>
          )}

          {approval.resolution_notes && (
            <div className="text-sm text-mc-text-secondary italic mb-3">
              Notes: {approval.resolution_notes}
            </div>
          )}

          {approval.resolved_at && (
            <div className="text-xs text-mc-text-secondary mb-3">
              Resolved {timeAgo(approval.resolved_at)}
            </div>
          )}

          {isPending && (
            <div className="space-y-3">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes..."
                className="w-full bg-mc-bg border border-mc-border rounded-md p-2 text-sm text-mc-text placeholder:text-mc-text-secondary/50 resize-none"
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleApprove}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
                >
                  <Check className="w-4 h-4" />
                  Approve
                </button>
                <button
                  onClick={handleReject}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
                >
                  <X className="w-4 h-4" />
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
