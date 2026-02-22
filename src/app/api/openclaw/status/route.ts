import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { startCompletionPoller } from '@/lib/workflow-engine';

// Ensure poller starts when this module loads (hit on every page load)
startCompletionPoller();

// GET /api/openclaw/status - Check OpenClaw connection status
export async function GET() {
  // Ensure poller on every request too (survives HMR)
  startCompletionPoller();

  try {
    const client = getOpenClawClient();

    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch (err) {
        return NextResponse.json({
          connected: false,
          error: 'Failed to connect to OpenClaw Gateway',
          gateway_url: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
        });
      }
    }

    try {
      const sessions = await client.listSubagents({ recentMinutes: 60 });
      return NextResponse.json({
        connected: true,
        active_subagents: Array.isArray(sessions)
          ? sessions.filter((s: Record<string, unknown>) => s.status === 'running' || s.status === 'active').length
          : 0,
        gateway_url: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
      });
    } catch (err) {
      return NextResponse.json({
        connected: true,
        active_subagents: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
        gateway_url: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
      });
    }
  } catch (error) {
    console.error('OpenClaw status check failed:', error);
    return NextResponse.json(
      { connected: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
