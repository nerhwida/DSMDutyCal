import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { SCHOOL_EMAIL_DOMAIN } from '../components/GoogleLinkDialog';
import { GOOGLE_LOGIN_URL, googleLoginError } from '../lib/googleAuth';

/**
 * Google 계정과 ID·PIN 로그인을 나란히 보여 준다 (전환 기간 병행). Google 계정을 아직 연결하지 않은 교사는
 * ID·PIN으로 로그인해 개인정보 수집에 동의하고 계정을 연결한 뒤, 다음부터 Google 계정으로 로그인할 수 있다.
 */
export function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-[840px] rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-1 text-xl font-bold text-slate-800">DutyCal 로그인</h1>
        <p className="mb-6 text-sm text-slate-500">자율학습 감독 관리 시스템</p>

        <div className="grid gap-8 md:grid-cols-2 md:gap-0">
          <section className="md:pr-8">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Google 계정 로그인</h2>
            <GoogleLoginButton />
          </section>
          <section className="border-t border-slate-200 pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">ID · PIN 로그인</h2>
            <PinLoginForm />
            <p className="mt-3 text-xs text-slate-500">
              Google 계정을 아직 연결하지 않았다면 ID·PIN으로 로그인한 뒤 개인정보 수집에 동의하고 Google 계정을 연결해야 서비스를 이용할 수 있습니다.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

/** 학교 Google 계정으로 로그인. 계정을 연결(개인정보 수집 동의)한 교사만 쓸 수 있다. */
function GoogleLoginButton() {
  return (
    <div>
      <a
        href={GOOGLE_LOGIN_URL}
        className="flex w-full items-center justify-center gap-2 rounded border border-slate-300 bg-white py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <span className="font-bold text-blue-600">G</span>
        학교 Google 계정으로 로그인
      </a>
      <p className="mt-2 text-xs text-slate-500">@{SCHOOL_EMAIL_DOMAIN} 계정만 사용할 수 있습니다.</p>
      {googleLoginError && <p className="mt-3 text-sm text-red-600">{googleLoginError}</p>}
    </div>
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
