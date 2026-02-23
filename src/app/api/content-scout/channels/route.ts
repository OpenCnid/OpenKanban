import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import type { ChannelRecord } from '@/lib/content-scout/types';

const CHANNELS_FILE = path.join(process.cwd(), 'config', 'content-scout', 'channels.json');
const DISCOVERED_FILE = path.join(process.cwd(), 'content-vault', 'channels', 'discovered.json');
const REJECTED_FILE = path.join(process.cwd(), 'content-vault', 'channels', 'rejected.json');

function readJsonFile(filePath: string, fallback: any = null): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, data: any): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * GET /api/content-scout/channels
 *
 * Returns all channels: active watchlist + discovered (pending) + rejected.
 */
export async function GET() {
  const channelsData = readJsonFile(CHANNELS_FILE, { channels: [] });
  const discovered = readJsonFile(DISCOVERED_FILE, []);
  const rejected = readJsonFile(REJECTED_FILE, []);

  return NextResponse.json({
    active: channelsData.channels || [],
    discovered,
    rejected,
  });
}

/**
 * POST /api/content-scout/channels
 *
 * Add a channel to the watchlist, or approve/reject a discovered channel.
 * Body: { action: 'add' | 'approve' | 'reject', channel: ChannelRecord }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, channel } = body as { action: string; channel: ChannelRecord };

    if (!action || !channel?.id) {
      return NextResponse.json({ error: 'action and channel.id required' }, { status: 400 });
    }

    const channelsData = readJsonFile(CHANNELS_FILE, { channels: [] });
    const discovered = readJsonFile(DISCOVERED_FILE, []);
    const rejected = readJsonFile(REJECTED_FILE, []);

    switch (action) {
      case 'add': {
        // Add directly to watchlist
        channel.status = 'active';
        channel.addedAt = new Date().toISOString();
        channel.discoveredBy = 'manual';
        channelsData.channels.push(channel);
        writeJsonFile(CHANNELS_FILE, channelsData);
        break;
      }
      case 'approve': {
        // Move from discovered → active
        const idx = discovered.findIndex((c: any) => c.id === channel.id);
        if (idx >= 0) discovered.splice(idx, 1);
        channel.status = 'active';
        channelsData.channels.push(channel);
        writeJsonFile(CHANNELS_FILE, channelsData);
        writeJsonFile(DISCOVERED_FILE, discovered);
        break;
      }
      case 'reject': {
        // Move from discovered → rejected
        const idx = discovered.findIndex((c: any) => c.id === channel.id);
        if (idx >= 0) discovered.splice(idx, 1);
        channel.status = 'rejected';
        rejected.push(channel);
        writeJsonFile(DISCOVERED_FILE, discovered);
        writeJsonFile(REJECTED_FILE, rejected);
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true, action, channelId: channel.id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
