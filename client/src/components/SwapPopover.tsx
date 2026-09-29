import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { dateLabel, longDateLabel, lastDayOf, shiftMonth, toDateString } from '../lib/date';
import type { Candidate, CandidatesResponse, Grade, TeacherAssignment } from '../types';

interface SwapPopoverProps {
  assignment: { id: number; date: string; grade: Grade };
  onDone: () => void;
  onCancel: () => void;
}

type Mode = 'transfer' | 'swap';

/** F1-2 본인 감독 교체 팝오버 (넘기기 / 맞교환). */
export function SwapPopover({ assignment, onDone, onCancel }: SwapPopoverProps) {
  const [mode, setMode] = useState<Mode>('transfer');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [search, setSearch] = useState('');
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [targets, setTargets] = useState<TeacherAssignment[]>([]);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingWarnings, setPendingWarnings] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<CandidatesResponse>(`/api/assignments/${assignment.id}/candidates`)
      .then((res) => setCandidates(res.candidates.filter((c) => !c.isCurrent)))
      .catch((err) => setError(err instanceof Error ? err.message : '교사 목록을 불러오지 못했습니다.'));
  }, [assignment.id]);

  // 맞교환: 선택한 교사의 이번 달·다음 달 감독 목록 (확정 월만)
  useEffect(() => {
    setTargets([]);
    setTargetId(null);
    if (mode !== 'swap' || teacherId === null) return;
    const [y, m] = assignment.date.split('-').map(Number);
    const next = shiftMonth(y, m, 1);
    const from = toDateString(y, m, 1);
    const to = toDateString(next.year, next.month, lastDayOf(next.year, next.month));
    api
      .get<TeacherAssignment[]>(`/api/teachers/${teacherId}/assignments?from=${from}&to=${to}`)
      .then(setTargets)
      .catch((err) => setError(err instanceof Error ? err.message : '감독 목록을 불러오지 못했습니다.'));
  }, [mode, teacherId, assignment.date]);

  const filtered = useMemo(
    () => candidates.filter((c) => c.name.includes(search.trim())),
    [candidates, search],
  );
  const selected = candidates.find((c) => c.teacherId === teacherId) ?? null;
  const target = targets.find((t) => t.id === targetId) ?? null;
  const canSubmit = !busy && selected !== null && (mode === 'transfer' ? !selected.blocking : target !== null);

  async function submit(confirmWarnings: boolean) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'transfer') {
        await api.post(`/api/assignments/${assignment.id}/transfer`, {
          toTeacherId: selected.teacherId,
          confirmWarnings,
          note: note || undefined,
        });
      } else {
        await api.post('/api/assignments/swap', {
          myAssignmentId: assignment.id,
          targetAssignmentId: targetId,
          confirmWarnings,
          note: note || undefined,
        });
      }
      onDone();
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { warnings?: string[]; requiresConfirmation?: boolean }) : undefined;
      if (body?.requiresConfirmation && body.warnings) {
        setPendingWarnings(body.warnings);
      } else {
        setError(err instanceof Error ? err.message : '교체에 실패했습니다.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="font-semibold text-slate-800">
          {longDateLabel(assignment.date)} · {assignment.grade}학년 · 내 감독
        </p>
      </div>

      <div className="flex gap-4 border-b border-slate-100 pb-2">
        {(['transfer', 'swap'] as const).map((m) => (
          <label key={m} className="flex items-center gap-1">
            <input
              type="radio"
              checked={mode === m}
              onChange={() => {
                setMode(m);
                setPendingWarnings(null);
              }}
            />
            {m === 'transfer' ? '넘기기' : '맞교환'}
          </label>
        ))}
      </div>

      <div>
        <input
          placeholder="교사 이름 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-1 w-full rounded border border-slate-300 px-2 py-1"
        />
        <ul className="max-h-44 overflow-y-auto rounded border border-slate-200">
          {filtered.map((c) => {
            const disabled = mode === 'transfer' && c.blocking !== null;
            return (
              <li key={c.teacherId}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setTeacherId(c.teacherId);
                    setPendingWarnings(null);
                  }}
                  className={`flex w-full items-center justify-between px-2 py-1 text-left ${
                    teacherId === c.teacherId ? 'bg-slate-800 text-white' : 'hover:bg-slate-50'
                  } ${disabled ? 'cursor-not-allowed text-slate-300' : ''}`}
                >
                  <span>{c.name}</span>
                  <span className={`text-xs ${teacherId === c.teacherId ? 'text-slate-200' : 'text-amber-600'}`}>
                    {mode === 'transfer' && (c.blocking ?? (c.warnings.length > 0 ? `⚠ ${c.warnings.join(', ')}` : ''))}
                  </span>
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && <li className="px-2 py-2 text-xs text-slate-400">해당하는 교사가 없습니다.</li>}
        </ul>
      </div>

      {mode === 'transfer' && selected && selected.warnings.length > 0 && (
        <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          ⚠ {selected.name} 선생님: {selected.warnings.join(', ')}
        </p>
      )}

      {mode === 'swap' && selected && (
        <div>
          <p className="mb-1 text-xs text-slate-500">{selected.name} 선생님의 감독 (이번 달·다음 달, 확정 월)</p>
          <ul className="max-h-36 overflow-y-auto rounded border border-slate-200">
            {targets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    setTargetId(t.id);
                    setPendingWarnings(null);
                  }}
                  className={`w-full px-2 py-1 text-left ${targetId === t.id ? 'bg-slate-800 text-white' : 'hover:bg-slate-50'}`}
                >
                  {dateLabel(t.date)} {t.grade}학년
                </button>
              </li>
            ))}
            {targets.length === 0 && <li className="px-2 py-2 text-xs text-slate-400">교환 가능한 감독이 없습니다.</li>}
          </ul>
          {target && (
            <p className="mt-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
              결과 미리보기: 나 → {dateLabel(target.date)} {target.grade}학년 / {selected.name} →{' '}
              {dateLabel(assignment.date)} {assignment.grade}학년
            </p>
          )}
        </div>
      )}

      <input
        placeholder="메모 (선택)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="w-full rounded border border-slate-300 px-2 py-1"
      />

      {error && <p className="text-xs text-red-600">{error}</p>}

      {pendingWarnings ? (
        <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
          {pendingWarnings.map((w) => (
            <p key={w}>⚠ {w}</p>
          ))}
          <p>그래도 교체할까요?</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setPendingWarnings(null)} className="rounded border border-slate-300 px-3 py-1 text-slate-600">
              취소
            </button>
            <button onClick={() => submit(true)} disabled={busy} className="rounded bg-amber-700 px-3 py-1 text-white">
              교체
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded border border-slate-300 px-3 py-1.5 text-slate-600">
            취소
          </button>
          <button
            onClick={() => submit(false)}
            disabled={!canSubmit}
            className="rounded bg-slate-800 px-3 py-1.5 text-white disabled:opacity-40"
          >
            교체
          </button>
        </div>
      )}
    </div>
  );
}
