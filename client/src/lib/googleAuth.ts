/** 서버(/api/auth/google/*)가 결과 코드를 붙여 화면으로 돌려보낸다: ?loginError= (로그인), ?linkError= (계정 연결). */
const MESSAGES: Record<string, string> = {
  NOT_CONFIGURED: 'Google 로그인이 아직 설정되지 않았습니다. 관리자에게 문의하세요.',
  NO_CONSENT: '개인정보 수집·이용에 동의해야 Google 계정을 연결할 수 있습니다.',
  CANCELLED: 'Google 로그인을 취소했습니다.',
  EXPIRED: '로그인 요청이 만료되었습니다. 다시 시도해주세요.',
  FAILED: 'Google 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.',
  NOT_SCHOOL_ACCOUNT: '학교 Google 계정(@dsm.hs.kr)만 사용할 수 있습니다.',
  NOT_REGISTERED: '연결되지 않은 Google 계정입니다. 처음에는 ID·PIN으로 로그인한 뒤 Google 계정을 연결해주세요.',
  INACTIVE: '비활성화된 계정입니다. 관리자에게 문의하세요.',
  EMAIL_TAKEN: '이미 다른 교사에게 연결된 Google 계정입니다.',
};

function take(param: 'loginError' | 'linkError'): string | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get(param);
  if (code === null) return null;
  params.delete(param);
  const rest = params.toString();
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
  return MESSAGES[code] ?? MESSAGES.FAILED;
}

// 페이지를 처음 열 때 한 번만 읽고 주소에서 지운다 (새로 고침하면 다시 보이지 않게).
export const googleLoginError = take('loginError');
export const googleLinkError = take('linkError');

export const GOOGLE_LOGIN_URL = '/api/auth/google/login';
export const GOOGLE_LINK_URL = '/api/auth/google/link?consent=1';
