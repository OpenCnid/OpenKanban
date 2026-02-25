---
title: Realtime System
domain: project
last-verified: 2026-02-25
status: current
---

# Realtime System

## Architecture

Two real-time channels:

1. **WebSocket** — OpenClaw Gateway connection (RequestFrame protocol v3)
   - Used by `src/lib/openclaw/client.ts`
   - Bidirectional: send commands, receive events
   - Auth via gateway token

2. **SSE (Server-Sent Events)** — UI real-time updates
   - Auto-reconnecting event stream
   - Pipeline status changes, agent activity, notifications
   - Lighter weight than WebSocket for one-way updates

## Gateway Client

`src/lib/openclaw/client.ts` wraps both WebSocket and HTTP:
- WebSocket for real-time events and session communication
- HTTP for `sessions_spawn` (HTTP-only, not available via WebSocket RPC)
- Auto-reconnect with exponential backoff

## Event Flow

```
OpenClaw Gateway
  ↓ WebSocket events
OpenKanban Gateway Client
  ↓ processes events
Zustand Store (state update)
  ↓ React re-render
UI Components (PipelineCard, LiveAgentsSidebar, etc.)
  ↓ SSE broadcast to other tabs/clients
```

## Key Implementation Files
- `src/lib/openclaw/client.ts` — Gateway WebSocket + HTTP client
- `src/app/api/sse/route.ts` — SSE endpoint
- `src/hooks/useRealtimeEvents.ts` — React hook for SSE consumption
- `docs/REALTIME_SPEC.md` (archived) — original detailed spec
