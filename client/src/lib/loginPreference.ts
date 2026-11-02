/**
 * 이 브라우저에서 이메일 로그인을 쓰는지 기억한다. 교사가 이메일을 등록(개인정보 수집 동의)하거나 이메일로 로그인하면
 * 켜고, 동의를 철회하면 끈다. 켜져 있으면 로그인 화면에 이메일 인증만 보인다.
 * 화면 표시용 편의 기능이고 보안 경계가 아니다 (서버는 ID·PIN 로그인도 그대로 받는다).
 */
const KEY = 'dutycal.emailLogin';

export function prefersEmailLogin(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setEmailLoginPreference(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // 저장소를 못 쓰면 기본(ID·PIN) 화면을 보여 준다
  }
}
