import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { todayInSeoul, weekdayOf } from '../lib/date';
import type { AfterSchoolRecord, MakeupNote } from '../types';

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** '2026-09-16' → '09.16.(수)' */
function shortDate(date: string): string {
  return `${date.slice(5, 7)}.${date.slice(8, 10)}.(${WEEKDAY_KO[weekdayOf(date)]})`;
}

type RecordForm = {
  date: string;
  courseName: string;
  instructorName: string;
  studentCount: string;
  studyRoom: string;
  note: string;
};

const emptyForm = (): RecordForm => ({
  date: todayInSeoul(),
  courseName: '',
  instructorName: '',
  studentCount: '',
  studyRoom: '',
  note: '',
});

const toForm = (r: AfterSchoolRecord): RecordForm => ({
  date: r.date,
  courseName: r.courseName,
  instructorName: r.instructorName,
  studentCount: String(r.studentCount),
  studyRoom: r.studyRoom,
  note: r.note ?? '',
});

// 인원을 비우면 보내지 않아 서버가 '인원을 입력해주세요.'로 답한다
const toBody = (f: RecordForm) => ({ ...f, studentCount: f.studentCount.trim() === '' ? undefined : Number(f.studentCount) });

const inputClass = 'w-full rounded border border-slate-300 px-1.5 py-1 text-sm';

/**
 * 방과후 보강 (모든 교사).
 * 왼쪽: 방과후 휴강·자습 현황 표 (누적), 오른쪽: 보강 계획 시 참고 사항 (한 줄 글).
 * 누구나 등록할 수 있고, 수정·삭제는 작성자와 관리자·학년부장만 할 수 있다 (서버가 canEdit으로 알려 준다).
 */
export function MakeupPage() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <RecordsSection />
      </div>
      <div className="lg:col-span-2">
        <NotesSection />
      </div>
    </div>
  );
}

