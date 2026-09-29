import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { dateLabel, formatDateTime, shiftMonth, todayInSeoul } from '../lib/date';
import type { Grade, HistoryRow } from '../types';

const GRADES: Grade[] = [1, 2, 3];
const ROLE_LABEL: Record<HistoryRow['changedByRole'], string> = { ADMIN: '관리자', GRADE_HEAD: '학년부장', TEACHER: '교사' };

/** F10 변경 이력: 월별 목록. 서버가 권한 범위(전체 / 담당 학년 / 본인 관련)로 필터한다. */
export function HistoryPage() {
  const { user } = useAuth();
  const [ymState, setYm] = useState(() => {
    const [y, m] = todayInSeoul().split('-').map(Number);
    return { year: y, month: m };
  });
  const [grade, setGrade] = useState<Grade | null>(null);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const q = `year=${ymState.year}&month=${ymState.month}${grade ? `&grade=${grade}` : ''}`;
      setRows(await api.get<HistoryRow[]>(`/api/history?${q}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : '변경 이력을 불러오지 못했습니다.');
    }
  }, [ymState, grade]);

  useEffect(() => {
    load();
  }, [load]);

  if (!user) return null;
  const scopeLabel = user.isAdmin
    ? '전체 이력'
    : user.gradeHeadOf.length > 0
      ? `${user.gradeHeadOf.join(', ')}학년 전체 + 본인 관련 이력`
      : '본인 관련 이력';

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center gap-4">
        <h2 className="text-base font-semibold text-slate-800">변경 이력</h2>
        <span className="text-xs text-slate-500">조회 범위: {scopeLabel}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-sm">
        <button onClick={() => setYm((c) => shiftMonth(c.year, c.month, -1))} className="text-slate-500 hover:text-slate-800">
          ◀
        </button>
        <span className="font-medium">
          {ymState.year}년 {ymState.month}월
        </span>
        <button onClick={() => setYm((c) => shiftMonth(c.year, c.month, 1))} className="text-slate-500 hover:text-slate-800">
          ▶
        </button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <div className="flex overflow-hidden rounded border border-slate-300 text-xs">
          {([null, ...GRADES] as (Grade | null)[]).map((g) => (
            <button
              key={g ?? 'all'}
              onClick={() => setGrade(g)}
              className={`px-2 py-1 ${grade === g ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {g ? `${g}학년` : '전체'}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">변경 일시</th>
              <th className="px-3 py-2 text-left">감독 날짜</th>
              <th className="px-3 py-2 text-left">학년</th>
              <th className="px-3 py-2 text-left">이전 → 이후</th>
              <th className="px-3 py-2 text-left">변경자</th>
              <th className="px-3 py-2 text-left">메모</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.id} className="border-t border-slate-100">
                <td className="px-3 py-1.5 text-xs text-slate-500">{formatDateTime(h.changedAt)}</td>
                <td className="px-3 py-1.5">{dateLabel(h.date)}</td>
                <td className="px-3 py-1.5">{h.grade}학년</td>
                <td className="px-3 py-1.5">
                  {h.swapGroupId && <span className="mr-1 rounded bg-slate-100 px-1 text-xs text-slate-600">맞교환</span>}
                  {h.fromTeacherName ?? <span className="text-red-600">미배정</span>} →{' '}
                  <span className="font-medium">{h.toTeacherName}</span>
                </td>
                <td className="px-3 py-1.5">
                  {h.changedByName} <span className="text-xs text-slate-400">({ROLE_LABEL[h.changedByRole]})</span>
                </td>
                <td className="px-3 py-1.5 text-xs text-slate-600">{h.note}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-xs text-slate-400">
                  변경 이력이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
