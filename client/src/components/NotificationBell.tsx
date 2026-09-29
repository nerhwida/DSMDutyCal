import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { formatDateTime } from '../lib/date';
import type { AppNotification } from '../types';

const POLL_MS = 60_000;

/** 상단 🔔 알림 배지 + 목록. 목록을 열면 모두 읽음 처리한다. */
export function NotificationBell({ refreshKey }: { refreshKey?: number }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ items: AppNotification[]; unreadCount: number }>('/api/me/notifications');
      setItems(res.items);
      setUnread(res.unreadCount);
    } catch {
      // 알림은 부가 기능이므로 실패해도 화면을 막지 않는다.
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load, refreshKey]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      await api.put('/api/me/notifications', {});
      setUnread(0);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={toggle} className="relative rounded px-2 py-1 text-lg hover:bg-slate-100" aria-label="알림">
        🔔
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 max-h-96 w-96 overflow-y-auto rounded border border-slate-200 bg-white shadow-lg">
          {items.length === 0 && <p className="px-3 py-4 text-center text-xs text-slate-400">알림이 없습니다.</p>}
          {items.map((n) => (
            <div key={n.id} className={`border-b border-slate-100 px-3 py-2 text-xs ${n.readAt ? 'text-slate-500' : 'bg-sky-50 text-slate-800'}`}>
              <p>{n.message}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">{formatDateTime(n.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
