import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { longDateLabel, monthGrid, shiftMonth, todayInSeoul } from '../lib/date';
import type { Grade } from '../types';
import { GradeChecks, gradesLabel } from './GradeChecks';

const GRADES: Grade[] = [1, 2, 3];
const WEEKDAYS = [
  { value: 1, label: '월' },
  { value: 2, label: '화' },
  { value: 3, label: '수' },
  { value: 4, label: '목' },
  { value: 5, label: '금' },
];

type AfterSchoolDay = { date: string; grades: Grade[] };

/** 저장 요청. 방과후 요일 교사 배정과 충돌하면 확인 후 같은 요청을 confirmRemoveAssignments로 다시 보낸다. */
type SaveRequest = { label: string; send: (confirmRemoveAssignments: boolean) => Promise<string> };

/**
 * 방과후 운영일 (날짜 × 학년). 방과후 시간에 자습하는 학년을 지정하면 그날은 그 학년만 감독을 편성하고,
 * 감독은 방과후 수업이 없는 교사(방과후 요일이 아닌 교사)가 맡는다. 관리자·학년부장이 기간 단위로 등록하고,
 * 달력에서 날짜를 눌러 그날의 학년을 바로 고친다.
 */
export function AfterSchoolSection({ canManage }: { canManage: boolean }) {
  const [days, setDays] = useState<AfterSchoolDay[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>(WEEKDAYS.map((w) => w.value));
  const [grades, setGrades] = useState<Grade[]>([...GRADES]);
  const [ym, setYm] = useState(() => {
    const today = todayInSeoul();
    return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  });
  const [editing, setEditing] = useState<{ date: string; grades: Grade[] } | null>(null);
  const [pending, setPending] = useState<{ request: SaveRequest; assignments: string[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDays(await api.get<AfterSchoolDay[]>('/api/after-school-days'));
    } catch (err) {
      setError(err instanceof Error ? err.message : '방과후 운영일을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const gradesOf = useMemo(() => new Map(days.map((d) => [d.date, d.grades])), [days]);
  // 운영일이 있는 달 (바로가기)
  const months = useMemo(() => {
    const count = new Map<string, number>();
    for (const d of days) count.set(d.date.slice(0, 7), (count.get(d.date.slice(0, 7)) ?? 0) + 1);
    return [...count];
  }, [days]);

  async function run(request: SaveRequest, confirmRemoveAssignments = false) {
    setError(null);
    setMessage(null);
    try {
      const done = await request.send(confirmRemoveAssignments);
      setPending(null);
      setEditing(null);
      setMessage(done);
      await load();
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { warning?: boolean; conflictingAssignments?: string[] }) : undefined;
      if (body?.warning) {
        setPending({ request, assignments: body.conflictingAssignments ?? [] });
      } else {
        setPending(null);
        setError(err instanceof Error ? err.message : `${request.label}에 실패했습니다.`);
      }
    }
  }

  const removedNote = (n: number) => (n > 0 ? ` 맞지 않는 감독 배정 ${n}건을 취소했습니다.` : '');
  const weekdayParam = weekdays.length === WEEKDAYS.length ? undefined : weekdays;
  const weekdayText = weekdayParam ? ` (${WEEKDAYS.filter((w) => weekdays.includes(w.value)).map((w) => w.label).join('·')}요일)` : '';

  function addRange() {
    run({
      label: '운영일 추가',
      send: async (confirmRemoveAssignments) => {
        const res = await api.post<{ days: number; added: number; alreadyRegistered: number; removedAssignments: number }>(
          '/api/after-school-days',
          { startDate: start, endDate: end || start, weekdays: weekdayParam, grades, confirmRemoveAssignments },
        );
        return `평일 ${res.days}일${weekdayText} × ${gradesLabel(grades)}을 운영일로 추가했습니다.${
          res.alreadyRegistered ? ` (이미 등록된 ${res.alreadyRegistered}건 제외)` : ''
        }${removedNote(res.removedAssignments)}`;
      },
    });
  }

  async function removeRange() {
    setError(null);
    setMessage(null);
    setPending(null);
    try {
      const query = `from=${start}&to=${end || start}&grades=${grades.join(',')}${weekdayParam ? `&weekdays=${weekdayParam.join(',')}` : ''}`;
      const res = await api.delete<{ removed: number }>(`/api/after-school-days?${query}`);
      setMessage(`${gradesLabel(grades)} 운영일 ${res.removed}건을 제외했습니다.${weekdayText}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '제외에 실패했습니다.');
    }
  }

  function saveDay(date: string, dayGrades: Grade[]) {
    run({
      label: '저장',
      send: async (confirmRemoveAssignments) => {
        const res = await api.put<{ removedAssignments: number }>(`/api/after-school-days/${date}`, {
          grades: dayGrades,
          confirmRemoveAssignments,
        });
        const what = dayGrades.length === 0 ? '방과후 운영일에서 뺐습니다.' : `자습 감독 학년을 ${gradesLabel(dayGrades)}으로 지정했습니다.`;
        return `${longDateLabel(date)}: ${what}${removedNote(res.removedAssignments)}`;
      },
    });
  }

  function openDay(date: string) {
    if (!canManage) return;
    setPending(null);
    setEditing({ date, grades: gradesOf.get(date) ?? [...GRADES] });
  }

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700">방과후 운영일</h3>
        <p className="mt-1 text-xs text-slate-500">
          방과후 수업이 열리는 날과, 그 시간에 자습하는 학년을 지정합니다. 그날은 <b>지정한 학년만 자습 감독</b>을 편성하고
          (지정하지 않은 학년은 감독 없음), 감독은 그 학년 교사 중 방과후 수업이 없는 교사가 맡습니다(교사에게 지정된{' '}
          <b>방과후 요일</b>이면 제외). 예: 월요일 1학년 지정 → 월요일은 1학년만 편성, 2·3학년 감독 해제. 운영하지 않는 날(시험
          기간 등)에는 전 학년을 편성합니다. 이미 편성된 감독 중 맞지 않는 배정은 지정할 때 확인 후 취소됩니다.
          {canManage && ' 아래 달력에서 날짜를 누르면 그날의 자습 감독 학년을 바로 고를 수 있습니다.'}
        </p>
      </div>
      {error && <p className="whitespace-pre-line text-sm text-red-600">{error}</p>}
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
            <label className="block text-xs text-slate-500">요일</label>
            <div className="flex h-[30px] items-center gap-2 text-sm">
              {WEEKDAYS.map((w) => (
                <label key={w.value} className="flex items-center gap-0.5">
                  <input
                    type="checkbox"
                    checked={weekdays.includes(w.value)}
                    onChange={(e) =>
                      setWeekdays(e.target.checked ? [...weekdays, w.value].sort() : weekdays.filter((x) => x !== w.value))
                    }
                  />
                  {w.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500">자습 감독 학년 (방과후 교사 제외)</label>
            <div className="flex h-[30px] items-center">
              <GradeChecks value={grades} onChange={setGrades} />
            </div>
          </div>
          <button
            onClick={addRange}
            disabled={!start || grades.length === 0 || weekdays.length === 0}
            className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            운영일 추가
          </button>
          <button
            onClick={removeRange}
            disabled={!start || grades.length === 0 || weekdays.length === 0}
            className="rounded border border-slate-400 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            운영일에서 제외
          </button>
        </div>
      )}

      {pending && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <p>
            방과후 운영일 지정과 맞지 않는 감독 배정이 있습니다. 계속하면 아래 배정이 취소됩니다 (자습 없음: 그날 감독 해제,
            방과후 수업: 미배정 칸이 되어 다시 지정).
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {pending.assignments.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <button onClick={() => run(pending.request, true)} className="rounded bg-amber-700 px-3 py-1 text-xs text-white">
              배정 취소 후 저장
            </button>
            <button onClick={() => setPending(null)} className="rounded border border-amber-400 px-3 py-1 text-xs">
              그만두기
            </button>
          </div>
        </div>
      )}

      {/* 월 달력 (월~금). 날짜를 누르면 자습 감독 학년 선택 */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button onClick={() => setYm(shiftMonth(ym.year, ym.month, -1))} className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100">
            ◀
          </button>
          <span className="w-24 text-center font-medium text-slate-700">
            {ym.year}년 {ym.month}월
          </span>
          <button onClick={() => setYm(shiftMonth(ym.year, ym.month, 1))} className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100">
            ▶
          </button>
          {months.map(([key, n]) => (
            <button
              key={key}
              onClick={() => setYm({ year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) })}
              className={`rounded px-1.5 py-0.5 text-xs ${
                key === `${ym.year}-${String(ym.month).padStart(2, '0')}` ? 'bg-teal-600 text-white' : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
              }`}
            >
              {Number(key.slice(5, 7))}월 {n}일
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <div className="grid min-w-[420px] grid-cols-5 overflow-hidden rounded border border-slate-200 text-sm">
            {WEEKDAYS.map((w) => (
              <div key={w.value} className="border-b border-slate-200 bg-slate-50 py-1 text-center text-xs font-medium text-slate-600">
                {w.label}
              </div>
            ))}
            {monthGrid(ym.year, ym.month)
              .filter((week) => week.slice(1, 6).some(Boolean))
              .flatMap((week) => week.slice(1, 6))
              .map((date, i) => {
                if (!date) return <div key={`empty-${i}`} className="min-h-[52px] border-b border-r border-slate-100 bg-slate-50/50" />;
                const g = gradesOf.get(date);
                const selected = editing?.date === date;
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => openDay(date)}
                    disabled={!canManage}
                    title={g ? `방과후 운영일 · 자습 감독 ${gradesLabel(g)}` : canManage ? '눌러서 방과후 운영일로 지정' : undefined}
                    className={`min-h-[52px] border-b border-r border-slate-100 p-1 text-left align-top ${
                      g ? 'bg-teal-50' : ''
                    } ${selected ? 'ring-2 ring-inset ring-teal-600' : ''} ${canManage ? 'hover:bg-teal-100' : 'cursor-default'}`}
                  >
                    <span className="text-xs text-slate-500">{Number(date.slice(8))}</span>
                    {g && (
                      <span className="mt-0.5 flex gap-0.5">
                        {g.map((grade) => (
                          <span key={grade} className="rounded bg-teal-600 px-1 text-[11px] font-medium text-white">
                            {grade}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>

        {editing && (
          <div className="flex flex-wrap items-center gap-3 rounded border border-teal-300 bg-teal-50/60 p-2 text-sm">
            <span className="font-medium text-slate-800">{longDateLabel(editing.date)}</span>
            <span className="text-xs text-slate-500">자습 감독 학년</span>
            <GradeChecks value={editing.grades} onChange={(gr) => setEditing({ ...editing, grades: gr })} />
            <button onClick={() => saveDay(editing.date, editing.grades)} className="rounded bg-slate-800 px-3 py-1 text-xs text-white">
              {editing.grades.length === 0 ? '운영일에서 빼기' : '저장'}
            </button>
            <button onClick={() => setEditing(null)} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600">
              닫기
            </button>
            <span className="text-xs text-slate-500">모든 학년을 해제하면 그날은 방과후 운영일에서 빠집니다.</span>
          </div>
        )}

        {days.length === 0 && (
          <p className="text-center text-xs text-slate-400">
            등록된 방과후 운영일이 없습니다. 운영일이 없으면 방과후 요일 교사도 모든 날 감독에 배정될 수 있습니다.
          </p>
        )}
      </div>
    </div>
  );
}
