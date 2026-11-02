import { useState } from 'react';
import { GOOGLE_LINK_URL, googleLinkError } from '../lib/googleAuth';

export const SCHOOL_EMAIL_DOMAIN = 'dsm.hs.kr';

interface GoogleLinkDialogProps {
  /** 닫기. required면 '동의하지 않음'(로그아웃), 아니면 '나중에 하기'. */
  onClose: () => void;
  /** 동의 필수: 동의하지 않으면 서비스를 쓸 수 없다. */
  required?: boolean;
}

/**
 * 개인정보 수집·이용 동의 + 학교 Google 계정 연결. 연결하면 다음부터 Google 계정으로 로그인한다.
 * 연결은 Google 화면을 거쳐 돌아오는 흐름이라, 실패 사유는 돌아온 주소(?linkError=)로 받는다.
 */
export function GoogleLinkDialog({ onClose, required = false }: GoogleLinkDialogProps) {
  const [consent, setConsent] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden">
      <div className="max-h-full w-full max-w-lg space-y-4 overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <div>
          <h2 className="text-base font-semibold text-slate-800">{required ? '개인정보 수집·이용 동의 (필수)' : 'Google 계정 연결'}</h2>
          <p className="mt-1 text-sm text-slate-500">
            학교 Google 계정(@{SCHOOL_EMAIL_DOMAIN})을 연결하면 다음부터는 PIN 대신 Google 계정으로 로그인합니다.
          </p>
        </div>

        <section className="rounded border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
          <p className="mb-1 font-semibold text-slate-800">개인정보 수집·이용 동의</p>
          <table className="w-full">
            <tbody>
              <tr>
                <th className="w-20 py-0.5 pr-2 text-left align-top font-medium">수집 항목</th>
                <td>학교 Google 계정 이메일 주소(@{SCHOOL_EMAIL_DOMAIN}), 동의 일시</td>
              </tr>
              <tr>
                <th className="py-0.5 pr-2 text-left align-top font-medium">이용 목적</th>
                <td>DutyCal 로그인 본인 확인 (Google 계정 로그인)</td>
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
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          위 개인정보 수집·이용에 동의합니다. <span className="text-red-600">(필수)</span>
        </label>

        {googleLinkError && <p className="text-sm text-red-600">{googleLinkError}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600">
            {required ? '동의하지 않음 (로그아웃)' : '나중에 하기'}
          </button>
          <button
            onClick={() => window.location.assign(GOOGLE_LINK_URL)}
            disabled={!consent}
            className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            동의하고 Google 계정 연결
          </button>
        </div>
      </div>
    </div>
  );
}
