import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { SCHOOL_EMAIL_DOMAIN } from '../components/EmailRegisterDialog';

/**
 * 이메일 인증과 ID·PIN 로그인을 나란히 보여 준다 (전환 기간 병행). 이메일을 아직 등록하지 않은 교사는
 * ID·PIN으로 로그인해 개인정보 수집에 동의하고 이메일을 등록한 뒤, 다음부터 이메일로 로그인할 수 있다.
 */
export function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-[840px] rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-1 text-xl font-bold text-slate-800">DutyCal 로그인</h1>
        <p className="mb-6 text-sm text-slate-500">자율학습 감독 관리 시스템</p>

        <div className="grid gap-8 md:grid-cols-2 md:gap-0">
          <section className="md:pr-8">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">이메일 인증 로그인</h2>
            <EmailLoginForm />
          </section>
          <section className="border-t border-slate-200 pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">ID · PIN 로그인</h2>
            <PinLoginForm />
            <p className="mt-3 text-xs text-slate-500">
              이메일을 아직 등록하지 않았다면 ID·PIN으로 로그인한 뒤 개인정보 수집에 동의하고 이메일을 등록해야 서비스를 이용할 수 있습니다.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

/** 학교 이메일로 인증 코드를 받아 로그인. 이메일을 등록(개인정보 수집 동의)한 교사만 쓸 수 있다. */
function EmailLoginForm() {
  const { refresh } = useAuth();
  const [localPart, setLocalPart] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!localPart.trim()) {
      setError('이메일을 입력해주세요.');
      return;
    }
    const email = `${localPart.trim()}@${SCHOOL_EMAIL_DOMAIN}`;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/email/request', { email });
      setSentTo(email);
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '인증 코드를 보내지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/email/verify', { email: sentTo, code });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.');
      setBusy(false);
    }
  }

  if (!sentTo) {
    return (
      <form onSubmit={requestCode}>
        <label className="mb-1 block text-sm font-medium text-slate-700">학교 이메일</label>
        <div className="mb-4 flex items-center rounded border border-slate-300">
          <input
            type="text"
            autoComplete="username"
            autoFocus
            value={localPart}
            onChange={(e) => setLocalPart(e.target.value.replace(/@.*/, '').replace(/\s/g, ''))}
            className="w-full min-w-0 rounded-l px-3 py-2 text-sm"
          />
          <span className="pr-3 text-sm text-slate-500">@{SCHOOL_EMAIL_DOMAIN}</span>
        </div>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-slate-800 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? '보내는 중...' : '인증 코드 받기'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verify}>
      <p className="mb-3 text-sm text-slate-600">
        <b>{sentTo}</b>이(가) 등록된 이메일이면 6자리 인증 코드를 보냈습니다. 10분 안에 입력해주세요.
      </p>
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        placeholder="인증 코드 6자리"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm tracking-widest"
      />
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="w-full rounded bg-slate-800 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {busy ? '확인 중...' : '로그인'}
      </button>
      <div className="mt-3 flex justify-between text-xs text-slate-500">
        <button type="button" className="underline" onClick={() => setSentTo(null)}>
          이메일 다시 입력
        </button>
        <button type="button" className="underline" disabled={busy} onClick={() => requestCode()}>
          코드 다시 받기 (1분 뒤)
        </button>
      </div>
    </form>
  );
}

function PinLoginForm() {
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
    // 형식(숫자 4~6자리)이 맞지 않으면 서버가 'ID 또는 PASSWD가 올바르지 않습니다.'로 답한다
    if (!pin) {
      setError('PASSWD를 입력해주세요.');
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
    <form onSubmit={handleSubmit}>
      <label className="mb-1 block text-sm font-medium text-slate-700">ID</label>
      <input
        type="text"
        autoComplete="username"
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
  );
}
