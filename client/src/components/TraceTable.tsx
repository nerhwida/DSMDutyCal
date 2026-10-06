import { useState } from 'react';
import { dateLabel } from '../lib/date';
import { GROUP_LABEL, type AssignmentTrace } from '../types';

const who = (position: number | null, name: string) => (position ? `${position}번 ${name}` : name);
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;

/**
 * 자동 편성·부분 재편성 결과의 배정 근거: 칸마다 순번·교사와,
 * 금요일 감독으로 넘긴 교사 / 그날 불가해 건너뛴 교사 / 밀린 차례 배정을 보여 준다.
 */
export function TraceTable({ trace }: { trace: AssignmentTrace[] }) {
  const [onlyNotes, setOnlyNotes] = useState(false);
  if (trace.length === 0) return null;
  const hasNote = (t: AssignmentTrace) =>
    t.owed || t.passed.length > 0 || t.skipped.length > 0 || t.waiting.length > 0;
  const rows = onlyNotes ? trace.filter(hasNote) : trace;
  const noteCount = trace.filter(hasNote).length;

  return (
    <details open className="mt-2 text-xs">
      <summary className="cursor-pointer text-slate-700">
        배정 순서와 사유 보기 ({trace.length}칸, 넘김·건너뜀 {noteCount}칸)
      </summary>
      <label className="mt-1 flex items-center gap-1 text-slate-600">
        <input type="checkbox" checked={onlyNotes} onChange={(e) => setOnlyNotes(e.target.checked)} />
        넘김·건너뜀·밀린 차례·대기가 있는 칸만
      </label>
      <div className="mt-1 max-h-72 overflow-auto rounded border border-slate-200 bg-white">
        <table className="w-full min-w-[520px]">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 py-1 text-left">날짜</th>
              <th className="px-2 py-1 text-left">구분</th>
              <th className="px-2 py-1 text-left">배정 (순번)</th>
              <th className="px-2 py-1 text-left">사유</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={`${t.date}-${t.grade}`} className={`border-t border-slate-100 ${hasNote(t) ? 'bg-amber-50/60' : ''}`}>
                <td className="whitespace-nowrap px-2 py-1">{dateLabel(t.date)}</td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-500">{GROUP_LABEL[t.group]}</td>
                <td className="whitespace-nowrap px-2 py-1 font-medium text-slate-800">{who(t.position, t.teacherName)}</td>
                <td className="px-2 py-1 text-slate-600">
                  {t.owed && <p className="text-sky-700">밀린 차례로 배정</p>}
                  {t.waiting.length > 0 && (
                    <p className="text-slate-500">
                      밀린 차례 대기: {t.waiting.map((w) => `${who(w.position, w.name)}(${w.reason})`).join(', ')}
                    </p>
                  )}
                  {t.skipped.length > 0 && (
                    <p>
                      건너뜀: {t.skipped.map((s) => `${who(s.position, s.name)}(${s.reason})`).join(', ')}
                      <span className="text-slate-400"> → 밀린 차례로 기억</span>
                    </p>
                  )}
                  {t.passed.length > 0 && (
                    <p className="text-amber-800">
                      넘김:{' '}
                      {t.passed
                        .map((p) => `${who(p.position, p.name)}(금 ${p.fridays.map(shortDate).join('·')})`)
                        .join(', ')}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
