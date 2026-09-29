import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { longDateLabel } from '../lib/date';
import { GROUP_LABEL, type Candidate, type CellCandidatesResponse, type Grade } from '../types';

interface FillPopoverProps {
  date: string;
  grade: Grade;
  /** 자동 편성 시 미배정이 된 사유 (참고용) */
  reasons?: string[];
  onDone: () => void;
  onCancel: () => void;
}

/** 미배정 칸 직접 지정 (학년부장·ADMIN). 관리 변경(F6)과 같은 선택 규칙 + 고정 옵션(기본 켬). */
export function FillPopover({ date, grade, reasons, onDone, onCancel }: FillPopoverProps) {
  const [data, setData] = useState<CellCandidatesResponse | null>(null);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [force, setForce] = useState(false);
  const [lock, setLock] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<CellCandidatesResponse>(`/api/assignments/candidates?date=${date}&grade=${grade}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : '교사 목록을 불러오지 못했습니다.'));
  }, [date, grade]);

  const selectable = (c: Candidate) => !c.blocking && (c.warnings.length === 0 || force);
  const selected = data?.candidates.find((c) => c.teacherId === teacherId) ?? null;

  async function save() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/assignments', {
        date,
        grade,
        teacherId: selected.teacherId,
        lock,
        force: force || undefined,
        note: note || undefined,
      });
      onDone();
    } catch (err) {
      const warnings = err instanceof ApiError ? (err.body as { warnings?: string[] })?.warnings : undefined;
      setError([err instanceof Error ? err.message : '지정에 실패했습니다.', ...(warnings ?? [])].join('\n'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="font-semibold text-slate-800">
          {longDateLabel(date)} · {grade}학년 · <span className="text-red-600">미배정</span>
        </p>
        {data && (
          <p className="text-xs text-slate-500">
            감독 교사를 직접 지정합니다 · 괄호 안은 이번 달 {GROUP_LABEL[data.cell.rotationGroup]} 감독 횟수
          </p>
        )}
      </div>

      {reasons && reasons.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">자동 편성에서 비어 있는 이유</summary>
          <ul className="mt-1 list-disc pl-4">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
      )}

      {!data && <p className="text-xs text-slate-500">{error ?? '불러오는 중…'}</p>}

      {data && (
        <ul className="max-h-60 overflow-y-auto rounded border border-slate-200">
          {data.candidates.map((c) => {
            const reason = c.blocking ?? (c.warnings.length > 0 ? c.warnings.join(', ') : null);
            const enabled = selectable(c);
            return (
              <li key={c.teacherId}>
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => setTeacherId(c.teacherId)}
                  className={`flex w-full items-center justify-between px-2 py-1 text-left ${
                    teacherId === c.teacherId ? 'bg-slate-800 text-white' : enabled ? 'hover:bg-slate-50' : 'text-slate-300'
                  }`}
                >
                  <span>
                    {c.name} <span className="text-xs opacity-70">({c.monthCount})</span>
                  </span>
                  {reason && <span className={`text-xs ${c.blocking ? 'text-red-400' : 'text-amber-500'}`}>{reason}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-1 text-xs text-slate-600">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
          고정 🔒 (부분 재편성에서 바뀌지 않도록)
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          강제 배정 (불가 사유가 있어도 선택 가능, 같은 날 다른 학년 감독 중인 교사는 제외)
        </label>
      </div>
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
      />

      {data && error && <p className="whitespace-pre-line text-xs text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded border border-slate-300 px-3 py-1.5 text-slate-600">
          취소
        </button>
        <button onClick={save} disabled={busy || !selected} className="rounded bg-slate-800 px-3 py-1.5 text-white disabled:opacity-40">
          지정
        </button>
      </div>
    </div>
  );
}
