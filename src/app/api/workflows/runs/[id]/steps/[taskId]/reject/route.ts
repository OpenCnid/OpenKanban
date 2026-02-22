import { NextRequest, NextResponse } from 'next/server';
import { rejectStep } from '@/lib/workflow-engine';

/**
 * POST /api/workflows/runs/[id]/steps/[taskId]/reject
 * Reject a step that's in review status.
 * Fails the entire workflow run.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const body = await request.json().catch(() => ({}));

    const result = await rejectStep(taskId, body.notes);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'Step rejected, pipeline failed' });
  } catch (error) {
    console.error('Failed to reject step:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
