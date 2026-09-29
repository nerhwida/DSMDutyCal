import { useState } from 'react';
import { api } from '../api/client';
import { lastDayOf, toDateString } from '../lib/date';
import type { Grade, MonthPlanStatus, RegenerateResult } from '../types';

interface RegeneratePopoverProps {
  year: number;
  month: number;
  grade: Grade;
  status: MonthPlanStatus;
  onDone: (result: RegenerateResult) => void;
  onCancel: () => void;
}

/** 부분 재편성 (F4): 기간 지정 + "수동 변경 셀도 다시 편성" 옵션. 고정 셀은 항상 유지. */
export function RegeneratePopover({ year, month, grade, status, onDone, onCancel }: RegeneratePopoverProps) {
  const min = toDateString(year, month, 1);
  const max = toDateString(year, month, lastDayOf(year, month));
  const [from, setFrom] = useState(min);
  const [to, setTo] = useState(min);
  const [includeModified, setIncludeModified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await api.post<RegenerateResult>(`/api/months/${year}/${month}/grades/${grade}/regenerate`, {
          from,
          to,
          includeModified,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '부분 재편성에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-semibold text-slate-800">
        {month}월 {grade}학년 부분 재편성
      </p>
      <div className="flex items-center gap-2">
        <input type="date" min={min} max={max} value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
        ~
        <input type="date" min={min} max={max} value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
      </div>
      <label className="flex items-center gap-1 text-xs text-slate-600">
        <input type="checkbox" checked={includeModified} onChange={(e) => setIncludeModified(e.target.checked)} />
        수동 변경 셀(↻)도 다시 편성
      </label>
      <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-500">
        <li>고정(🔒) 셀은 항상 유지됩니다.</li>
        {status === 'CONFIRMED' ? (
          <>
            <li>확정된 월이므로 교사가 바뀐 셀은 노란색(↻)으로 표시되고 변경 이력이 남습니다. 알림은 보내지 않습니다.</li>
            <li>후보 교사가 없으면 기존 배정을 그대로 둡니다.</li>
          </>
        ) : (
          <li>미리보기 상태이므로 새 결과로 바로 교체됩니다.</li>
        )}
      </ul>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded border border-slate-300 px-3 py-1.5 text-slate-600">
          취소
        </button>
        <button onClick={submit} disabled={busy || !from || !to} className="rounded bg-slate-800 px-3 py-1.5 text-white disabled:opacity-40">
          재편성
        </button>
      </div>
    </div>
  );
}
