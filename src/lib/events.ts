/**
 * Server-Sent Events (SSE) broadcaster for real-time updates
 * Manages client connections and broadcasts events to all listeners.
 * Also persists events to the database for the live feed.
 */

import { v4 as uuidv4 } from 'uuid';
import { run as dbRun } from './db';
import type { SSEEvent } from './types';

// Store active SSE client connections
const clients = new Set<ReadableStreamDefaultController>();

export function registerClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller);
}

export function unregisterClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller);
}

/**
 * Broadcast an event to all connected SSE clients + persist to DB.
 */
export function broadcast(event: SSEEvent): void {
  const encoder = new TextEncoder();
  const data = `data: ${JSON.stringify(event)}\n\n`;
  const encoded = encoder.encode(data);

  // Send to all connected clients
  const clientsArray = Array.from(clients);
  for (const client of clientsArray) {
    try {
      client.enqueue(encoded);
    } catch {
      clients.delete(client);
    }
  }

  // Persist to events table for the live feed
  try {
    const id = uuidv4();
    const now = new Date().toISOString();

    const payload = event.payload as Record<string, unknown> | undefined;
    let message = event.type.replace(/_/g, ' ');

    if (payload) {
      if (payload.title) message = String(payload.title);
      else if (payload.name) message = String(payload.name);

      if (payload.status) message += ` — ${payload.status}`;
      if (payload.outcome) message = String(payload.outcome);
    }

    dbRun(
      `INSERT INTO events (id, type, message, created_at) VALUES (?, ?, ?, ?)`,
      [id, event.type, message, now]
    );
  } catch (err) {
    // DB not ready or table doesn't exist yet
    console.warn('[Events] Failed to persist event:', err instanceof Error ? err.message : err);
  }
}

export function getActiveConnectionCount(): number {
  return clients.size;
}
