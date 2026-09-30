import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { longDateLabel } from '../lib/date';
import { GROUP_LABEL, type Candidate, type CandidatesResponse } from '../types';

interface ManagePopoverProps {
  assignmentId: number;
  onDone: () => void;
  onCancel: () => void;
}

/** F6 관리 목적 감독 변경 팝오버 (학년부장·ADMIN). */
export function ManagePopover({ assignmentId, onDone, onCancel }: ManagePopoverProps) {
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [force, setForce] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<CandidatesResponse>(`/api/assignments/${assignmentId}/candidates`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : '교사 목록을 불러오지 못했습니다.'));
  }, [assignmentId]);

  if (!data) {
    return <p className="text-xs text-slate-500">{error ?? '불러오는 중…'}</p>;
  }
  const { assignment, candidates } = data;
  const closed = assignment.status === 'CLOSED';
  const selectable = (c: Candidate) => !c.isCurrent && !c.blocking && (c.warnings.length === 0 || force);
  const selected = candidates.find((c) => c.teacherId === teacherId) ?? null;

  async function save() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/assignments/${assignmentId}`, {
        teacherId: selected.teacherId,
        note: note || undefined,
        force: force || undefined,
      });
      onDone();
    } catch (err) {
      const warnings = err instanceof ApiError ? (err.body as { warnings?: string[] })?.warnings : undefined;
      setError([err instanceof Error ? err.message : '변경에 실패했습니다.', ...(warnings ?? [])].join('\n'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="font-semibold text-slate-800">
          {longDateLabel(assignment.date)} · {assignment.grade}학년
        </p>
        <p className="text-xs text-slate-500">
          현재 감독: {assignment.teacherName} · 괄호 안은 이번 달 {GROUP_LABEL[assignment.rotationGroup]} 감독 횟수
        </p>
      </div>

      <ul className="max-h-60 overflow-y-auto rounded border border-slate-200">
        {candidates.map((c) => {
          const reason = c.blocking ?? (c.warnings.length > 0 ? c.warnings.join(', ') : null);
          const enabled = selectable(c);
          return (
            <li key={c.teacherId}>
              <button
                type="button"
                disabled={!enabled || closed}
                onClick={() => setTeacherId(c.teacherId)}
                className={`flex w-full items-center justify-between px-2 py-1 text-left ${
                  teacherId === c.teacherId ? 'bg-slate-800 text-white' : enabled ? 'hover:bg-slate-50' : 'text-slate-300'
                }`}
              >
                <span>
                  {c.name} <span className="text-xs opacity-70">({c.monthCount})</span>
                  {c.isCurrent && <span className="ml-1 text-xs">· 현재</span>}
                  {c.isOriginal && !c.isCurrent && <span className="ml-1 text-xs">· 최초</span>}
                </span>
                {reason && (
                  <span className={`text-xs ${c.blocking ? 'text-red-400' : 'text-amber-500'}`}>{reason}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <label className="flex items-center gap-1 text-xs text-slate-600">
        <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} disabled={closed} />
        강제 배정 (불가 사유가 있어도 선택 가능, 같은 날 다른 학년 감독 중인 교사는 제외)
      </label>
      {force && selected && selected.warnings.length > 0 && (
        <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          ⚠ {selected.name}: {selected.warnings.join(', ')} — 이력에 강제 배정으로 기록됩니다.
        </p>
      )}

      <input
        placeholder="메모 (선택)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="w-full rounded border border-slate-300 px-2 py-1"
        disabled={closed}
      />

      {closed && <p className="text-xs text-slate-500">마감된 월은 변경할 수 없습니다.</p>}
      {error && <p className="whitespace-pre-line text-xs text-red-600">{error}</p>}

      <div className="flex items-center justify-end">
        <div className="flex gap-2">
          <button onClick={onCancel} className="rounded border border-slate-300 px-3 py-1.5 text-slate-600">
            취소
          </button>
          <button
            onClick={save}
            disabled={busy || !selected || closed}
            className="rounded bg-slate-800 px-3 py-1.5 text-white disabled:opacity-40"
          >
            변경
          </button>
        </div>
      </div>
    </div>
  );
}
