import { useState } from 'react';
import { api } from '../api/client';

export function ChangePinPage({ onDone }: { onDone: () => void }) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{4,6}$/.test(newPin)) {
      setError('새 PIN은 숫자 4~6자리로 입력해주세요.');
      return;
    }
    setSubmitting(true);
    try {
      await api.put('/api/auth/pin', { currentPin, newPin });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN 변경에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <form onSubmit={handleSubmit} className="w-[420px] rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-1 text-xl font-bold text-slate-800">PIN 변경 필요</h1>
        <p className="mb-6 text-sm text-slate-500">최초 로그인 시 개인 PIN을 변경해야 합니다.</p>

        <label className="mb-1 block text-sm font-medium text-slate-700">현재 PIN</label>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={currentPin}
          onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
          className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />

        <label className="mb-1 block text-sm font-medium text-slate-700">새 PIN (4~6자리)</label>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={newPin}
          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
          className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-slate-800 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? '변경 중...' : 'PIN 변경'}
        </button>
      </form>
    </div>
  );
}
