import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('ID를 입력해주세요.');
      return;
    }
    if (!/^\d{4,6}$/.test(pin)) {
      setError('PASSWD는 숫자 4~6자리로 입력해주세요.');
      return;
    }
    setSubmitting(true);
    try {
      await login(name.trim(), pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <form
        onSubmit={handleSubmit}
        className="w-[420px] rounded-lg bg-white p-8 shadow-md"
      >
        <h1 className="mb-1 text-xl font-bold text-slate-800">DutyCal 로그인</h1>
        <p className="mb-6 text-sm text-slate-500">자율학습 감독 관리 시스템</p>

        <label className="mb-1 block text-sm font-medium text-slate-700">ID</label>
        <input
          type="text"
          autoComplete="username"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />

        <label className="mb-1 block text-sm font-medium text-slate-700">PASSWD</label>
        <input
          type="password"
          autoComplete="current-password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-slate-800 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? '로그인 중...' : '로그인'}
        </button>
      </form>
    </div>
  );
}
