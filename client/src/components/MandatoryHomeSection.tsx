import { useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { longDateLabel, weekdayOf } from '../lib/date';
import type { Grade, SpecialDay } from '../types';
import { GradeChecks, gradesLabel } from './GradeChecks';

const GRADES: Grade[] = [1, 2, 3];
const DEFAULT_TITLE = '의무귀가';

/** 화면 표시 단위: 같은 일정명·학년으로 이어지는 평일(금→월 포함)을 한 줄로 묶는다. */
interface MandatoryRange {
  key: string;
  start: string;
  end: string;
  title: string;
  grades: Grade[];
  ids: number[];
}

function nextWeekday(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + (weekdayOf(d) === 5 ? 3 : 1));
  return t.toISOString().slice(0, 10);
}

function toRanges(rows: SpecialDay[]): MandatoryRange[] {
  // 날짜별 (일정명, 학년) 묶음
  const byDate = new Map<string, { date: string; title: string; grades: Grade[]; ids: number[] }>();
  for (const r of rows) {
    const k = `${r.date}\u0000${r.title}`;
    if (!byDate.has(k)) byDate.set(k, { date: r.date, title: r.title, grades: [], ids: [] });
    const d = byDate.get(k)!;
    d.grades.push(r.grade);
    d.ids.push(r.id);
  }
  const days = [...byDate.values()]
    .map((d) => ({ ...d, grades: d.grades.sort() }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

  const ranges: MandatoryRange[] = [];
  for (const d of days) {
    const last = ranges.find(
      (r) => r.title === d.title && r.grades.join() === d.grades.join() && nextWeekday(r.end) === d.date,
    );
    if (last) {
      last.end = d.date;
      last.ids.push(...d.ids);
    } else {
      ranges.push({ key: `${d.date}\u0000${d.title}`, start: d.date, end: d.date, title: d.title, grades: d.grades, ids: [...d.ids] });
    }
  }
  return ranges;
}

/**
 * 의무귀가일 등록. 특별 일정(유형 MANDATORY_HOME)으로 저장하되, 방과후 운영일처럼 별도 영역에서 기간·감독 제외 학년으로 관리한다.
 * 체크한 학년은 그날 감독을 편성하지 않는다.
 */
export function MandatoryHomeSection({
  canManage,
  days,
  onChanged,
}: {
  canManage: boolean;
  days: SpecialDay[];
  onChanged: () => Promise<void>;
}) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [grades, setGrades] = useState<Grade[]>([...GRADES]);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [conflictCells, setConflictCells] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ranges = useMemo(() => toRanges(days.filter((d) => d.type === 'MANDATORY_HOME')), [days]);

  async function add(confirmDeleteAssignments = false) {
    setError(null);
    setMessage(null);
    setConflictCells(null);
    try {
      const created = await api.post<SpecialDay[]>('/api/special-days', {
        startDate: start,
        endDate: end || start,
        type: 'MANDATORY_HOME',
        title: title.trim() || DEFAULT_TITLE,
        grades,
        weekdaysOnly: true,
        confirmDeleteAssignments,
      });
      const dayCount = new Set(created.map((d) => d.date)).size;
      setMessage(`의무귀가 ${dayCount}일을 등록했습니다.`);
      setStart('');
      setEnd('');
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { warning?: boolean; conflictingCells?: string[] } | undefined;
        if (body?.warning) setConflictCells(body.conflictingCells ?? []);
      }
      setError(err instanceof Error ? err.message : '등록에 실패했습니다.');
    }
  }

  async function remove(range: MandatoryRange) {
    setError(null);
    setMessage(null);
    try {
      await api.delete(`/api/special-days?ids=${range.ids.join(',')}`);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    }
  }

  const label = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700">의무귀가</h3>
        <p className="mt-1 text-xs text-slate-500">
          자율학습 없이 귀가하는 날입니다. 체크한 학년은 그날 감독을 편성하지 않습니다. 기간을 넣으면 그 안의 평일(월~금)이 모두
          등록됩니다.
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
            <label className="block text-xs text-slate-500">일정명</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-32 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500">감독 제외 학년</label>
            <div className="flex h-[30px] items-center">
              <GradeChecks
                value={grades}
                onChange={(g) => {
                  setGrades(g);
                  setConflictCells(null);
                }}
              />
            </div>
          </div>
          <button
            onClick={() => add(false)}
            disabled={!start || grades.length === 0}
            className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            의무귀가 등록
          </button>
        </div>
      )}

      {conflictCells && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <p>이미 감독 배정이 있는 날짜·학년이 포함되어 있습니다: {conflictCells.join(', ')}</p>
          <p>계속 등록하면 해당 학년의 배정만 삭제됩니다.</p>
          <button onClick={() => add(true)} className="mt-2 rounded bg-amber-700 px-3 py-1 text-xs text-white">
            배정 삭제 후 등록
          </button>
        </div>
      )}

      <ul className="divide-y divide-slate-100 rounded border border-slate-200 text-sm">
        {ranges.map((r) => (
          <li key={r.key} className="flex items-center gap-3 px-3 py-1.5">
            <span className="w-40 shrink-0 text-slate-800" title={r.start === r.end ? longDateLabel(r.start) : undefined}>
              {Number(r.start.slice(0, 4))}. {r.start === r.end ? label(r.start) : `${label(r.start)}~${label(r.end)}`}
            </span>
            <span className={r.grades.length === 3 ? 'text-slate-600' : 'rounded bg-amber-50 px-1.5 text-amber-800'}>
              {gradesLabel(r.grades)}
            </span>
            {r.title !== DEFAULT_TITLE && <span className="text-slate-600">{r.title}</span>}
            {canManage && (
              <button className="ml-auto text-xs text-red-600 underline" onClick={() => remove(r)}>
                삭제
              </button>
            )}
          </li>
        ))}
        {ranges.length === 0 && <li className="px-3 py-3 text-center text-xs text-slate-400">등록된 의무귀가일이 없습니다.</li>}
      </ul>
    </div>
  );
}
