import { NextRequest, NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { getDb } from '@/lib/db';

/**
 * GET /api/search — Global search across memories + local data
 * Query params:
 *   q: search query (required)
 *   limit: max results per source (default: 5)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const limit = parseInt(searchParams.get('limit') || '5', 10);

  if (!query || query.trim().length === 0) {
    return NextResponse.json({ error: 'q parameter is required' }, { status: 400 });
  }

  const results: {
    memories: unknown[];
    workflows: unknown[];
    tasks: unknown[];
    approvals: unknown[];
  } = {
    memories: [],
    workflows: [],
    tasks: [],
    approvals: [],
  };

  // Search memories via OpenClaw (non-blocking — gracefully degrade if unavailable)
  const memoryPromise = (async () => {
    try {
      const client = getOpenClawClient();
      results.memories = await client.searchMemory(query, { limit, scope: 'all' });
    } catch {
      // OpenClaw unavailable — skip memory results
    }
  })();

  // Search local SQLite data
  const db = getDb();
  const likeQuery = `%${query}%`;

  try {
    // Workflow templates
    results.workflows = db.prepare(
      `SELECT id, name, description, icon, trigger_type, created_at
       FROM workflow_templates
       WHERE (name LIKE ? OR description LIKE ?) AND enabled = 1
       LIMIT ?`
    ).all(likeQuery, likeQuery, limit) as unknown[];

    // Tasks
    results.tasks = db.prepare(
      `SELECT id, title, description, status, priority, created_at
       FROM tasks
       WHERE title LIKE ? OR description LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(likeQuery, likeQuery, limit) as unknown[];

    // Approvals
    results.approvals = db.prepare(
      `SELECT a.id, a.status, a.title as task_title, a.created_at,
              wt.name as workflow_name
       FROM approvals a
       LEFT JOIN workflow_runs wr ON a.workflow_run_id = wr.id
       LEFT JOIN workflow_templates wt ON wr.template_id = wt.id
       WHERE a.title LIKE ? OR wt.name LIKE ? OR a.description LIKE ?
       ORDER BY a.created_at DESC
       LIMIT ?`
    ).all(likeQuery, likeQuery, likeQuery, limit) as unknown[];
  } catch (error) {
    console.error('[Search API] SQL error:', error);
    // Return whatever we have — partial results are better than nothing
  }

  // Wait for memory search to complete
  await memoryPromise;

  return NextResponse.json(results);
}
