import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * POST /api/notifications/read-all — Mark all notifications as read
 */
export async function POST() {
  const db = getDb();
  const result = db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();

  return NextResponse.json({ 
    success: true, 
    marked: result.changes,
  });
}
