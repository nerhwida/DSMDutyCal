import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { weekdayOf } from '../lib/date';

/** 연속된 평일(금→월 포함)을 구간으로 묶어 '3/3~3/7, 3/10' 형태로 보여 준다. */
function toRanges(dates: string[]): string[] {
  const label = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
  const nextWeekday = (d: string) => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + (weekdayOf(d) === 5 ? 3 : 1));
    return t.toISOString().slice(0, 10);
  };
  const ranges: string[] = [];
  let start: string | null = null;
  let prev: string | null = null;
  for (const d of dates) {
    if (prev && nextWeekday(prev) === d) {
      prev = d;
      continue;
    }
    if (start && prev) ranges.push(start === prev ? label(start) : `${label(start)}~${label(prev)}`);
    start = d;
    prev = d;
  }
  if (start && prev) ranges.push(start === prev ? label(start) : `${label(start)}~${label(prev)}`);
  return ranges;
}

/**
 * 방과후 운영일 (학교 전체). 교사의 방과후 요일은 여기 등록된 날에만 감독에서 제외된다.
 * 관리자·학년부장이 기간 단위로 추가·제외한다.
 */
export function AfterSchoolSection({ canManage }: { canManage: boolean }) {
  const [dates, setDates] = useState<string[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDates(await api.get<string[]>('/api/after-school-days'));
    } catch (err) {
      setError(err instanceof Error ? err.message : '방과후 운영일을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byMonth = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const d of dates) {
      const key = d.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return [...map.entries()];
  }, [dates]);

  async function add() {
    setError(null);
    setMessage(null);
    try {
      const res = await api.post<{ added: number; alreadyRegistered: number }>('/api/after-school-days', {
        startDate: start,
        endDate: end || start,
      });
      setMessage(`운영일 ${res.added}일을 추가했습니다.${res.alreadyRegistered ? ` (이미 등록 ${res.alreadyRegistered}일)` : ''}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '추가에 실패했습니다.');
    }
  }

  async function remove() {
    setError(null);
    setMessage(null);
    try {
      const res = await api.delete<{ removed: number }>(`/api/after-school-days?from=${start}&to=${end || start}`);
      setMessage(`운영일 ${res.removed}일을 제외했습니다.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '제외에 실패했습니다.');
    }
  }

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700">방과후 운영일</h3>
        <p className="mt-1 text-xs text-slate-500">
          방과후 수업이 열리는 날입니다. 교사에게 지정된 <b>방과후 요일</b>은 이 운영일에 해당하는 날에만 감독에서 제외되고,
          운영하지 않는 날(시험 기간 등)에는 감독에 배정될 수 있습니다. 기간을 넣으면 그 안의 평일(월~금)이 모두 처리됩니다.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-emerald-700">{message}</p>}

      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-slate-500">시작일</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500">종료일 (미입력 시 하루)</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <button onClick={add} disabled={!start} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40">
            운영일 추가
          </button>
          <button
            onClick={remove}
            disabled={!start}
            className="rounded border border-slate-400 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            운영일에서 제외
          </button>
        </div>
      )}

      <ul className="divide-y divide-slate-100 rounded border border-slate-200 text-sm">
        {byMonth.map(([month, list]) => (
          <li key={month} className="flex gap-3 px-3 py-1.5">
            <span className="w-24 shrink-0 text-slate-600">
              {Number(month.slice(0, 4))}년 {Number(month.slice(5, 7))}월
            </span>
            <span className="text-slate-800">{toRanges(list).join(', ')}</span>
            <span className="ml-auto shrink-0 text-xs text-slate-400">{list.length}일</span>
          </li>
        ))}
        {byMonth.length === 0 && (
          <li className="px-3 py-3 text-center text-xs text-slate-400">
            등록된 방과후 운영일이 없습니다. 운영일이 없으면 방과후 요일 교사도 모든 날 감독에 배정될 수 있습니다.
          </li>
        )}
      </ul>
    </div>
  );
}
