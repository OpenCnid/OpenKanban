import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import type { Alert } from '@/lib/types';

// GET /api/alerts - List alerts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const severity = searchParams.get('severity');
    const acknowledged = searchParams.get('acknowledged');
    const source = searchParams.get('source');
    const limit = searchParams.get('limit');

    let sql = 'SELECT * FROM alerts WHERE 1=1';
    const params: unknown[] = [];

    if (severity) {
      sql += ' AND severity = ?';
      params.push(severity);
    }

    if (acknowledged !== null && acknowledged !== undefined) {
      sql += ' AND acknowledged = ?';
      params.push(acknowledged === 'true' ? 1 : 0);
    }

    if (source) {
      sql += ' AND source = ?';
      params.push(source);
    }

    sql += ' ORDER BY created_at DESC';

    if (limit) {
      sql += ' LIMIT ?';
      params.push(parseInt(limit, 10));
    }

    const alerts = queryAll<Alert>(sql, params);

    // Parse metadata JSON and convert acknowledged to boolean
    const parsed = alerts.map((a) => ({
      ...a,
      acknowledged: Boolean(a.acknowledged),
      metadata: a.metadata && typeof a.metadata === 'string' ? JSON.parse(a.metadata as string) : a.metadata,
    }));

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('Failed to fetch alerts:', error);
    return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 });
  }
}

// POST /api/alerts - Inbound alert webhook
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { source, severity, title, message, product, channel, metadata } = body;

    if (!source || !title) {
      return NextResponse.json(
        { error: 'source and title are required' },
        { status: 400 }
      );
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    run(
      `INSERT INTO alerts (id, source, severity, title, message, product, channel, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        source,
        severity || 'info',
        title,
        message || null,
        product || null,
        channel || null,
        metadata ? JSON.stringify(metadata) : null,
        now,
      ]
    );

    const alert = {
      id,
      source,
      severity: severity || 'info',
      title,
      message: message || null,
      product: product || null,
      channel: channel || null,
      acknowledged: false,
      metadata: metadata || null,
      created_at: now,
    };

    // Broadcast via SSE so the dashboard updates in real time
    broadcast({
      type: 'alert_created',
      payload: alert,
    });

    return NextResponse.json({ id, created_at: now }, { status: 201 });
  } catch (error) {
    console.error('Failed to create alert:', error);
    return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 });
  }
}
