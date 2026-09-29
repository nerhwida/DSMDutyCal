import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { roleLabel, useAuth } from '../auth/AuthContext';
import type { Teacher } from '../types';
import { WEEKDAY_LABEL } from '../types';

const WEEKDAYS = [1, 2, 3, 4, 5];

export function MyInfoPage() {
  const { user } = useAuth();
  const [me, setMe] = useState<Teacher | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const list = await api.get<Teacher[]>('/api/teachers');
      setMe(list.find((t) => t.id === user.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '정보를 불러오지 못했습니다.');
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  if (!user || !me) return null;

  async function toggleAfterSchool(weekday: number, checked: boolean) {
    if (!me) return;
    try {
      const others = me.weekdayExclusions.filter(
        (e) => e.reason !== 'AFTER_SCHOOL' || e.weekday !== weekday,
      );
      const next = checked ? [...others, { weekday, reason: 'AFTER_SCHOOL' as const }] : others;
      await api.put(
        `/api/teachers/${me.id}/weekday-exclusions`,
        next.map((e) => ({ weekday: e.weekday, reason: e.reason })),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.');
    }
  }

  async function addUnavailable() {
    if (!date || !reason || !me) return;
    try {
      await api.post(`/api/teachers/${me.id}/unavailable`, { date, reason });
      setDate('');
      setReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '등록에 실패했습니다.');
    }
  }

  async function removeUnavailable(id: number) {
    if (!me) return;
    try {
      await api.delete(`/api/teachers/${me.id}/unavailable/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-800">
          {me.name} 선생님 ({roleLabel(user)})
        </h2>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">방과후 수업 요일</h3>
        <div className="flex gap-4">
          {WEEKDAYS.map((w) => {
            const checked = me.weekdayExclusions.some(
              (e) => e.weekday === w && e.reason === 'AFTER_SCHOOL',
            );
            return (
              <label key={w} className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={checked} onChange={(e) => toggleAfterSchool(w, e.target.checked)} />
                {WEEKDAY_LABEL[w]}
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">감독 불가일</h3>
        <ul className="mb-2 space-y-1">
          {me.unavailableDates.map((u) => (
            <li key={u.id} className="flex items-center justify-between text-sm">
              <span>
                {u.date} · {u.reason}
              </span>
              <button className="text-xs text-red-600 underline" onClick={() => removeUnavailable(u.id)}>
                삭제
              </button>
            </li>
          ))}
          {me.unavailableDates.length === 0 && (
            <li className="text-xs text-slate-400">등록된 불가일이 없습니다.</li>
          )}
        </ul>
        <div className="flex gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <input
            type="text"
            placeholder="사유 (예: 출장, 연수)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button onClick={addUnavailable} className="rounded bg-slate-800 px-3 py-1 text-sm text-white">
            추가
          </button>
        </div>
      </div>
    </div>
  );
}
