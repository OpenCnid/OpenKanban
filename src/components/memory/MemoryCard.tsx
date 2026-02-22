'use client';

import { useState } from 'react';
import { Clock, Tag, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

interface Memory {
  id: string;
  memory?: string;
  text?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
  score?: number;
}

interface MemoryCardProps {
  memory: Memory;
  onDelete?: (id: string) => void;
  showScore?: boolean;
}

export function MemoryCard({ memory, onDelete, showScore }: MemoryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const text = memory.memory || memory.text || '';
  const isLong = text.length > 200;
  const displayText = expanded || !isLong ? text : text.slice(0, 200) + '...';

  const timestamp = memory.updated_at || memory.created_at;
  const formattedTime = timestamp
    ? new Date(timestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(memory.id);
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div className="group p-4 bg-mc-bg-secondary border border-mc-border rounded-lg hover:border-mc-accent/30 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-mc-text leading-relaxed whitespace-pre-wrap">
            {displayText}
          </p>

          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1 flex items-center gap-1 text-xs text-mc-accent hover:text-mc-accent/80"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}

          <div className="flex items-center gap-3 mt-2">
            {formattedTime && (
              <span className="flex items-center gap-1 text-xs text-mc-text-secondary">
                <Clock className="w-3 h-3" />
                {formattedTime}
              </span>
            )}
            {showScore && memory.score != null && (
              <span className="flex items-center gap-1 text-xs text-mc-accent">
                <Tag className="w-3 h-3" />
                {(memory.score * 100).toFixed(0)}% match
              </span>
            )}
            {memory.metadata && Object.keys(memory.metadata).length > 0 && (
              <span className="text-xs text-mc-text-secondary/60">
                {Object.keys(memory.metadata).join(', ')}
              </span>
            )}
          </div>
        </div>

        {onDelete && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="opacity-0 group-hover:opacity-100 p-1.5 text-mc-text-secondary hover:text-red-400 hover:bg-red-400/10 rounded transition-all"
            title="Delete memory"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
