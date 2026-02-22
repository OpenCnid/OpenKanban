'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Send, X, ChevronUp, Loader2, Bot, User } from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface QuickChatProps {
  workspaceId: string;
}

export function QuickChat({ workspaceId }: QuickChatProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionKey,
          workspace_id: workspaceId,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      // Store session key for conversation continuity
      if (data.sessionKey) {
        setSessionKey(data.sessionKey);
      }

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.response || data.message || 'No response',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (error) {
      const errMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'system',
        content: `Failed to send message: ${error}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setSending(false);
    }
  }, [input, sending, sessionKey, workspaceId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <>
      {/* Toggle button — fixed bottom right */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 bg-mc-accent text-mc-bg rounded-full shadow-lg hover:bg-mc-accent/90 transition-all hover:shadow-xl group"
        >
          <MessageSquare className="w-5 h-5" />
          <span className="text-sm font-medium">Chat</span>
        </button>
      )}

      {/* Chat drawer */}
      {open && (
        <div className="fixed bottom-0 right-6 z-40 w-[400px] max-w-[calc(100vw-3rem)] flex flex-col bg-mc-bg-secondary border border-mc-border border-b-0 rounded-t-xl shadow-2xl overflow-hidden"
          style={{ height: '480px' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-mc-bg-tertiary border-b border-mc-border">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-mc-accent" />
              <span className="text-sm font-semibold text-mc-text">Quick Chat</span>
              {sessionKey && (
                <span className="text-[10px] text-mc-text-secondary bg-mc-bg px-1.5 py-0.5 rounded">
                  active
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setMessages([]);
                  setSessionKey(null);
                }}
                className="p-1.5 text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg rounded transition-colors text-xs"
                title="New conversation"
              >
                New
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg rounded transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Bot className="w-8 h-8 text-mc-text-secondary/30 mb-2" />
                <p className="text-sm text-mc-text-secondary">Talk to your agent</p>
                <p className="text-xs text-mc-text-secondary/60 mt-1 max-w-[260px]">
                  Ask questions, trigger workflows, or check on running pipelines.
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role !== 'user' && (
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-mc-accent/20 flex items-center justify-center mt-0.5">
                    <Bot className="w-3.5 h-3.5 text-mc-accent" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-lg text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-mc-accent text-mc-bg rounded-br-sm'
                      : msg.role === 'system'
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                      : 'bg-mc-bg-tertiary text-mc-text rounded-bl-sm'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  <span className={`text-[10px] mt-1 block ${
                    msg.role === 'user' ? 'text-mc-bg/60' : 'text-mc-text-secondary/50'
                  }`}>
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                {msg.role === 'user' && (
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-mc-accent-purple/20 flex items-center justify-center mt-0.5">
                    <User className="w-3.5 h-3.5 text-mc-accent-purple" />
                  </div>
                )}
              </div>
            ))}

            {sending && (
              <div className="flex gap-2">
                <div className="w-6 h-6 rounded-full bg-mc-accent/20 flex items-center justify-center">
                  <Bot className="w-3.5 h-3.5 text-mc-accent" />
                </div>
                <div className="px-3 py-2 bg-mc-bg-tertiary rounded-lg rounded-bl-sm">
                  <Loader2 className="w-4 h-4 text-mc-text-secondary animate-spin" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="flex-shrink-0 px-3 py-3 border-t border-mc-border bg-mc-bg-secondary">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message your agent..."
                disabled={sending}
                className="flex-1 px-3 py-2 bg-mc-bg-tertiary border border-mc-border rounded-lg text-sm text-mc-text placeholder:text-mc-text-secondary/50 focus:outline-none focus:border-mc-accent/50 disabled:opacity-50"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || sending}
                className="p-2 bg-mc-accent text-mc-bg rounded-lg hover:bg-mc-accent/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
