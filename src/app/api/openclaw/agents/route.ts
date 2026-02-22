import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface AgentActivity {
  sessionKey: string;
  label: string;
  status: 'running' | 'done' | 'failed';
  stepName: string;
  pipelineName: string;
  task: string;
  model: string;
  runtime: string;
  runtimeMs: number;
  totalTokens?: number;
  startedAt: number;
  endedAt?: number;
  // Live activity from session history
  currentActivity?: string;
  activityType?: 'browsing' | 'searching' | 'coding' | 'analyzing' | 'writing' | 'idle';
  activityDetail?: string;
}

function parseTaskPrompt(task: string, label: string): { stepName: string; pipelineName: string } {
  const stepMatch = task.match(/Workflow Step:\s*([^\n*]+)/);
  const pipelineMatch = task.match(/Pipeline:\s*([^\n*]+)/);

  let stepName = stepMatch ? stepMatch[1].trim() : '';
  const pipelineName = pipelineMatch ? pipelineMatch[1].trim() : '';

  // Fallback: parse label like wf-abc123-step0
  if (!stepName) {
    const labelMatch = label.match(/step(\d+)$/);
    if (labelMatch) stepName = `Step ${parseInt(labelMatch[1]) + 1}`;
    else if (label.includes('chat')) stepName = 'Chat';
    else stepName = label || 'Agent';
  }

  return { stepName, pipelineName };
}

function parseActivity(messages: unknown[]): { currentActivity: string; activityType: string; activityDetail: string } {
  // Look at the last few messages for tool calls
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    const content = msg.content;

    if (Array.isArray(content)) {
      for (const block of content) {
        const b = block as Record<string, unknown>;

        if (b.type === 'tool_use' || b.type === 'toolCall') {
          const name = String(b.name || '');
          const rawInput = b.input || b.arguments;
          const input: Record<string, unknown> = typeof rawInput === 'string'
            ? (() => { try { return JSON.parse(rawInput); } catch { return {}; } })()
            : (rawInput as Record<string, unknown>) || {};

          if (name === 'web_fetch' || name === 'Read') {
            const url = String(input.url || input.path || '');
            const domain = url.match(/https?:\/\/([^/]+)/)?.[1] || url;
            return {
              currentActivity: `Browsing ${domain}`,
              activityType: 'browsing',
              activityDetail: url.slice(0, 120),
            };
          }
          if (name === 'web_search') {
            return {
              currentActivity: `Searching: "${input.query || ''}"`,
              activityType: 'searching',
              activityDetail: String(input.query || ''),
            };
          }
          if (name === 'exec') {
            const cmd = String(input.command || '').slice(0, 60);
            return {
              currentActivity: `Running: ${cmd}`,
              activityType: 'coding',
              activityDetail: cmd,
            };
          }
          if (name === 'Write' || name === 'Edit') {
            const path = String(input.path || input.file_path || '');
            return {
              currentActivity: `Writing ${path.split('/').pop() || 'file'}`,
              activityType: 'writing',
              activityDetail: path,
            };
          }
          if (name === 'browser') {
            const url = String(input.targetUrl || input.url || '');
            return {
              currentActivity: `Browser: ${url ? url.split('/').slice(0, 3).join('/') : input.action || 'navigating'}`,
              activityType: 'browsing',
              activityDetail: url || String(input.action || ''),
            };
          }
          // Generic tool
          return {
            currentActivity: `Using ${name}`,
            activityType: 'analyzing',
            activityDetail: name,
          };
        }

        // Thinking block — shows the agent's reasoning
        if (b.type === 'thinking' && b.thinking) {
          const text = String(b.thinking);
          const lastLine = text.split('\n').filter((l: string) => l.trim()).pop() || text;
          return {
            currentActivity: lastLine.slice(0, 80) + (lastLine.length > 80 ? '...' : ''),
            activityType: 'analyzing',
            activityDetail: lastLine.slice(0, 200),
          };
        }

        // Assistant text
        if (b.type === 'text' && msg.role === 'assistant') {
          const text = String(b.text || '');
          if (text.length > 10) {
            return {
              currentActivity: text.slice(0, 80) + (text.length > 80 ? '...' : ''),
              activityType: 'analyzing',
              activityDetail: text.slice(0, 200),
            };
          }
        }
      }
    }

    // String content from assistant
    if (msg.role === 'assistant' && typeof content === 'string' && content.length > 10) {
      return {
        currentActivity: content.slice(0, 80) + (content.length > 80 ? '...' : ''),
        activityType: 'analyzing',
        activityDetail: content.slice(0, 200),
      };
    }
  }

  return {
    currentActivity: 'Processing...',
    activityType: 'analyzing',
    activityDetail: '',
  };
}

// GET /api/openclaw/agents — Detailed agent activity with live status
export async function GET() {
  try {
    const client = getOpenClawClient();
    if (!client.isConnected()) {
      try { await client.connect(); } catch { return NextResponse.json({ active: [], recent: [] }); }
    }

    const subagents = await client.listSubagents({ recentMinutes: 30 });
    const active: AgentActivity[] = [];
    const recent: AgentActivity[] = [];

    for (const raw of subagents) {
      const agent = raw as Record<string, unknown>;
      const { stepName, pipelineName } = parseTaskPrompt(String(agent.task || ''), String(agent.label || ''));
      const isRunning = agent.status === 'running' || agent.status === 'active';

      // Try to look up pipeline name from DB if not in prompt
      let resolvedPipeline = pipelineName;
      if (!resolvedPipeline) {
        const labelPrefix = String(agent.label || '').match(/^wf-([a-f0-9]+)-/)?.[1];
        if (labelPrefix) {
          try {
            const run = queryOne<{ name: string }>(
              `SELECT name FROM workflow_runs WHERE id LIKE ?`,
              [`${labelPrefix}%`]
            );
            if (run) resolvedPipeline = run.name;
          } catch { /* silent */ }
        }
      }

      const activity: AgentActivity = {
        sessionKey: String(agent.sessionKey || ''),
        label: String(agent.label || ''),
        status: (agent.status as 'running' | 'done' | 'failed') || 'running',
        stepName,
        pipelineName: resolvedPipeline || 'Pipeline',
        task: String(agent.task || ''),
        model: String(agent.model || '').split('/').pop() || 'unknown',
        runtime: String(agent.runtime || ''),
        runtimeMs: Number(agent.runtimeMs || 0),
        totalTokens: agent.totalTokens ? Number(agent.totalTokens) : undefined,
        startedAt: Number(agent.startedAt || 0),
        endedAt: agent.endedAt ? Number(agent.endedAt) : undefined,
      };

      // For running agents, fetch live activity from session history
      if (isRunning && activity.sessionKey) {
        try {
          const history = await client.getSubagentHistory(activity.sessionKey, { limit: 3, includeTools: true });
          const parsed = parseActivity(history);
          activity.currentActivity = parsed.currentActivity;
          activity.activityType = parsed.activityType as AgentActivity['activityType'];
          activity.activityDetail = parsed.activityDetail;
        } catch {
          activity.currentActivity = 'Working...';
          activity.activityType = 'analyzing';
        }
        active.push(activity);
      } else {
        recent.push(activity);
      }
    }

    return NextResponse.json({
      active,
      recent: recent.slice(0, 5),
      totalActive: active.length,
      totalRecent: recent.length,
    });
  } catch (error) {
    console.error('Failed to get agent activity:', error);
    return NextResponse.json({ active: [], recent: [], totalActive: 0, totalRecent: 0 });
  }
}
