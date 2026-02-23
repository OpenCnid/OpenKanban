import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const APP_ROOT = path.resolve(process.cwd());
const VENV_PYTHON = path.join(APP_ROOT, '.venv', 'bin', 'python');
const PIPELINE_SCRIPT = path.join(APP_ROOT, 'scripts', 'content-scout', 'run_pipeline.py');
const STATE_FILE = path.join(APP_ROOT, 'tmp', '_pipeline_state.json');

/**
 * POST /api/content-scout/trigger
 *
 * Trigger a Content Scout pipeline run.
 * Body: { videoUrl?: string, dryRun?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { videoUrl, dryRun } = body as { videoUrl?: string; dryRun?: boolean };

    // Check if pipeline is already running
    if (fs.existsSync(STATE_FILE)) {
      try {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        const runningSteps = Object.values(state.steps || {}).filter(
          (s: any) => s.status === 'running'
        );
        if (runningSteps.length > 0) {
          return NextResponse.json(
            { error: 'Pipeline is already running', state },
            { status: 409 }
          );
        }
      } catch {
        // Corrupt state file — allow new run
      }
    }

    // Build command
    const args = [PIPELINE_SCRIPT];
    if (videoUrl) args.push('--video-url', videoUrl);
    if (dryRun) args.push('--dry-run');

    // Spawn detached so it runs independently of this request
    const child = spawn(VENV_PYTHON, args, {
      cwd: APP_ROOT,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PYTHONPATH: path.join(APP_ROOT, 'scripts', 'content-scout'),
      },
    });

    child.unref();

    return NextResponse.json({
      ok: true,
      message: dryRun ? 'Dry run started' : 'Pipeline started',
      pid: child.pid,
      videoUrl: videoUrl || null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to trigger pipeline' },
      { status: 500 }
    );
  }
}
