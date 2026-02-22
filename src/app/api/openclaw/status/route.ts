import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';

// GET /api/openclaw/status - Check OpenClaw connection status
export async function GET() {
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

    // Verify connection by listing sessions via HTTP tool invoke
    try {
      const sessions = await client.listSubagents({ recentMinutes: 60 });
      return NextResponse.json({
        connected: true,
        active_subagents: Array.isArray(sessions) ? sessions.length : 0,
        gateway_url: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
      });
    } catch (err) {
      // Even if listing fails, the connection itself is up
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
      {
        connected: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
