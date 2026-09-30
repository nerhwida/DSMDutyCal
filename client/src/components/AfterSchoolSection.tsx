import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { weekdayOf } from '../lib/date';
import type { Grade } from '../types';
import { GradeChecks, gradesLabel } from './GradeChecks';

const GRADES: Grade[] = [1, 2, 3];

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
 * 방과후 운영일 (날짜 × 학년). 방과후 시간에 자습하는 학년을 지정하면, 그 학년 감독에서만
 * 그날 방과후 수업이 있는 교사(방과후 요일)가 제외된다. 관리자·학년부장이 기간 단위로 추가·제외한다.
 */
export function AfterSchoolSection({ canManage }: { canManage: boolean }) {
  const [days, setDays] = useState<{ date: string; grades: Grade[] }[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [grades, setGrades] = useState<Grade[]>([...GRADES]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDays(await api.get<{ date: string; grades: Grade[] }[]>('/api/after-school-days'));
    } catch (err) {
      setError(err instanceof Error ? err.message : '방과후 운영일을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 월별 → 적용 학년별 날짜 목록
  const byMonth = useMemo(() => {
    const map = new Map<string, Map<string, { grades: Grade[]; dates: string[] }>>();
    for (const d of days) {
      const month = d.date.slice(0, 7);
      if (!map.has(month)) map.set(month, new Map());
      const byGrades = map.get(month)!;
      const key = d.grades.join();
      if (!byGrades.has(key)) byGrades.set(key, { grades: d.grades, dates: [] });
      byGrades.get(key)!.dates.push(d.date);
    }
    return [...map.entries()].map(([month, byGrades]) => [month, [...byGrades.values()]] as const);
  }, [days]);

  async function add() {
    setError(null);
    setMessage(null);
    try {
      const res = await api.post<{ days: number; added: number; alreadyRegistered: number }>('/api/after-school-days', {
        startDate: start,
        endDate: end || start,
        grades,
      });
      setMessage(
        `평일 ${res.days}일 × ${gradesLabel(grades)}을 운영일로 추가했습니다.${res.alreadyRegistered ? ` (이미 등록된 ${res.alreadyRegistered}건 제외)` : ''}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '추가에 실패했습니다.');
    }
  }

  async function remove() {
    setError(null);
    setMessage(null);
    try {
      const res = await api.delete<{ removed: number }>(
        `/api/after-school-days?from=${start}&to=${end || start}&grades=${grades.join(',')}`,
      );
      setMessage(`${gradesLabel(grades)} 운영일 ${res.removed}건을 제외했습니다.`);
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
          방과후 수업이 열리는 날과, 방과후 시간에 자습하는 학년을 지정합니다. 체크한 학년의 감독은 그날 방과후 수업이 없는
          교사가 맡습니다(교사에게 지정된 <b>방과후 요일</b>이면 제외). 체크하지 않은 학년과 운영하지 않는 날(시험 기간 등)에는
          방과후 교사도 감독에 배정될 수 있습니다. 기간을 넣으면 그 안의 평일(월~금)이 모두 처리됩니다.
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
          <div>
            <label className="block text-xs text-slate-500">적용 학년 (방과후 교사 감독 제외)</label>
            <div className="flex h-[30px] items-center">
              <GradeChecks value={grades} onChange={setGrades} />
            </div>
          </div>
          <button onClick={add} disabled={!start || grades.length === 0} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40">
            운영일 추가
          </button>
          <button
            onClick={remove}
            disabled={!start || grades.length === 0}
            className="rounded border border-slate-400 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            운영일에서 제외
          </button>
        </div>
      )}

      <ul className="divide-y divide-slate-100 rounded border border-slate-200 text-sm">
        {byMonth.map(([month, groups]) => (
          <li key={month} className="flex gap-3 px-3 py-1.5">
            <span className="w-24 shrink-0 text-slate-600">
              {Number(month.slice(0, 4))}년 {Number(month.slice(5, 7))}월
            </span>
            <div className="space-y-0.5">
              {groups.map((g) => (
                <p key={g.grades.join()}>
                  <span className={g.grades.length === 3 ? 'text-slate-500' : 'rounded bg-teal-50 px-1.5 text-teal-700'}>
                    {gradesLabel(g.grades)}
                  </span>{' '}
                  <span className="text-slate-800">{toRanges(g.dates).join(', ')}</span>
                </p>
              ))}
            </div>
            <span className="ml-auto shrink-0 text-xs text-slate-400">
              {new Set(groups.flatMap((g) => g.dates)).size}일
            </span>
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
