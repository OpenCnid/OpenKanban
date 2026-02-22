'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronLeft, Loader2, Bot, Clock, CheckCircle, XCircle } from 'lucide-react';

interface SubAgent {
  sessionKey?: string;
  label?: string;
  status?: string;
  task?: string;
  model?: string;
  runtime?: string;
  runtimeMs?: number;
  startedAt?: number;
  endedAt?: number;
  totalTokens?: number;
}

interface LiveAgentsSidebarProps {
  workspaceId?: string;
}

export function LiveAgentsSidebar({ workspaceId }: LiveAgentsSidebarProps) {
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [isMinimized, setIsMinimized] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadSubAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/openclaw/sessions');
      if (res.ok) {
        const data = await res.json();
        setSubAgents(Array.isArray(data) ? data : []);
      }
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubAgents();
    const interval = setInterval(loadSubAgents, 8000);
    return () => clearInterval(interval);
  }, [loadSubAgents]);

  // SSE-driven refresh
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const type = detail.type || '';
      if (type.includes('task') || type.includes('workflow') || type.includes('session')) {
        loadSubAgents();
      }
    };
    window.addEventListener('sse-event', handler);
    return () => window.removeEventListener('sse-event', handler);
  }, [loadSubAgents]);

  const activeAgents = subAgents.filter(a => a.status === 'running' || a.status === 'active');
  const recentAgents = subAgents.filter(a => a.status === 'done' || a.status === 'completed').slice(0, 5);

  const getStatusIcon = (agent: SubAgent) => {
    if (agent.status === 'done' || agent.status === 'completed') return <CheckCircle className="w-3 h-3 text-green-400" />;
    if (agent.status === 'failed' || agent.status === 'error') return <XCircle className="w-3 h-3 text-red-400" />;
    return <Loader2 className="w-3 h-3 text-teal-400 animate-spin" />;
  };

  const getTaskSummary = (agent: SubAgent): string => {
    // Extract the step name from the task prompt
    if (agent.task) {
      // Tasks start with "## Workflow Step: Market Data Pull\n**Pipeline:**..."
      const stepMatch = agent.task.match(/Workflow Step:\s*([^\n*]+)/);
      if (stepMatch) return stepMatch[1].trim();

      // Fallback: first meaningful line
      const firstLine = agent.task.split('\n')[0].replace(/^#+\s*/, '').trim();
      if (firstLine.length > 3) return firstLine.length > 50 ? firstLine.slice(0, 47) + '...' : firstLine;
    }

    // Parse label: wf-abc123-step0 → "Step 1"
    if (agent.label) {
      const stepMatch = agent.label.match(/step(\d+)$/);
      if (stepMatch) return `Step ${parseInt(stepMatch[1]) + 1}`;
      if (agent.label.includes('chat')) return 'Chat';
      return agent.label;
    }
    return 'Working...';
  };

  const getModelShort = (agent: SubAgent): string => {
    if (!agent.model) return '';
    const parts = agent.model.split('/');
    const name = parts[parts.length - 1];
    if (name.includes('sonnet')) return 'sonnet';
    if (name.includes('opus')) return 'opus';
    return name;
  };

  return (
    <aside
      className={`bg-mc-bg-secondary border-r border-mc-border flex flex-col transition-all duration-300 ease-in-out ${
        isMinimized ? 'w-12' : 'w-64'
      }`}
    >
      {/* Header */}
      <div className="p-3 border-b border-mc-border">
        <div className="flex items-center">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text transition-colors"
          >
            {isMinimized ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
          {!isMinimized && (
            <>
              <span className="text-sm font-medium uppercase tracking-wider">Agents</span>
              {activeAgents.length > 0 && (
                <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold bg-teal-500/20 text-teal-400 rounded-full leading-none">
                  {activeAgents.length}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {isMinimized ? (
        <div className="flex-1 flex flex-col items-center pt-3 gap-2">
          {activeAgents.map((agent, i) => (
            <div key={i} className="w-2.5 h-2.5 rounded-full bg-teal-400 animate-pulse" title={getTaskSummary(agent)} />
          ))}
          {activeAgents.length === 0 && (
            <div className="w-2.5 h-2.5 rounded-full bg-mc-text-secondary/20" title="No active agents" />
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Active agents */}
          {activeAgents.length > 0 ? (
            <div className="p-3">
              <p className="text-[10px] uppercase text-mc-text-secondary/50 font-medium mb-2 tracking-wider">Working</p>
              <div className="space-y-2">
                {activeAgents.map((agent, i) => (
                  <div key={i} className="p-2.5 bg-mc-bg-tertiary/50 border border-mc-border/30 rounded-lg">
                    <div className="flex items-start gap-2">
                      {getStatusIcon(agent)}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-mc-text leading-snug font-medium">{getTaskSummary(agent)}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="flex items-center gap-0.5 text-[10px] text-mc-text-secondary/50">
                            <Clock className="w-2.5 h-2.5" />
                            {agent.runtime || '...'}
                          </span>
                          {agent.model && (
                            <span className="text-[10px] text-mc-text-secondary/40">{getModelShort(agent)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-4 text-center">
              <Bot className="w-6 h-6 mx-auto text-mc-text-secondary/20 mb-2" />
              <p className="text-xs text-mc-text-secondary/50">
                {loading ? 'Loading...' : 'No agents active'}
              </p>
            </div>
          )}

          {/* Recently completed */}
          {recentAgents.length > 0 && (
            <div className="p-3 border-t border-mc-border/30">
              <p className="text-[10px] uppercase text-mc-text-secondary/40 font-medium mb-2 tracking-wider">Recent</p>
              <div className="space-y-1.5">
                {recentAgents.map((agent, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded text-mc-text-secondary/60">
                    {getStatusIcon(agent)}
                    <span className="text-[11px] truncate flex-1">{getTaskSummary(agent)}</span>
                    <span className="text-[10px] text-mc-text-secondary/30">{agent.runtime}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
