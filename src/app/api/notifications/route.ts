import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * GET /api/notifications — List notifications
 * Query params:
 *   unread: 'true' to filter unread only
 *   limit: max results (default: 50)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get('unread') === 'true';
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  const db = getDb();

  let query = 'SELECT * FROM notifications';
  const params: unknown[] = [];

  if (unreadOnly) {
    query += ' WHERE read = 0';
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const notifications = db.prepare(query).all(...params);
  
  // Also get unread count
  const countRow = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE read = 0').get() as { count: number };

  return NextResponse.json({
    notifications,
    unreadCount: countRow.count,
  });
}
