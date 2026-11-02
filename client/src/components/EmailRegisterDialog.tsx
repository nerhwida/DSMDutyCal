import { useState } from 'react';
import { api } from '../api/client';

export const SCHOOL_EMAIL_DOMAIN = 'dsm.hs.kr';

interface EmailRegisterDialogProps {
  onDone: () => void;
  /** 닫기. required면 '동의하지 않음'(로그아웃), 아니면 '나중에 하기'. */
  onClose: () => void;
  /** 동의 필수: 동의하지 않으면 서비스를 쓸 수 없다. */
  required?: boolean;
}

/** 개인정보 수집·이용 동의 + 학교 이메일 등록 (인증 코드 확인). 등록하면 이메일 인증으로 로그인할 수 있다. */
export function EmailRegisterDialog({ onDone, onClose, required = false }: EmailRegisterDialogProps) {
  const [localPart, setLocalPart] = useState('');
  const [consent, setConsent] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const email = `${localPart.trim()}@${SCHOOL_EMAIL_DOMAIN}`;

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/me/email/request', { email, consent });
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
      await api.post('/api/me/email/verify', { code });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : '인증에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden">
      <div className="max-h-full w-full max-w-lg space-y-4 overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <div>
          <h2 className="text-base font-semibold text-slate-800">{required ? '개인정보 수집·이용 동의 (필수)' : '이메일 로그인 등록'}</h2>
          <p className="mt-1 text-sm text-slate-500">
            학교 이메일(@{SCHOOL_EMAIL_DOMAIN})을 등록하면 다음부터는 PIN 대신 메일로 받은 인증 코드로 로그인합니다.
          </p>
        </div>

        <section className="rounded border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
          <p className="mb-1 font-semibold text-slate-800">개인정보 수집·이용 동의</p>
          <table className="w-full">
            <tbody>
              <tr>
                <th className="w-20 py-0.5 pr-2 text-left align-top font-medium">수집 항목</th>
                <td>학교 이메일 주소(@{SCHOOL_EMAIL_DOMAIN}), 동의 일시</td>
              </tr>
              <tr>
                <th className="py-0.5 pr-2 text-left align-top font-medium">이용 목적</th>
                <td>DutyCal 로그인 본인 확인 (인증 코드 메일 발송)</td>
              </tr>
              <tr>
                <th className="py-0.5 pr-2 text-left align-top font-medium">보유 기간</th>
                <td>동의 철회 또는 교사 계정 삭제 시까지 (철회하면 바로 삭제)</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2">
            {required
              ? '동의하지 않을 권리가 있으나, 동의하지 않으면 DutyCal 서비스를 이용할 수 없습니다. 동의는 내 정보에서 철회할 수 있으며 철회하면 서비스 이용이 중지됩니다.'
              : "동의하지 않을 권리가 있으며, 동의하지 않아도 기존 ID·PIN으로 계속 로그인할 수 있습니다. 동의는 '내 감독' 화면의 내 정보에서 언제든 철회할 수 있습니다."}{' '}
            이메일 주소는 본인과 관리자만 볼 수 있습니다.
          </p>
        </section>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={sentTo !== null} />
          위 개인정보 수집·이용에 동의합니다. <span className="text-red-600">(필수)</span>
        </label>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">학교 이메일</label>
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center rounded border border-slate-300">
              <input
                type="text"
                autoComplete="username"
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value.replace(/@.*/, '').replace(/\s/g, ''))}
                disabled={sentTo !== null}
                className="w-full min-w-0 rounded-l px-2 py-1.5 text-sm"
              />
              <span className="pr-2 text-sm text-slate-500">@{SCHOOL_EMAIL_DOMAIN}</span>
            </div>
            {sentTo === null && (
              <button
                onClick={requestCode}
                disabled={busy || !consent || !localPart.trim()}
                className="shrink-0 rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
              >
                인증 코드 받기
              </button>
            )}
          </div>
        </div>

        {sentTo && (
          <form onSubmit={verify} className="space-y-2">
            <p className="text-xs text-slate-600">
              <b>{sentTo}</b>로 6자리 인증 코드를 보냈습니다. 10분 안에 입력해주세요.{' '}
              <button type="button" className="text-slate-500 underline" onClick={() => setSentTo(null)}>
                주소 다시 입력
              </button>
            </p>
            <div className="flex gap-2">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                placeholder="인증 코드 6자리"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm tracking-widest"
              />
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
              >
                등록
              </button>
            </div>
            <button type="button" onClick={requestCode} disabled={busy} className="text-xs text-slate-500 underline">
              코드 다시 받기
            </button>
          </form>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end">
          <button onClick={onClose} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600">
            {required ? '동의하지 않음 (로그아웃)' : '나중에 하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
