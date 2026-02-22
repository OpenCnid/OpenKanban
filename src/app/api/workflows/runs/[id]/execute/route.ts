import { NextRequest, NextResponse } from 'next/server';
import { executeNextStep, startCompletionPoller } from '@/lib/workflow-engine';

startCompletionPoller();

/**
 * POST /api/workflows/runs/[id]/execute
 * Execute the next step of a workflow run. This is a long-running request —
 * it blocks until the sub-agent completes (up to 5 minutes).
 *
 * Called by the client-side after creating a run, or by the workflow engine
 * itself to chain steps.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: runId } = await params;

  try {
    const result = await executeNextStep(runId);
    return NextResponse.json(result);
  } catch (error) {
    console.error(`[Execute] Failed for run ${runId}:`, error);
    return NextResponse.json(
      { error: 'Step execution failed', detail: String(error) },
      { status: 500 }
    );
  }
}
