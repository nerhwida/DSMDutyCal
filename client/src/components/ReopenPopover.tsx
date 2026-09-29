import { useState } from 'react';
import { api } from '../api/client';
import type { Grade } from '../types';

/** 마감 해제 (F8): ADMIN 전용, 본인 PIN 재확인. */
export function ReopenPopover({
  year,
  month,
  grade,
  onDone,
  onCancel,
}: {
  year: number;
  month: number;
  grade: Grade;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/months/${year}/${month}/grades/${grade}/reopen`, { pin });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : '마감 해제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="font-semibold text-slate-800">
        {month}월 {grade}학년 마감 해제
      </p>
      <p className="text-xs text-slate-500">확정 상태로 되돌립니다. 본인 PIN을 다시 입력해주세요. 작업 기록에 남습니다.</p>
      <input
        type="password"
        inputMode="numeric"
        autoFocus
        placeholder="PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        className="w-full rounded border border-slate-300 px-2 py-1"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded border border-slate-300 px-3 py-1.5 text-slate-600">
          취소
        </button>
        <button type="submit" disabled={busy || pin.length < 4} className="rounded bg-red-700 px-3 py-1.5 text-white disabled:opacity-40">
          마감 해제
        </button>
      </div>
    </form>
  );
}
