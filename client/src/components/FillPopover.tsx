import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { longDateLabel } from '../lib/date';
import { CandidateList } from './CandidateList';
import { GROUP_LABEL, type Candidate, type CellCandidatesResponse, type Grade } from '../types';

interface FillPopoverProps {
  date: string;
  grade: Grade;
  /** 자동 편성 시 미배정이 된 사유 (참고용) */
  reasons?: string[];
  onDone: () => void;
  onCancel: () => void;
}

/** 빈 칸 직접 지정 (학년부장·ADMIN). 미배정 칸과 미편성 월의 칸 모두. 관리 변경(F6)과 같은 선택 규칙. */
export function FillPopover({ date, grade, reasons, onDone, onCancel }: FillPopoverProps) {
  const [data, setData] = useState<CellCandidatesResponse | null>(null);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [force, setForce] = useState(false);
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
          {longDateLabel(date)} · {grade}학년 ·{' '}
          {data?.cell.status === 'EMPTY' ? <span className="text-slate-500">미편성</span> : <span className="text-red-600">미배정</span>}
        </p>
        {data && (
          <p className="text-xs text-slate-500">
            감독 교사를 직접 지정합니다 · 괄호 안은 이번 달 {GROUP_LABEL[data.cell.rotationGroup]} 감독 횟수
          </p>
        )}
        {data?.cell.status === 'EMPTY' && (
          <p className="mt-1 text-xs text-amber-700">
            아직 편성하지 않은 달입니다. 지정하면 이 달 {grade}학년이 미리보기 상태가 되고, 나머지 칸은 비어 있는 채로 남습니다.
            이후 자동 편성을 실행해도 직접 지정한 칸은 유지됩니다.
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
        <CandidateList
          candidates={data.candidates}
          grade={grade}
          selectedId={teacherId}
          selectable={selectable}
          onSelect={setTeacherId}
        />
      )}

      <div className="space-y-1 text-xs text-slate-600">
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
