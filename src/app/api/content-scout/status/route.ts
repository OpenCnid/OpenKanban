import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { queryOne } from '@/lib/db';

const APP_ROOT = path.resolve(process.cwd());
const STATE_FILE = path.join(APP_ROOT, 'tmp', '_pipeline_state.json');
const LOG_FILE = path.join(APP_ROOT, 'content-vault', 'processing-log.json');

/**
 * GET /api/content-scout/status
 *
 * Returns current pipeline state + recent processing stats.
 */
export async function GET() {
  const result: Record<string, any> = {
    running: false,
    runId: null,
    currentState: null,
    lastRun: null,
    todayStats: null,
  };

  const activeRun = queryOne<{ id: string }>(
    `SELECT id
     FROM workflow_runs
     WHERE status = 'running' AND trigger_method = 'content-scout'
     ORDER BY started_at DESC
     LIMIT 1`
  );
  if (activeRun?.id) {
    result.runId = activeRun.id;
  }

  // Check pipeline state
  if (fs.existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      const runningSteps = Object.values(state.steps || {}).filter(
        (s: any) => s.status === 'running'
      );
      result.running = runningSteps.length > 0;
      result.currentState = state;
    } catch {
      // Corrupt state file
    }
  }

  // Check processing log for last run + today's stats
  if (fs.existsSync(LOG_FILE)) {
    try {
      const log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
      result.lastRun = log.lastRun || null;

      const today = new Date().toISOString().split('T')[0];
      result.todayStats = log.dailyStats?.[today] || null;
    } catch {
      // Corrupt log
    }
  }

  return NextResponse.json(result);
}
