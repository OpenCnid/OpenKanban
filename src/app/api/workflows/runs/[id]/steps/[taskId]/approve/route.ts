import { NextRequest, NextResponse } from 'next/server';
import { approveStep } from '@/lib/workflow-engine';

/**
 * POST /api/workflows/runs/[id]/steps/[taskId]/approve
 * Approve a step that's in review status.
 * Marks the step as done and advances the pipeline to the next step.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const body = await request.json().catch(() => ({}));

    const result = await approveStep(taskId, body.notes);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'Step approved, pipeline advancing' });
  } catch (error) {
    console.error('Failed to approve step:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
