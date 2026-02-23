import { NextRequest, NextResponse } from 'next/server';
import { executeNextStep, startCompletionPoller, getRunStatus } from '@/lib/workflow-engine';

startCompletionPoller();

/**
 * POST /api/workflows/runs/[id]/execute
 * Execute the workflow run to completion (or until a review gate pauses it).
 * This is a long-lived request — it loops through steps, blocking on each
 * sub-agent until done, then advances to the next.
 *
 * Returns when: all steps done, run paused for review, run fails, or timeout.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: runId } = await params;
  const stepsExecuted: string[] = [];

  try {
    // Loop: keep executing steps until the run is no longer 'running'
    // Each executeNextStep call blocks until its sub-agent completes
    for (let i = 0; i < 20; i++) { // Safety cap: max 20 steps
      const status = getRunStatus(runId);
      if (!status || status !== 'running') break;

      const result = await executeNextStep(runId);
      if (!result.executed) break; // No more steps ready

      if (result.taskId) stepsExecuted.push(result.taskId);

      // Small delay between steps to let DB state settle
      await new Promise(r => setTimeout(r, 500));
    }

    const finalStatus = getRunStatus(runId);
    return NextResponse.json({
      executed: stepsExecuted.length > 0,
      stepsExecuted: stepsExecuted.length,
      runStatus: finalStatus,
    });
  } catch (error) {
    console.error(`[Execute] Failed for run ${runId}:`, error);
    return NextResponse.json(
      { error: 'Step execution failed', detail: String(error), stepsExecuted: stepsExecuted.length },
      { status: 500 }
    );
  }
}
