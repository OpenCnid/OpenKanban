import { NextRequest, NextResponse } from 'next/server';
import { cancelRun } from '@/lib/workflow-engine';

/**
 * POST /api/workflows/runs/[id]/cancel
 * Cancel a running or paused workflow run.
 * Kills any active sub-agent sessions and marks the run as cancelled.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await cancelRun(id);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'Run cancelled' });
  } catch (error) {
    console.error('Failed to cancel workflow run:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
