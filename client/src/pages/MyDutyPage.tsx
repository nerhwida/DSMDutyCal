import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Popover } from '../components/Popover';
import { SwapPopover } from '../components/SwapPopover';
import { dateLabel, formatDateTime, lastDayOf, shiftMonth, toDateString, todayInSeoul, weekdayOf } from '../lib/date';
import { GROUP_LABEL, PLAN_STATUS_LABEL, type HistoryEntry, type MonthStats, type TeacherAssignment } from '../types';
import { MyInfoPage } from './MyInfoPage';

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const KIND_LABEL: Record<HistoryEntry['kind'], string> = {
  GAVE: '넘긴 감독',
  RECEIVED: '넘겨받은 감독',
  SWAP: '맞교환',
  ASSIGNED: '지정 배정',
};

/** F1-3 내 감독 화면 (일반 교사 기본 진입 화면). */
export function MyDutyPage() {
  const { user } = useAuth();
  const today = todayInSeoul();
  const [y, m] = today.split('-').map(Number);
  const next = shiftMonth(y, m, 1);

  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<MonthStats | null>(null);
  const [swapTarget, setSwapTarget] = useState<{ a: TeacherAssignment; anchor: DOMRect } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const from = toDateString(y, m, 1);
      const to = toDateString(next.year, next.month, lastDayOf(next.year, next.month));
      const [list, hist, st] = await Promise.all([
        api.get<TeacherAssignment[]>(`/api/me/assignments?from=${from}&to=${to}`),
        api.get<HistoryEntry[]>('/api/me/history'),
        // 누계는 화면에 보이는 마지막 달(다음 달)까지의 확정·마감 배정을 포함한다.
        api.get<MonthStats>(`/api/stats?year=${next.year}&month=${next.month}`),
      ]);
      setAssignments(list);
      setHistory(hist);
      setStats(st);
    } catch (err) {
      setError(err instanceof Error ? err.message : '내 감독 정보를 불러오지 못했습니다.');
    }
  }, [y, m, next.year, next.month]);

  useEffect(() => {
    load();
  }, [load]);

  if (!user) return null;
  const myRow = stats?.rows.find((r) => r.teacherId === user.id);

  return (
    <div className="grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-800">
          내 감독 ({m}월 · {next.month}월)
        </h2>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="overflow-hidden rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">날짜</th>
                <th className="px-3 py-2 text-left">요일</th>
                <th className="px-3 py-2 text-left">학년</th>
                <th className="px-3 py-2 text-left">상태</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id} className={`border-t border-slate-100 ${a.date < today ? 'text-slate-400' : ''}`}>
                  <td className="px-3 py-2">
                    {dateLabel(a.date)}
                    {a.date === today && <span className="ml-1 rounded bg-sky-100 px-1 text-xs text-sky-700">오늘</span>}
                  </td>
                  <td className="px-3 py-2">{WEEKDAY_KO[weekdayOf(a.date)]}</td>
                  <td className="px-3 py-2">
                    {a.grade}학년 {a.isModified && <span className="text-amber-600">↻</span>} {a.isLocked && '🔒'}
                  </td>
                  <td className="px-3 py-2 text-xs">{PLAN_STATUS_LABEL[a.status]}</td>
                  <td className="px-3 py-2 text-right">
                    {a.status === 'CONFIRMED' && (
                      <button
                        onClick={(e) => setSwapTarget({ a, anchor: e.currentTarget.getBoundingClientRect() })}
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
                      >
                        교체
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {assignments.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-xs text-slate-400">
                    배정된 감독이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h3 className="pt-2 text-sm font-semibold text-slate-700">
          내 누계 (학년·그룹별, 초기 누계 + {next.month}월까지 확정·마감분)
        </h3>
        <div className="overflow-hidden rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-1.5 text-left">학년</th>
                <th className="px-3 py-1.5">{GROUP_LABEL.WEEKDAY}</th>
                <th className="px-3 py-1.5">{GROUP_LABEL.FRIDAY}</th>
              </tr>
            </thead>
            <tbody>
              {([1, 2, 3] as const).map((g) => (
                <tr key={g} className="border-t border-slate-100 text-center">
                  <td className="px-3 py-1.5 text-left">{g}학년</td>
                  <td className="px-3 py-1.5">{myRow?.byGradeGroup[`${g}:WEEKDAY`] ?? 0}</td>
                  <td className="px-3 py-1.5">{myRow?.byGradeGroup[`${g}:FRIDAY`] ?? 0}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 text-center font-semibold">
                <td className="px-3 py-1.5 text-left">합계</td>
                <td className="px-3 py-1.5">{myRow?.weekdayTotal ?? 0}</td>
                <td className="px-3 py-1.5">{myRow?.fridayTotal ?? 0}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-800">교체 이력</h2>
        <ul className="max-h-80 overflow-y-auto rounded border border-slate-200 bg-white text-sm">
          {history.map((h) => (
            <li key={h.id} className="border-b border-slate-100 px-3 py-2 last:border-b-0">
              <span className="mr-2 rounded bg-slate-100 px-1.5 text-xs text-slate-600">{KIND_LABEL[h.kind]}</span>
              {dateLabel(h.date)} {h.grade}학년: {h.fromTeacherName ?? '미배정'} → {h.toTeacherName}
              <p className="text-xs text-slate-400">
                {formatDateTime(h.changedAt)} · {h.changedByName}
                {h.note && ` · ${h.note}`}
              </p>
            </li>
          ))}
          {history.length === 0 && <li className="px-3 py-4 text-center text-xs text-slate-400">교체 이력이 없습니다.</li>}
        </ul>

        <div className="pt-4">
          <MyInfoPage />
        </div>
      </section>

      {swapTarget && (
        <Popover anchor={swapTarget.anchor} onClose={() => setSwapTarget(null)} width={380}>
          <SwapPopover
            key={swapTarget.a.id}
            assignment={swapTarget.a}
            onDone={async () => {
              setSwapTarget(null);
              await load();
            }}
            onCancel={() => setSwapTarget(null)}
          />
        </Popover>
      )}
    </div>
  );
}
