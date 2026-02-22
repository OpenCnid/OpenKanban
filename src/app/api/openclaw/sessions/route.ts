import { NextRequest, NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';

export const dynamic = 'force-dynamic';

// GET /api/openclaw/sessions - List live sub-agents from OpenClaw
export async function GET(request: NextRequest) {
  try {
    const client = getOpenClawClient();

    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch {
        return NextResponse.json([], { status: 200 });
      }
    }

    // Get active sub-agents via HTTP tool invoke
    const subagents = await client.listSubagents({ recentMinutes: 60 });
    return NextResponse.json(Array.isArray(subagents) ? subagents : []);
  } catch (error) {
    console.error('Failed to list sessions:', error);
    // Return empty array instead of error — sidebar should degrade gracefully
    return NextResponse.json([]);
  }
}