function RecordsSection() {
  const [records, setRecords] = useState<AfterSchoolRecord[]>([]);
  const [form, setForm] = useState<RecordForm>(emptyForm);
  const [editing, setEditing] = useState<{ id: number; form: RecordForm } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRecords(await api.get<AfterSchoolRecord[]>('/api/makeup/records'));
    } catch (err) {
      setError(err instanceof Error ? err.message : '목록을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.');
    }
  }

  const add = () =>
    run(async () => {
      await api.post('/api/makeup/records', toBody(form));
      // 같은 날 여러 강좌를 이어서 넣기 쉽도록 날짜는 남긴다
      setForm({ ...emptyForm(), date: form.date });
    });

  const save = () =>
    editing &&
    run(async () => {
      await api.put(`/api/makeup/records/${editing.id}`, toBody(editing.form));
      setEditing(null);
    });

  const remove = (r: AfterSchoolRecord) => {
    if (!window.confirm(`${shortDate(r.date)} ${r.courseName} 기록을 삭제할까요?`)) return;
    run(() => api.delete(`/api/makeup/records/${r.id}`).then(() => undefined));
  };

  // 줄마다 Enter로 저장 (새 줄은 추가, 수정 줄은 저장)
  const fields = (f: RecordForm, set: (f: RecordForm) => void, onEnter: () => void) => {
    const onKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onEnter();
      }
    };
    const input = (key: keyof RecordForm, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
      <td className="px-1 py-1">
        <input
          value={f[key]}
          onChange={(e) => set({ ...f, [key]: e.target.value })}
          onKeyDown={onKeyDown}
          className={inputClass}
          {...props}
        />
      </td>
    );
    return (
      <>
        {input('date', { type: 'date' })}
        {input('courseName', { placeholder: '강좌명' })}
        {input('instructorName', { placeholder: '담당 교사' })}
        {input('studentCount', { type: 'number', min: 0, className: `${inputClass} w-16` })}
        {input('studyRoom', { placeholder: '자습 장소' })}
        {input('note', { placeholder: '예: 10.01.(목) 보강' })}
      </>
    );
  };

  return (
    <section className="rounded border border-slate-200 bg-white">
      <div className="flex items-baseline justify-between border-b border-slate-100 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-800">방과후 휴강·자습 현황</h2>
        <span className="text-xs text-slate-500">총 {records.length}건</span>
      </div>
      {error && <p className="whitespace-pre-line px-3 pt-2 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="w-36 px-2 py-1.5 text-left">날짜</th>
              <th className="px-2 py-1.5 text-left">방과후학교 강좌명</th>
              <th className="w-24 px-2 py-1.5 text-left">강좌담당교사명</th>
              <th className="w-16 px-2 py-1.5 text-left">인원</th>
              <th className="w-24 px-2 py-1.5 text-left">자습 장소</th>
              <th className="px-2 py-1.5 text-left">비고</th>
              <th className="w-24 px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {/* 새로 입력 */}
            <tr className="border-b border-slate-200 bg-sky-50/40">
              {fields(form, setForm, add)}
              <td className="px-1 py-1 text-center">
                <button type="button" onClick={add} className="rounded bg-slate-800 px-3 py-1 text-xs text-white hover:bg-slate-700">
                  추가
                </button>
              </td>
            </tr>
            {records.map((r) =>
              editing?.id === r.id ? (
                <tr key={r.id} className="border-t border-slate-100 bg-amber-50/50">
                  {fields(editing.form, (f) => setEditing({ id: r.id, form: f }), save)}
                  <td className="space-x-1 whitespace-nowrap px-1 py-1 text-center">
                    <button type="button" onClick={save} className="rounded bg-slate-800 px-2 py-0.5 text-xs text-white">
                      저장
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="text-xs text-slate-600 underline">
                      취소
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className="border-t border-slate-100" title={r.createdByName ? `입력: ${r.createdByName}` : undefined}>
                  <td className="px-2 py-1.5 whitespace-nowrap">{shortDate(r.date)}</td>
                  <td className="px-2 py-1.5">{r.courseName}</td>
                  <td className="px-2 py-1.5">{r.instructorName}</td>
                  <td className="px-2 py-1.5">{r.studentCount}</td>
                  <td className="px-2 py-1.5">{r.studyRoom}</td>
                  <td className="px-2 py-1.5 text-slate-600">{r.note}</td>
                  <td className="space-x-2 whitespace-nowrap px-2 py-1.5 text-center">
                    {r.canEdit && (
                      <>
                        <button type="button" onClick={() => setEditing({ id: r.id, form: toForm(r) })} className="text-xs text-slate-700 underline">
                          수정
                        </button>
                        <button type="button" onClick={() => remove(r)} className="text-xs text-red-600 underline">
                          삭제
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ),
            )}
            {records.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-xs text-slate-400">
                  등록된 기록이 없습니다. 위 줄에 입력하고 '추가'를 누르세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
        누구나 입력할 수 있고, 수정·삭제는 입력한 교사와 관리자·학년부장만 할 수 있습니다.
      </p>
    </section>
  );
}

function NotesSection() {
  const [notes, setNotes] = useState<MakeupNote[]>([]);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: number; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setNotes(await api.get<MakeupNote[]>('/api/makeup/notes'));
    } catch (err) {
      setError(err instanceof Error ? err.message : '목록을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.');
    }
  }

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    run(async () => {
      await api.post('/api/makeup/notes', { content: draft });
      setDraft('');
    });
  };

  const save = () =>
    editing &&
    run(async () => {
      await api.put(`/api/makeup/notes/${editing.id}`, { content: editing.content });
      setEditing(null);
    });

  const remove = (n: MakeupNote) => {
    if (!window.confirm('이 참고 사항을 삭제할까요?')) return;
    run(() => api.delete(`/api/makeup/notes/${n.id}`).then(() => undefined));
  };

  return (
    <section className="rounded border border-slate-200 bg-white">
      <h2 className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">보강 계획 시 참고 사항</h2>
      {error && <p className="px-3 pt-2 text-sm text-red-600">{error}</p>}

      <ul className="divide-y divide-slate-100 text-sm">
        {notes.map((n) =>
          editing?.id === n.id ? (
            <li key={n.id} className="flex gap-2 bg-amber-50/50 px-3 py-1.5">
              <input
                value={editing.content}
                onChange={(e) => setEditing({ id: n.id, content: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save();
                  if (e.key === 'Escape') setEditing(null);
                }}
                className={inputClass}
                autoFocus
              />
              <button onClick={save} className="shrink-0 rounded bg-slate-800 px-2 text-xs text-white">
                저장
              </button>
              <button onClick={() => setEditing(null)} className="shrink-0 text-xs text-slate-600 underline">
                취소
              </button>
            </li>
          ) : (
            <li key={n.id} className="group flex items-start gap-2 px-3 py-1.5" title={n.createdByName ? `입력: ${n.createdByName}` : undefined}>
              <span className="flex-1 whitespace-pre-wrap text-slate-800">{n.content}</span>
              {n.canEdit && (
                <span className="shrink-0 space-x-2">
                  <button onClick={() => setEditing({ id: n.id, content: n.content })} className="text-xs text-slate-700 underline">
                    수정
                  </button>
                  <button onClick={() => remove(n)} className="text-xs text-red-600 underline">
                    삭제
                  </button>
                </span>
              )}
            </li>
          ),
        )}
        {notes.length === 0 && <li className="px-3 py-4 text-center text-xs text-slate-400">등록된 참고 사항이 없습니다.</li>}
      </ul>

      <form onSubmit={add} className="flex gap-2 border-t border-slate-100 px-3 py-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="예: 10.22.(목) 8교시 2학년 취업역량강화캠프 사전교육(새롬홀) 예정"
          className={inputClass}
        />
        <button type="submit" disabled={!draft.trim()} className="shrink-0 rounded bg-slate-800 px-3 py-1 text-xs text-white disabled:opacity-40">
          추가
        </button>
      </form>
    </section>
  );
}
