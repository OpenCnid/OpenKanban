import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * PATCH /api/notifications/:id — Mark notification as read/unread
 * Body: { read: boolean }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const body = await request.json();

  db.prepare('UPDATE notifications SET read = ? WHERE id = ?').run(body.read ? 1 : 0, id);

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/notifications/:id — Delete a notification
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  db.prepare('DELETE FROM notifications WHERE id = ?').run(id);

  return NextResponse.json({ success: true });
}
