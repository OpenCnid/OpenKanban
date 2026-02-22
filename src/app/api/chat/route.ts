import { NextRequest, NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';

/**
 * POST /api/chat — Send a message to the OpenClaw agent
 * Body: { message: string, sessionKey?: string, workspace_id?: string }
 * 
 * Uses sessions_send for existing conversations, sessions_spawn for new ones.
 * The agent can trigger workflows, answer questions, or perform actions.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { message, sessionKey } = body;

  if (!message || !message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  const client = getOpenClawClient();

  try {
    if (sessionKey) {
      // Continue existing conversation
      const result = await client.sendToSession({
        sessionKey,
        message: message.trim(),
        timeoutSeconds: 60,
      });

      // Extract response text from result
      const response = extractResponse(result);

      return NextResponse.json({
        response,
        sessionKey,
      });
    } else {
      // Start new conversation via sessions_spawn
      const result = await client.spawnSession({
        task: message.trim(),
        label: `openkanban-chat-${Date.now()}`,
        cleanup: 'keep', // Keep session alive for follow-up messages
        timeoutSeconds: 60,
      });

      // The spawn result contains the session key and potentially a response
      const response = extractResponse(result);

      return NextResponse.json({
        response: response || 'Processing your request...',
        sessionKey: result.sessionKey,
      });
    }
  } catch (error) {
    console.error('[Chat API] Error:', error);

    // Provide helpful error messages
    const errMsg = String(error);
    if (errMsg.includes('not found') || errMsg.includes('denied')) {
      return NextResponse.json({
        response: 'Unable to connect to the agent. Check that OpenClaw Gateway is running and sessions_send/sessions_spawn are in the tools allow list.',
        error: true,
      }, { status: 502 });
    }

    return NextResponse.json({
      response: `Agent error: ${errMsg}`,
      error: true,
    }, { status: 502 });
  }
}

/**
 * Extract readable response text from various OpenClaw result shapes
 */
function extractResponse(result: unknown): string {
  if (!result) return '';

  // Direct string
  if (typeof result === 'string') return result;

  const r = result as Record<string, unknown>;

  // { response: "..." }
  if (typeof r.response === 'string') return r.response;

  // { message: "..." }
  if (typeof r.message === 'string') return r.message;

  // { content: [{ type: "text", text: "..." }] }
  if (Array.isArray(r.content)) {
    const texts = r.content
      .filter((c: Record<string, unknown>) => c.type === 'text' && typeof c.text === 'string')
      .map((c: Record<string, unknown>) => c.text as string);
    if (texts.length > 0) return texts.join('\n');
  }

  // { result: "..." } or { result: { ... } }
  if (r.result) return extractResponse(r.result);

  // { text: "..." }
  if (typeof r.text === 'string') return r.text;

  return '';
}
