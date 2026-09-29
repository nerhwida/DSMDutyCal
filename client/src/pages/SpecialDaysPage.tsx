import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { Grade, SpecialDay, SpecialDayType } from '../types';
import { SPECIAL_DAY_TYPE_LABEL } from '../types';

const TYPES: SpecialDayType[] = ['MANDATORY_HOME', 'HOLIDAY', 'EXAM', 'EVENT', 'OTHER'];
const GRADES: Grade[] = [1, 2, 3];

/** 화면 표시 단위: 같은 날짜·유형·일정명의 학년별 행을 하나로 묶는다. */
interface SpecialGroup {
  key: string;
  date: string;
  type: SpecialDayType;
  title: string;
  grades: Grade[];
  ids: number[];
}

function groupRows(rows: SpecialDay[]): SpecialGroup[] {
  const map = new Map<string, SpecialGroup>();
  for (const d of rows) {
    const key = `${d.date}\u0000${d.type}\u0000${d.title}`;
    if (!map.has(key)) map.set(key, { key, date: d.date, type: d.type, title: d.title, grades: [], ids: [] });
    const g = map.get(key)!;
    g.grades.push(d.grade);
    g.ids.push(d.id);
  }
  return [...map.values()].map((g) => ({ ...g, grades: g.grades.sort() }));
}

export function SpecialDaysPage() {
  const { user } = useAuth();
  const [days, setDays] = useState<SpecialDay[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ cells: string[] } | null>(null);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [type, setType] = useState<SpecialDayType>('EVENT');
  const [title, setTitle] = useState('');
  const [grades, setGrades] = useState<Grade[]>([...GRADES]);
  const [seedYear, setSeedYear] = useState(new Date().getFullYear());

  const load = useCallback(async () => {
    try {
      const list = await api.get<SpecialDay[]>('/api/special-days');
      setDays(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : '목록을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => groupRows(days), [days]);

  if (!user) return null;

  function toggleGrade(g: Grade, checked: boolean) {
    setGrades((cur) => (checked ? [...new Set([...cur, g])].sort() : cur.filter((x) => x !== g)));
    setConflict(null);
  }

  async function submit(confirmDeleteAssignments = false) {
    setError(null);
    setConflict(null);
    try {
      await api.post('/api/special-days', {
        startDate,
        endDate: endDate || startDate,
        type,
        title,
        grades,
        confirmDeleteAssignments,
      });
      setStartDate('');
      setEndDate('');
      setTitle('');
      setGrades([...GRADES]);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { warning?: boolean; conflictingCells?: string[] } | undefined;
        if (body?.warning) setConflict({ cells: body.conflictingCells ?? [] });
      }
      setError(err instanceof Error ? err.message : '등록에 실패했습니다.');
    }
  }

  async function remove(group: SpecialGroup) {
    try {
      await api.delete(`/api/special-days?ids=${group.ids.join(',')}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    }
  }

  async function seedHolidays() {
    setError(null);
    try {
      await api.post('/api/special-days/seed-holidays', { year: seedYear });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '공휴일 시드 불러오기에 실패했습니다.');
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-800">일정 관리</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {user.isAdmin && (
        <div className="space-y-3 rounded border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-slate-500">시작일</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">종료일 (미입력 시 시작일과 동일)</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">유형</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as SpecialDayType)}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SPECIAL_DAY_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500">일정명</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">감독 제외 학년</label>
              <div className="flex h-[30px] items-center gap-3 text-sm">
                {GRADES.map((g) => (
                  <label key={g} className="flex items-center gap-1">
                    <input type="checkbox" checked={grades.includes(g)} onChange={(e) => toggleGrade(g, e.target.checked)} />
                    {g}학년
                  </label>
                ))}
              </div>
            </div>
            <button
              onClick={() => submit(false)}
              className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
              disabled={!startDate || !title || grades.length === 0}
            >
              등록
            </button>
          </div>
          <p className="text-xs text-slate-500">
            체크한 학년만 해당 날짜에 감독을 편성하지 않습니다. 예: 2학년 수학여행 → 2학년만 체크하면 1·3학년은 그날도
            정상 편성됩니다.
          </p>

          {conflict && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <p>이미 감독 배정이 있는 날짜·학년이 포함되어 있습니다: {conflict.cells.join(', ')}</p>
              <p>계속 등록하면 해당 학년의 배정만 삭제됩니다.</p>
              <button
                onClick={() => submit(true)}
                className="mt-2 rounded bg-amber-700 px-3 py-1 text-xs text-white"
              >
                배정 삭제 후 등록
              </button>
            </div>
          )}

          <div className="flex items-end gap-2 border-t border-slate-100 pt-3">
            <div>
              <label className="block text-xs text-slate-500">연도별 공휴일 시드 불러오기 (전 학년)</label>
              <input
                type="number"
                value={seedYear}
                onChange={(e) => setSeedYear(Number(e.target.value))}
                className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
            <button
              onClick={seedHolidays}
              className="rounded border border-slate-400 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            >
              불러오기
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">날짜</th>
              <th className="px-3 py-2 text-left">유형</th>
              <th className="px-3 py-2 text-left">일정명</th>
              <th className="px-3 py-2 text-left">감독 제외 학년</th>
              {user.isAdmin && <th className="px-3 py-2 text-left">관리</th>}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} className="border-t border-slate-100">
                <td className="px-3 py-2">{g.date}</td>
                <td className="px-3 py-2">{SPECIAL_DAY_TYPE_LABEL[g.type]}</td>
                <td className="px-3 py-2">{g.title}</td>
                <td className="px-3 py-2">
                  {g.grades.length === 3 ? (
                    <span className="text-slate-600">전 학년</span>
                  ) : (
                    <span className="rounded bg-amber-50 px-1.5 text-amber-800">{g.grades.join('·')}학년</span>
                  )}
                </td>
                {user.isAdmin && (
                  <td className="px-3 py-2">
                    <button className="text-xs text-red-600 underline" onClick={() => remove(g)}>
                      삭제
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {groups.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-xs text-slate-400">
                  등록된 특별 일정이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
