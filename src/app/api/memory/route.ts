import { NextRequest, NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';

/**
 * GET /api/memory — List or search memories
 * Query params:
 *   q: search query (if provided, searches; otherwise lists all)
 *   scope: 'session' | 'long-term' | 'all' (default: 'long-term')
 *   limit: max results for search (default: 20)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const scope = (searchParams.get('scope') as 'session' | 'long-term' | 'all') || 'long-term';
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  const client = getOpenClawClient();

  try {
    let memories: unknown[];

    if (query) {
      memories = await client.searchMemory(query, { limit, scope });
    } else {
      memories = await client.listMemories({ scope });
    }

    return NextResponse.json(memories);
  } catch (error) {
    console.error('[Memory API] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch memories', detail: String(error) },
      { status: 502 }
    );
  }
}

/**
 * POST /api/memory — Store a new memory
 * Body: { text: string, longTerm?: boolean, metadata?: object }
 */
export async function POST(request: NextRequest) {
  const client = getOpenClawClient();
  const body = await request.json();
  const { text, longTerm = true, metadata } = body;

  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }

  try {
    const result = await client.storeMemory(text, { longTerm, metadata });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Memory API] Store failed:', error);
    return NextResponse.json(
      { error: 'Failed to store memory', detail: String(error) },
      { status: 502 }
    );
  }
}

/**
 * DELETE /api/memory — Delete a memory
 * Body: { memoryId?: string, query?: string }
 */
export async function DELETE(request: NextRequest) {
  const client = getOpenClawClient();
  const body = await request.json();
  const { memoryId, query } = body;

  if (!memoryId && !query) {
    return NextResponse.json({ error: 'memoryId or query is required' }, { status: 400 });
  }

  try {
    const result = await client.deleteMemory({ memoryId, query });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Memory API] Delete failed:', error);
    return NextResponse.json(
      { error: 'Failed to delete memory', detail: String(error) },
      { status: 502 }
    );
  }
}
