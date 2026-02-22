import { NextRequest, NextResponse } from 'next/server';
import { queryOne, run } from '@/lib/db';
import type { Alert } from '@/lib/types';

// PATCH /api/alerts/[id] - Acknowledge an alert
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = queryOne<Alert>('SELECT * FROM alerts WHERE id = ?', [id]);
    if (!existing) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.acknowledged !== undefined) {
      updates.push('acknowledged = ?');
      values.push(body.acknowledged ? 1 : 0);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    values.push(id);
    run(`UPDATE alerts SET ${updates.join(', ')} WHERE id = ?`, values);

    const updated = queryOne<Alert>('SELECT * FROM alerts WHERE id = ?', [id]);
    if (updated) {
      return NextResponse.json({
        ...updated,
        acknowledged: Boolean(updated.acknowledged),
        metadata: updated.metadata && typeof updated.metadata === 'string'
          ? JSON.parse(updated.metadata as string)
          : updated.metadata,
      });
    }

    return NextResponse.json({ id });
  } catch (error) {
    console.error('Failed to update alert:', error);
    return NextResponse.json({ error: 'Failed to update alert' }, { status: 500 });
  }
}

// DELETE /api/alerts/[id] - Delete an alert
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = queryOne<Alert>('SELECT * FROM alerts WHERE id = ?', [id]);

    if (!existing) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    run('DELETE FROM alerts WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete alert:', error);
    return NextResponse.json({ error: 'Failed to delete alert' }, { status: 500 });
  }
}
