'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, Check, CheckCheck, X, ExternalLink, Trash2 } from 'lucide-react';

interface Notification {
  id: string;
  type: string;
  title: string;
  message?: string;
  link?: string;
  read: number;
  source_id?: string;
  created_at: string;
}

interface NotificationCenterProps {
  onNavigate?: (path: string) => void;
}

export function NotificationCenter({ onNavigate }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=20');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch {
      // Silent fail
    }
  }, []);

  // Initial load + poll
  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // Listen for SSE notification events
  useEffect(() => {
    const handler = () => loadNotifications();
    window.addEventListener('sse-event', handler);
    return () => window.removeEventListener('sse-event', handler);
  }, [loadNotifications]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: 1 } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const markAllRead = async () => {
    await fetch('/api/notifications/read-all', { method: 'POST' });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: 1 })));
    setUnreadCount(0);
  };

  const deleteNotification = async (id: string) => {
    await fetch(`/api/notifications/${id}`, { method: 'DELETE' });
    setNotifications((prev) => {
      const n = prev.find((x) => x.id === id);
      if (n && !n.read) setUnreadCount((c) => Math.max(0, c - 1));
      return prev.filter((x) => x.id !== id);
    });
  };

  const handleNotificationClick = (n: Notification) => {
    if (!n.read) markRead(n.id);
    if (n.link && onNavigate) {
      // Extract tab from link like /workspace/default?tab=pipelines
      const url = new URL(n.link, 'http://localhost');
      const tab = url.searchParams.get('tab');
      if (tab) onNavigate(tab);
    }
    setOpen(false);
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case 'approval_required': return '⏸';
      case 'workflow_suggestion': return '💡';
      case 'step_completed': return '✅';
      case 'step_failed': return '❌';
      case 'pipeline_completed': return '🎉';
      default: return '🔔';
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary hover:text-mc-text transition-colors"
        title="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold bg-red-500 text-white rounded-full leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-mc-bg-secondary border border-mc-border rounded-xl shadow-2xl overflow-hidden z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-mc-border">
            <h3 className="text-sm font-semibold text-mc-text">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-mc-accent hover:text-mc-accent/80"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-sm text-mc-text-secondary">
                No notifications
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`group flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-mc-bg-tertiary transition-colors border-b border-mc-border/50 last:border-0 ${
                    !n.read ? 'bg-mc-accent/5' : ''
                  }`}
                  onClick={() => handleNotificationClick(n)}
                >
                  <span className="text-base flex-shrink-0 mt-0.5">{typeIcon(n.type)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm line-clamp-1 ${!n.read ? 'text-mc-text font-medium' : 'text-mc-text-secondary'}`}>
                        {n.title}
                      </p>
                      {!n.read && (
                        <span className="w-2 h-2 rounded-full bg-mc-accent flex-shrink-0 mt-1.5" />
                      )}
                    </div>
                    {n.message && (
                      <p className="text-xs text-mc-text-secondary line-clamp-2 mt-0.5">
                        {n.message}
                      </p>
                    )}
                    <span className="text-[10px] text-mc-text-secondary/60 mt-1 block">
                      {formatTime(n.created_at)}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-mc-text-secondary hover:text-red-400 transition-all flex-shrink-0"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
