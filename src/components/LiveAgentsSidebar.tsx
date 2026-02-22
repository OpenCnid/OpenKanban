'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ChevronRight, ChevronLeft, Loader2, Bot, Clock,
  CheckCircle, XCircle, Globe, Search, Code, Brain, FileText, Zap,
} from 'lucide-react';

interface AgentActivity {
  sessionKey: string;
  label: string;
  status: string;
  stepName: string;
  pipelineName: string;
  model: string;
  runtime: string;
  runtimeMs: number;
  totalTokens?: number;
  currentActivity?: string;
  activityType?: string;
  activityDetail?: string;
}

interface AgentData {
  active: AgentActivity[];
  recent: AgentActivity[];
  totalActive: number;
}

export function LiveAgentsSidebar() {
  const [data, setData] = useState<AgentData>({ active: [], recent: [], totalActive: 0 });
  const [isMinimized, setIsMinimized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/openclaw/agents');
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
    // Poll faster when agents are active
    const interval = setInterval(loadAgents, data.totalActive > 0 ? 5000 : 15000);
    return () => clearInterval(interval);
  }, [loadAgents, data.totalActive]);

  // SSE-driven refresh
  useEffect(() => {
    const handler = () => loadAgents();
    window.addEventListener('sse-event', handler);
    return () => window.removeEventListener('sse-event', handler);
  }, [loadAgents]);

  const activityIcon = (type?: string) => {
    switch (type) {
      case 'browsing': return <Globe className="w-3 h-3 text-blue-400" />;
      case 'searching': return <Search className="w-3 h-3 text-amber-400" />;
      case 'coding': return <Code className="w-3 h-3 text-green-400" />;
      case 'writing': return <FileText className="w-3 h-3 text-purple-400" />;
      case 'analyzing': return <Brain className="w-3 h-3 text-teal-400" />;
      default: return <Zap className="w-3 h-3 text-mc-text-secondary" />;
    }
  };

  return (
    <aside
      className={`bg-mc-bg-secondary border-r border-mc-border flex flex-col transition-all duration-300 ease-in-out ${
        isMinimized ? 'w-12' : 'w-72'
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
              {data.totalActive > 0 && (
                <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold bg-teal-500/20 text-teal-400 rounded-full leading-none animate-pulse">
                  {data.totalActive} active
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {isMinimized ? (
        <div className="flex-1 flex flex-col items-center pt-3 gap-2">
          {data.active.map((a, i) => (
            <div key={i} className="w-2.5 h-2.5 rounded-full bg-teal-400 animate-pulse" title={a.stepName} />
          ))}
          {data.active.length === 0 && (
            <div className="w-2.5 h-2.5 rounded-full bg-mc-text-secondary/20" />
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Active agents */}
          {data.active.length > 0 ? (
            <div className="p-3 space-y-2">
              {data.active.map((agent) => (
                <div
                  key={agent.sessionKey}
                  className="bg-mc-bg-tertiary/50 border border-teal-500/20 rounded-lg overflow-hidden cursor-pointer"
                  onClick={() => setExpandedAgent(expandedAgent === agent.sessionKey ? null : agent.sessionKey)}
                >
                  {/* Compact view */}
                  <div className="p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <Loader2 className="w-3 h-3 text-teal-400 animate-spin flex-shrink-0" />
                      <span className="text-xs font-medium text-mc-text truncate">{agent.stepName}</span>
                    </div>
                    <div className="text-[10px] text-mc-text-secondary/60 mb-1.5 truncate">
                      {agent.pipelineName}
                    </div>

                    {/* Current activity — the key feature */}
                    {agent.currentActivity && (
                      <div className="flex items-start gap-1.5 bg-mc-bg/50 rounded px-2 py-1.5 mb-1.5">
                        {activityIcon(agent.activityType)}
                        <span className="text-[11px] text-mc-text leading-snug line-clamp-2">
                          {agent.currentActivity}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-3 text-[10px] text-mc-text-secondary/40">
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" /> {agent.runtime}
                      </span>
                      <span>{agent.model}</span>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {expandedAgent === agent.sessionKey && (
                    <div className="border-t border-mc-border/20 px-2.5 py-2 bg-mc-bg/30 space-y-1.5">
                      {agent.activityDetail && (
                        <div className="text-[10px] text-mc-text-secondary break-all">
                          {agent.activityDetail}
                        </div>
                      )}
                      <div className="text-[10px] text-mc-text-secondary/40">
                        Session: {agent.label}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center">
              <Bot className="w-6 h-6 mx-auto text-mc-text-secondary/20 mb-2" />
              <p className="text-xs text-mc-text-secondary/50">
                {loading ? 'Loading...' : 'No agents active'}
              </p>
              <p className="text-[10px] text-mc-text-secondary/30 mt-1">
                Launch a mission to see agents work
              </p>
            </div>
          )}

          {/* Recently completed */}
          {data.recent.length > 0 && (
            <div className="p-3 border-t border-mc-border/30">
              <p className="text-[10px] uppercase text-mc-text-secondary/40 font-medium mb-2 tracking-wider">
                Recent
              </p>
              <div className="space-y-1">
                {data.recent.map((agent, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-mc-bg-tertiary/30 transition-colors">
                    {agent.status === 'done' || agent.status === 'completed'
                      ? <CheckCircle className="w-3 h-3 text-green-400/60 flex-shrink-0" />
                      : <XCircle className="w-3 h-3 text-red-400/60 flex-shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] text-mc-text-secondary/60 truncate block">{agent.stepName}</span>
                      <span className="text-[9px] text-mc-text-secondary/30">{agent.pipelineName}</span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="text-[10px] text-mc-text-secondary/30 block">{agent.runtime}</span>
                      {agent.totalTokens && (
                        <span className="text-[9px] text-mc-text-secondary/20">{(agent.totalTokens / 1000).toFixed(1)}k tok</span>
                      )}
                    </div>
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
