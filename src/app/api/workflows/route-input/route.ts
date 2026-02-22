import { NextRequest, NextResponse } from 'next/server';
import { routeInput } from '@/lib/workflow-router';

// POST /api/workflows/route-input — route natural language to a template
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { input, workspace_id } = body;

  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return NextResponse.json({ error: 'input is required' }, { status: 400 });
  }

  try {
    const result = await routeInput(input.trim(), workspace_id || 'default');
    return NextResponse.json(result);
  } catch (err) {
    console.error('[RouteInput] Failed:', err);
    return NextResponse.json(
      { error: `Routing failed: ${err instanceof Error ? err.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
