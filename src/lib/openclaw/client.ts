// OpenClaw Gateway WebSocket Client

import { EventEmitter } from 'events';
import type { OpenClawMessage, OpenClawSessionInfo } from '../types';
import { loadOrCreateDeviceIdentity, signDevicePayload, buildDeviceAuthPayload, publicKeyRawBase64Url } from './device-identity';
import { createHash } from 'crypto';

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// Global deduplication cache that persists across module reloads in Next.js dev
// Use globalThis to ensure it's shared across all instances
// Using Map for LRU (access time tracking) instead of Set
const GLOBAL_EVENT_CACHE_KEY = '__openclaw_processed_events__';
const GLOBAL_CACHE_CLEANUP_KEY = '__openclaw_cache_cleanup_timer__';

if (!(GLOBAL_EVENT_CACHE_KEY in globalThis)) {
  (globalThis as Record<string, unknown>)[GLOBAL_EVENT_CACHE_KEY] = new Map<string, number>();
}

const globalProcessedEvents = (globalThis as unknown as Record<string, Map<string, number>>)[GLOBAL_EVENT_CACHE_KEY];

export class OpenClawClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private messageId = 0;
  private pendingRequests = new Map<string | number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private connected = false;
  private authenticated = false; // Track auth state separately from connection state
  private connecting: Promise<void> | null = null; // Lock to prevent multiple simultaneous connection attempts
  private autoReconnect = true;
  private token: string;
  private deviceIdentity: { deviceId: string; publicKeyPem: string; privateKeyPem: string } | null = null;
  private messageHandlers = new Set<(event: MessageEvent) => void>(); // Track all message handlers for cleanup
  private readonly MAX_PROCESSED_EVENTS = 1000; // Limit the size of the processed events cache
  private readonly CLEANUP_THRESHOLD = 100; // Number of entries to remove when limit exceeded
  private readonly CACHE_ENTRY_TTL_MS = 60 * 60 * 1000; // 1 hour TTL for cache entries
  private readonly PERIODIC_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Cleanup every 5 minutes
  private periodicCleanupTimer: NodeJS.Timeout | null = null;

  /**
   * Generate a unique event ID using content hashing for proper deduplication.
   * Uses SHA-256 hash of event type, sequence/run ID, and payload content.
   * This prevents collision from Date.now() and ensures events with same
   * structure but different content are not incorrectly deduplicated.
   */
  private generateEventId(data: any): string {
    // Create a canonical string representation of the event
    const canonical = JSON.stringify({
      type: data.type,
      seq: data.seq,
      runId: data.payload?.runId,
      stream: data.payload?.stream,
      event: data.event,
      // Include hash of payload for content-aware deduplication
      payloadHash: data.payload ? createHash('sha256').update(JSON.stringify(data.payload)).digest('hex').slice(0, 16) : null
    });

    // Hash the canonical representation for a fixed-length ID
    return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
  }

  /**
   * Perform LRU cleanup of the event cache.
   * Removes the oldest entries based on access time when size exceeds limit.
   * Also removes entries older than TTL to prevent unbounded growth.
   */
  private performCacheCleanup(): void {
    const now = Date.now();
    let removed = 0;
    const initialSize = globalProcessedEvents.size;

    // First, remove expired entries (older than TTL)
    const entries = Array.from(globalProcessedEvents.entries());
    for (const [eventId, timestamp] of entries) {
      if (now - timestamp > this.CACHE_ENTRY_TTL_MS) {
        globalProcessedEvents.delete(eventId);
        removed++;
      }
    }

    // Then, if still over limit, remove oldest entries (LRU)
    if (globalProcessedEvents.size > this.MAX_PROCESSED_EVENTS) {
      const entriesToRemove = globalProcessedEvents.size - this.MAX_PROCESSED_EVENTS + this.CLEANUP_THRESHOLD;

      // Sort by access time (oldest first) and remove
      const sortedEntries = Array.from(globalProcessedEvents.entries())
        .sort((a, b) => a[1] - b[1]);

      for (const [eventId] of sortedEntries) {
        if (removed >= entriesToRemove) break;
        globalProcessedEvents.delete(eventId);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`[OpenClaw] Cache cleanup: removed ${removed} entries (size: ${initialSize} -> ${globalProcessedEvents.size})`);
    }
  }

  constructor(private url: string = GATEWAY_URL, token: string = GATEWAY_TOKEN) {
    super();
    this.token = token;
    // Prevent Node.js from throwing on unhandled 'error' events
    this.on('error', () => {});
    // Load device identity for pairing
    try {
      this.deviceIdentity = loadOrCreateDeviceIdentity();
      console.log('[OpenClaw] Device identity loaded:', this.deviceIdentity.deviceId);
    } catch (err) {
      console.warn('[OpenClaw] Failed to load device identity, will connect without:', err);
    }
// Start periodic cleanup to prevent unbounded cache growth
    this.startPeriodicCleanup();
  }

  /**
   * Start periodic cleanup of the global event cache.
   * Uses a shared timer across all instances to avoid multiple timers.
   */
  private startPeriodicCleanup(): void {
    // Check if a cleanup timer already exists (shared across all instances)
    if (!(GLOBAL_CACHE_CLEANUP_KEY in globalThis)) {
      const timer = setInterval(() => {
        // Perform cleanup even if no new events have arrived
        this.performCacheCleanup();
      }, this.PERIODIC_CLEANUP_INTERVAL_MS);

      // Store the timer globally so all instances share it
      (globalThis as Record<string, unknown>)[GLOBAL_CACHE_CLEANUP_KEY] = timer;
      console.log('[OpenClaw] Started periodic cache cleanup (interval:', this.PERIODIC_CLEANUP_INTERVAL_MS, 'ms)');
    }

    // Keep a reference to stop it when the last instance disconnects
    this.periodicCleanupTimer = (globalThis as unknown as Record<string, NodeJS.Timeout>)[GLOBAL_CACHE_CLEANUP_KEY];
  }

  /**
   * Stop the periodic cleanup timer if this is the last instance.
   */
  private stopPeriodicCleanup(): void {
    // We don't stop the timer here since it's shared across instances
    // The timer will continue running as long as any instance exists
    // This is safe because the cleanup function is lightweight

  }

  async connect(): Promise<void> {
    // If already connected, return immediately
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    // If a connection attempt is already in progress, wait for it
    if (this.connecting) {
      return this.connecting;
    }

    // Create a new connection attempt
    this.connecting = new Promise((resolve, reject) => {
      try {
        // Clean up any existing connection and handlers
        if (this.ws) {
          // Remove all tracked message handlers
          this.messageHandlers.clear();
          this.ws.onclose = null;
          this.ws.onerror = null;
          this.ws.onmessage = null;
          this.ws.onopen = null;
          if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
            this.ws.close();
          }
          this.ws = null;
        }

        // Add token to URL query string for Gateway authentication
        const wsUrl = new URL(this.url);
        if (this.token) {
          wsUrl.searchParams.set('token', this.token);
        }
        console.log('[OpenClaw] Connecting to:', wsUrl.toString().replace(/token=[^&]+/, 'token=***'));
        console.log('[OpenClaw] Token in URL:', wsUrl.searchParams.has('token'));
        this.ws = new WebSocket(wsUrl.toString());

        const connectionTimeout = setTimeout(() => {
          if (!this.connected) {
            this.ws?.close();
            reject(new Error('Connection timeout'));
          }
        }, 10000); // 10 second connection timeout

        this.ws.onopen = async () => {
          clearTimeout(connectionTimeout);
          console.log('[OpenClaw] WebSocket opened, waiting for challenge...');
          // Don't send anything yet - wait for Gateway challenge
          // Token is in URL query string
        };

        this.ws.onclose = (event) => {
          clearTimeout(connectionTimeout);
          const wasConnected = this.connected;
          this.connected = false;
          this.authenticated = false;
          this.connecting = null;
          this.messageHandlers.clear(); // Clear handlers on disconnect
          // Note: globalProcessedEvents is NOT cleared as it's shared across all instances
          this.emit('disconnected');
          // Log close reason for debugging
          console.log(`[OpenClaw] Disconnected from Gateway (code: ${event.code}, reason: "${event.reason}", wasClean: ${event.wasClean})`);
          // Only auto-reconnect if we were previously connected (not on initial connection failure)
          if (this.autoReconnect && wasConnected) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          clearTimeout(connectionTimeout);
          console.error('[OpenClaw] WebSocket error');
          this.emit('error', error);
          if (!this.connected) {
            this.connecting = null;
            reject(new Error('Failed to connect to OpenClaw Gateway'));
          }
        };

        // Create message handler
        const messageHandler = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data as string);

            // RPC responses (type: 'res') and legacy responses (with matching pending id)
            // must NEVER be deduplicated — they have unique request IDs and must always
            // be delivered to their pending resolve/reject handlers.
            const isRpcResponse = data.type === 'res' ||
              (data.id !== undefined && this.pendingRequests.has(data.id));

            if (!isRpcResponse) {
              // Generate unique event ID using content hashing for proper deduplication
              const eventId = this.generateEventId(data);

              // Skip if we've already processed this event (using global cache for all instances)
              if (globalProcessedEvents.has(eventId)) {
                console.log('[OpenClaw] Skipping duplicate event:', eventId.slice(0, 16));
                return;
              }

              // Mark this event as processed in the global cache with current timestamp for LRU
              const now = Date.now();
              globalProcessedEvents.set(eventId, now);

              // Perform LRU cleanup if cache size exceeds limit
              this.performCacheCleanup();
            }

            console.log('[OpenClaw] Received:', data.type === 'res' ? `res:${String(data.id).slice(0, 8)}` : this.generateEventId(data).slice(0, 16));

            // Handle challenge-response authentication (OpenClaw RequestFrame format)
            if (data.type === 'event' && data.event === 'connect.challenge') {
              console.log('[OpenClaw] Challenge received, responding...');
              const nonce = data.payload?.nonce;
              const requestId = crypto.randomUUID();
              const signedAtMs = Date.now();
              const role = 'operator';
              const scopes = ['operator.admin'];

              // Build device identity for the connect params
              const clientId = 'cli';
              let device: Record<string, unknown> | undefined;
              if (this.deviceIdentity) {
                const payload = buildDeviceAuthPayload({
                  deviceId: this.deviceIdentity.deviceId,
                  clientId,
                  clientMode: 'ui',
                  role,
                  scopes,
                  signedAtMs,
                  token: this.token || null,
                  nonce,
                });
                const signature = signDevicePayload(this.deviceIdentity.privateKeyPem, payload);
                device = {
                  id: this.deviceIdentity.deviceId,
                  publicKey: publicKeyRawBase64Url(this.deviceIdentity.publicKeyPem),
                  signature,
                  signedAt: signedAtMs,
                  nonce,
                };
                console.log('[OpenClaw] Device identity prepared:', {
                  deviceId: this.deviceIdentity.deviceId,
                  hasSignature: !!signature,
                  nonce,
                });
              }

              const response = {
                type: 'req',
                id: requestId,
                method: 'connect',
                params: {
                  minProtocol: 3,
                  maxProtocol: 3,
                  client: {
                    id: clientId,
                    version: '1.0.1',
                    platform: process.platform || 'web',
                    mode: 'ui',
                  },
                  auth: { token: this.token },
                  role,
                  scopes,
                  device,
                }
              };

              // Set up response handler
              this.pendingRequests.set(requestId, {
                resolve: () => {
                  this.connected = true;
                  this.authenticated = true;
                  this.connecting = null;
                  this.emit('connected');
                  console.log('[OpenClaw] Authenticated successfully');
                  resolve();
                },
                reject: (error: Error) => {
                  this.connecting = null;
                  this.ws?.close();
                  reject(new Error(`Authentication failed: ${error.message}`));
                }
              });

              console.log('[OpenClaw] Sending challenge response');
              this.ws!.send(JSON.stringify(response));
              return;
            }

            // Handle RPC responses and other messages
            this.handleMessage(data as OpenClawMessage);
          } catch (err) {
            console.error('[OpenClaw] Failed to parse message:', err);
          }
        };

        // Track and assign the message handler
        this.messageHandlers.add(messageHandler);
        this.ws.onmessage = messageHandler;
      } catch (err) {
        this.connecting = null;
        reject(err);
      }
    });

    return this.connecting;
  }

  private handleMessage(data: OpenClawMessage & { type?: string; ok?: boolean; payload?: unknown }): void {
    // Handle OpenClaw ResponseFrame format (type: "res")
    if (data.type === 'res' && data.id !== undefined) {
      const requestId = data.id as string | number;
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        const { resolve, reject } = pending;
        this.pendingRequests.delete(requestId);

        if (data.ok === false && data.error) {
          reject(new Error(data.error.message));
        } else {
          resolve(data.payload);
        }
        return;
      }
    }

    // Handle legacy JSON-RPC responses
    const legacyId = data.id as string | number | undefined;
    if (legacyId !== undefined && this.pendingRequests.has(legacyId)) {
      const { resolve, reject } = this.pendingRequests.get(legacyId)!;
      this.pendingRequests.delete(legacyId);

      if (data.error) {
        reject(new Error(data.error.message));
      } else {
        resolve(data.result);
      }
      return;
    }

    // Handle events/notifications
    if (data.method) {
      this.emit('notification', data);
      this.emit(data.method, data.params);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.autoReconnect) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.autoReconnect) return;

      console.log('[OpenClaw] Attempting reconnect...');
      try {
        await this.connect();
      } catch {
        // Don't spam logs on reconnect failure, just schedule another attempt
        this.scheduleReconnect();
      }
    }, 10000); // 10 seconds between reconnect attempts
  }

  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws || !this.connected || !this.authenticated) {
      throw new Error('Not connected to OpenClaw Gateway');
    }

    const id = crypto.randomUUID();
    const message = { type: 'req', id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);

      this.ws!.send(JSON.stringify(message));
    });
  }

  // Session management methods
  async listSessions(): Promise<OpenClawSessionInfo[]> {
    return this.call<OpenClawSessionInfo[]>('sessions_list');
  }

  async getSessionHistory(sessionId: string): Promise<unknown[]> {
    return this.call<unknown[]>('sessions_history', { session_id: sessionId });
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    await this.call('sessions_send', { session_id: sessionId, content });
  }

  async createSession(channel: string, peer?: string): Promise<OpenClawSessionInfo> {
    return this.call<OpenClawSessionInfo>('sessions_create', { channel, peer });
  }

  // Workflow execution methods
  // These use the HTTP /tools/invoke endpoint because sessions_spawn and
  // sessions_send are on the WebSocket RPC deny list for UI clients.
  // Gateway config must allow these via: gateway.tools.allow: ["sessions_spawn", "sessions_send"]

  private get httpBaseUrl(): string {
    // Convert ws:// to http:// for REST calls
    return this.url.replace(/^ws(s)?:\/\//, 'http$1://');
  }

  private async invokeToolHttp<T = unknown>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    const url = `${this.httpBaseUrl}/tools/invoke`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({ tool, args }),
    });

    const data = await response.json();

    if (!response.ok || data.ok === false) {
      const errorMsg = data.error?.message || data.error || `HTTP ${response.status}`;
      throw new Error(`Tool invoke failed (${tool}): ${errorMsg}`);
    }

    return (data.result ?? data) as T;
  }

  /**
   * Spawn a sub-agent session to execute a workflow step.
   * Uses HTTP /tools/invoke (sessions_spawn must be allowed in gateway.tools.allow).
   */
  async spawnSession(params: {
    task: string;
    label?: string;
    agentId?: string;
    model?: string;
    runTimeoutSeconds?: number;
    timeoutSeconds?: number;
    cleanup?: 'delete' | 'keep';
  }): Promise<{ sessionKey: string; [key: string]: unknown }> {
    const raw = await this.invokeToolHttp<Record<string, unknown>>('sessions_spawn', params);
    // Unwrap { content, details } wrapper
    const details = (raw?.details || raw) as Record<string, unknown>;
    return {
      sessionKey: (details.childSessionKey || details.sessionKey || '') as string,
      ...details,
    };
  }

  /**
   * Send a message to an existing session (e.g., approval/rejection to a waiting step).
   * Uses HTTP /tools/invoke (sessions_send must be allowed in gateway.tools.allow).
   */
  async sendToSession(params: {
    sessionKey?: string;
    label?: string;
    message: string;
    timeoutSeconds?: number;
  }): Promise<unknown> {
    return this.invokeToolHttp('sessions_send', params);
  }

  /**
   * List sub-agent sessions, optionally filtering by recent activity.
   */
  async listSubagents(params?: { recentMinutes?: number }): Promise<unknown[]> {
    const raw = await this.invokeToolHttp<Record<string, unknown>>('subagents', { action: 'list', ...params });
    // Response shape: { content: [...], details: { active: [...], recent: [...] } }
    const details = (raw as Record<string, unknown>)?.details as Record<string, unknown> | undefined;
    if (details) {
      const active = Array.isArray(details.active) ? details.active : [];
      const recent = Array.isArray(details.recent) ? details.recent : [];
      return [...active, ...recent];
    }
    // Fallback: if it's already an array
    return Array.isArray(raw) ? raw : [];
  }

  /**
   * Kill a running sub-agent session.
   */
  async killSubagent(target: string): Promise<void> {
    await this.invokeToolHttp('subagents', { action: 'kill', target });
  }

  /**
   * Get session history for a sub-agent.
   */
  async getSubagentHistory(sessionKey: string, params?: { limit?: number; includeTools?: boolean }): Promise<unknown[]> {
    return this.invokeToolHttp<unknown[]>('sessions_history', { sessionKey, ...params });
  }

  // --- Cron / Schedule Methods ---

  /**
   * Add a cron job to OpenClaw for scheduled pipeline triggers.
   */
  async addCronJob(params: {
    name?: string;
    schedule: { kind: 'cron'; expr: string; tz?: string } | { kind: 'every'; everyMs: number } | { kind: 'at'; at: string };
    payload: { kind: 'agentTurn'; message: string; model?: string; timeoutSeconds?: number };
    sessionTarget?: 'main' | 'isolated';
    delivery?: { mode: 'none' | 'announce' | 'webhook'; to?: string };
    enabled?: boolean;
  }): Promise<{ jobId: string; [key: string]: unknown }> {
    const result = await this.invokeToolHttp<Record<string, unknown>>('cron', {
      action: 'add',
      job: {
        name: params.name,
        schedule: params.schedule,
        payload: params.payload,
        sessionTarget: params.sessionTarget || 'isolated',
        delivery: params.delivery || { mode: 'none' },
        enabled: params.enabled ?? true,
      },
    });

    // Extract jobId from various response shapes:
    // Direct: { jobId: "xxx" } or { job: { id: "xxx" } } or { id: "xxx" }
    // Tool response: { content: [{ type: "text", text: "{ \"id\": \"xxx\", ... }" }] }
    let jobId = (result as Record<string, unknown>).jobId as string
      || ((result as Record<string, unknown>).job as Record<string, unknown>)?.id as string
      || (result as Record<string, unknown>).id as string
      || '';

    // Try extracting from content[].text (tool response format)
    if (!jobId) {
      const content = (result as Record<string, unknown>).content as Array<{ type: string; text: string }>;
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item.type === 'text' && item.text) {
            try {
              const parsed = JSON.parse(item.text);
              jobId = parsed.id || parsed.jobId || '';
              if (jobId) break;
            } catch {
              // Try to extract id from the text with regex
              const idMatch = item.text.match(/"id"\s*:\s*"([^"]+)"/);
              if (idMatch) { jobId = idMatch[1]; break; }
            }
          }
        }
      }
    }

    return { ...result, jobId };
  }

  /**
   * Remove a cron job.
   */
  async removeCronJob(jobId: string): Promise<void> {
    await this.invokeToolHttp('cron', { action: 'remove', jobId });
  }

  /**
   * List cron jobs.
   */
  async listCronJobs(includeDisabled?: boolean): Promise<unknown[]> {
    const result = await this.invokeToolHttp<{ jobs?: unknown[] }>('cron', {
      action: 'list',
      includeDisabled: includeDisabled ?? false,
    });
    return (result as Record<string, unknown>)?.jobs as unknown[] || [];
  }

  /**
   * Update a cron job (enable/disable, change schedule, etc.).
   */
  async updateCronJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
    await this.invokeToolHttp('cron', { action: 'update', jobId, patch });
  }

  // Memory methods (proxied through OpenClaw's Mem0 integration)

  async searchMemory(query: string, params?: { limit?: number; scope?: 'session' | 'long-term' | 'all' }): Promise<unknown[]> {
    const result = await this.invokeToolHttp<unknown>('memory_search', { query, ...params });
    return this.extractMemories(result);
  }

  async listMemories(params?: { scope?: 'session' | 'long-term' | 'all' }): Promise<unknown[]> {
    const result = await this.invokeToolHttp<unknown>('memory_list', { ...params });
    return this.extractMemories(result);
  }

  /**
   * Extract memories from various response shapes:
   * - { content, details: { memories: [...] } } (tool invoke wrapper)
   * - { memories: [...] } (direct)
   * - [...] (array)
   */
  private extractMemories(result: unknown): unknown[] {
    if (Array.isArray(result)) return result;
    if (result && typeof result === 'object') {
      const obj = result as Record<string, unknown>;
      // Tool invoke wrapper: { details: { memories: [...] } }
      if (obj.details && typeof obj.details === 'object') {
        const details = obj.details as Record<string, unknown>;
        if (Array.isArray(details.memories)) return details.memories;
        if (Array.isArray(details.results)) return details.results;
      }
      // Direct: { memories: [...] }
      if (Array.isArray(obj.memories)) return obj.memories;
      if (Array.isArray(obj.results)) return obj.results;
    }
    return [];
  }

  async getMemory(memoryId: string): Promise<unknown> {
    return this.invokeToolHttp('memory_get', { memoryId });
  }

  async storeMemory(text: string, params?: { longTerm?: boolean; metadata?: Record<string, unknown> }): Promise<unknown> {
    return this.invokeToolHttp('memory_store', { text, ...params });
  }

  async deleteMemory(params: { memoryId?: string; query?: string }): Promise<unknown> {
    return this.invokeToolHttp('memory_forget', params);
  }

  // Agent methods
  async listAgents(): Promise<unknown[]> {
    const result = await this.call<{ agents?: unknown[] }>('agents_list');
    // Gateway returns { requester, allowAny, agents: [...] }
    if (result && typeof result === 'object' && Array.isArray((result as Record<string, unknown>).agents)) {
      return (result as Record<string, unknown>).agents as unknown[];
    }
    // Fallback: if the response is already an array
    if (Array.isArray(result)) {
      return result;
    }
    return [];
  }

  // Node methods (device capabilities)
  async listNodes(): Promise<unknown[]> {
    return this.call<unknown[]>('node_list');
  }

  async describeNode(nodeId: string): Promise<unknown> {
    return this.call('node_describe', { node_id: nodeId });
  }

  disconnect(): void {
    this.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect on intentional close
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
    this.connecting = null;
    this.messageHandlers.clear(); // Clear all tracked handlers
    // Note: globalProcessedEvents is NOT cleared as it's shared across all instances
  }

  isConnected(): boolean {
    return this.connected && this.authenticated && this.ws?.readyState === WebSocket.OPEN;
  }

  setAutoReconnect(enabled: boolean): void {
    this.autoReconnect = enabled;
    if (!enabled && this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

// Singleton instance for server-side usage
let clientInstance: OpenClawClient | null = null;

export function getOpenClawClient(): OpenClawClient {
  if (!clientInstance) {
    clientInstance = new OpenClawClient();
  }
  return clientInstance;
}
