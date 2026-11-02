import { createHash, randomBytes } from 'node:crypto';

/** 로그인에 쓸 수 있는 학교 Google Workspace 도메인. */
export const SCHOOL_EMAIL_DOMAIN = 'dsm.hs.kr';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** 소문자·공백 제거 후 @dsm.hs.kr 주소면 반환, 아니면 null. */
export function normalizeSchoolEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return /^[a-z0-9._%+-]+@dsm\.hs\.kr$/.test(email) ? email : null;
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** .env의 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI. 하나라도 없으면 null (Google 로그인 꺼짐). */
export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

/** 로그인 흐름 하나의 임시 값. 세션에 두고 callback에서 확인한다. */
export interface GoogleFlow {
  mode: 'LOGIN' | 'LINK';
  /** LINK: 연결을 시작한 교사 (callback 때 세션의 교사와 같아야 한다). */
  teacherId?: number;
  state: string;
  nonce: string;
  verifier: string;
  startedAt: number;
}

export const FLOW_TTL_MS = 10 * 60 * 1000;

const randomToken = () => randomBytes(32).toString('base64url');

export function newFlow(mode: GoogleFlow['mode'], teacherId?: number): GoogleFlow {
  return { mode, teacherId, state: randomToken(), nonce: randomToken(), verifier: randomToken(), startedAt: Date.now() };
}

/** Google 로그인 화면 주소 (PKCE S256, 학교 도메인 계정만 고르도록 hd 지정). */
export function authorizationUrl(config: GoogleConfig, flow: GoogleFlow): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
    code_challenge_method: 'S256',
    hd: SCHOOL_EMAIL_DOMAIN,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

export type GoogleIdentity = { email: string };

export type GoogleFailure = 'INVALID_TOKEN' | 'NOT_SCHOOL_ACCOUNT';

/**
 * 토큰 엔드포인트에서 TLS로 직접 받은 id_token의 클레임 확인. (Google 문서: 직접 받은 토큰은 서명 검증을 생략할 수 있다.)
 * 발급자·대상(client id)·만료·nonce와, 학교 Workspace(hd) 계정의 인증된 이메일인지 본다.
 */
export function identityFromIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string },
  now = Date.now(),
): GoogleIdentity | GoogleFailure {
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    return 'INVALID_TOKEN';
  }
  if (
    !GOOGLE_ISSUERS.has(String(claims.iss)) ||
    claims.aud !== expected.clientId ||
    typeof claims.exp !== 'number' ||
    claims.exp * 1000 <= now ||
    claims.nonce !== expected.nonce
  ) {
    return 'INVALID_TOKEN';
  }
  const email = typeof claims.email === 'string' ? normalizeSchoolEmail(claims.email) : null;
  if (!email || claims.email_verified !== true || claims.hd !== SCHOOL_EMAIL_DOMAIN) return 'NOT_SCHOOL_ACCOUNT';
  return { email };
}

/** 인증 코드 → id_token 교환. 테스트에서 바꿔 끼울 수 있도록 객체로 둔다. */
export const googleOAuth = {
  async exchangeCode(config: GoogleConfig, code: string, verifier: string): Promise<string> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!res.ok || !body.id_token) throw new Error(`Google 토큰 교환 실패: ${res.status} ${body.error ?? ''}`);
    return body.id_token;
  },
};
