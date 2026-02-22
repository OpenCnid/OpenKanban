import { NextRequest, NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';

/**
 * GET /api/memory/:id — Get a specific memory by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const client = getOpenClawClient();

  try {
    const memory = await client.getMemory(id);
    return NextResponse.json(memory);
  } catch (error) {
    console.error('[Memory API] Get failed:', error);
    return NextResponse.json(
      { error: 'Failed to get memory', detail: String(error) },
      { status: 502 }
    );
  }
}

/**
 * DELETE /api/memory/:id — Delete a specific memory by ID
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const client = getOpenClawClient();

  try {
    const result = await client.deleteMemory({ memoryId: id });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Memory API] Delete failed:', error);
    return NextResponse.json(
      { error: 'Failed to delete memory', detail: String(error) },
      { status: 502 }
    );
  }
}
