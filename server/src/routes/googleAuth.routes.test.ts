import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { loginBody } from '../test/helpers.js';
import { hashPin } from '../auth/pin.js';
import { prisma } from '../lib/prisma.js';
import { googleOAuth, identityFromIdToken } from '../auth/googleAuth.js';

const app = createApp();
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;

let seq = 0;
const uniqueEmail = (prefix: string) => `${prefix}${++seq}.${Date.now()}@dsm.hs.kr`;

/** Google이 돌려줄 id_token 흉내 (서명 부분은 확인하지 않는다). */
function fakeIdToken(claims: Record<string, unknown>) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'RS256' })}.${enc(claims)}.sig`;
}

/** 다음 토큰 교환에서 이 계정으로 로그인한 것처럼 응답한다. nonce는 시작 때 Google로 보낸 값을 그대로 돌려준다. */
let account: Record<string, unknown> = {};
let lastNonce = '';
beforeEach(() => {
  googleOAuth.exchangeCode = async () =>
    fakeIdToken({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 300,
      nonce: lastNonce,
      email_verified: true,
      hd: 'dsm.hs.kr',
      ...account,
    });
});

/** 시작 주소 → (Google) → callback. callback의 Location을 돌려준다. */
async function googleRoundTrip(agent: request.Agent, startPath: string, query: Record<string, string> = {}) {
  const start = await agent.get(startPath);
  expect(start.status).toBe(302);
  const url = new URL(start.headers.location);
  if (url.origin !== 'https://accounts.google.com') return start.headers.location as string;
  expect(url.searchParams.get('hd')).toBe('dsm.hs.kr');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  lastNonce = url.searchParams.get('nonce')!;
  const cb = await agent
    .get('/api/auth/google/callback')
    .query({ code: 'auth-code', state: url.searchParams.get('state')!, ...query });
  expect(cb.status).toBe(302);
  return cb.headers.location as string;
}

/** 테스트 전용 교사 + PIN 로그인된 agent. */
async function newTeacher(prefix: string, data: { mustChangePin?: boolean; isAdmin?: boolean } = {}) {
  const t = await prisma.teacher.create({
    data: { name: `${prefix}_${++seq}_${Date.now()}`, pinHash: await hashPin('1234'), ...data },
  });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send(await loginBody(t.id, '1234'));
  return { id: t.id, agent };
}

async function link(agent: request.Agent, email: string) {
  account = { email };
  expect(await googleRoundTrip(agent, '/api/auth/google/link?consent=1')).toBe('/');
}

describe('id_token 확인', () => {
  const base = {
    iss: 'accounts.google.com',
    aud: 'cid',
    exp: 2_000_000_000,
    nonce: 'n',
    email: 'Kim@DSM.hs.kr',
    email_verified: true,
    hd: 'dsm.hs.kr',
  };
  const check = (claims: Record<string, unknown>) =>
    identityFromIdToken(fakeIdToken({ ...base, ...claims }), { clientId: 'cid', nonce: 'n' }, 1_000_000_000_000);

  it('학교 Workspace 계정의 인증된 이메일만 받고, 소문자로 맞춘다', () => {
    expect(check({})).toEqual({ email: 'kim@dsm.hs.kr' });
    expect(check({ hd: undefined })).toBe('NOT_SCHOOL_ACCOUNT');
    expect(check({ email: 'kim@gmail.com', hd: undefined })).toBe('NOT_SCHOOL_ACCOUNT');
    expect(check({ email_verified: false })).toBe('NOT_SCHOOL_ACCOUNT');
  });

  it('발급자·대상·만료·nonce가 맞지 않으면 거부한다', () => {
    expect(check({ iss: 'https://evil.example' })).toBe('INVALID_TOKEN');
    expect(check({ aud: 'other' })).toBe('INVALID_TOKEN');
    expect(check({ exp: 900_000_000 })).toBe('INVALID_TOKEN');
    expect(check({ nonce: 'x' })).toBe('INVALID_TOKEN');
    expect(identityFromIdToken('garbage', { clientId: 'cid', nonce: 'n' })).toBe('INVALID_TOKEN');
  });
});

describe('Google 계정 연결 (개인정보 수집·이용 동의)', () => {
  it('동의하지 않으면 Google로 보내지 않는다', async () => {
    const t = await newTeacher('동의없음');
    const res = await t.agent.get('/api/auth/google/link');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?linkError=NO_CONSENT');
  });

  it('연결하면 이메일과 동의 일시가 저장된다', async () => {
    const t = await newTeacher('연결');
    const email = uniqueEmail('link');
    await link(t.agent, email.toUpperCase());

    const saved = await prisma.teacher.findUniqueOrThrow({ where: { id: t.id } });
    expect(saved.email).toBe(email);
    expect(saved.emailConsentAt).not.toBeNull();
    expect((await t.agent.get('/api/auth/me')).body.email).toBe(email);
    expect(await prisma.auditLog.count({ where: { actorId: t.id, action: 'REGISTER_EMAIL' } })).toBe(1);
  });

  it('다른 교사가 연결한 계정이나 학교 계정이 아닌 계정은 연결할 수 없다', async () => {
    const a = await newTeacher('중복A');
    const b = await newTeacher('중복B');
    const email = uniqueEmail('dup');
    await link(a.agent, email);
    account = { email };
    expect(await googleRoundTrip(b.agent, '/api/auth/google/link?consent=1')).toBe('/?linkError=EMAIL_TAKEN');
    account = { email: 'b@gmail.com', hd: undefined };
    expect(await googleRoundTrip(b.agent, '/api/auth/google/link?consent=1')).toBe('/?linkError=NOT_SCHOOL_ACCOUNT');
    expect((await prisma.teacher.findUniqueOrThrow({ where: { id: b.id } })).email).toBeNull();
  });

  it('교사 목록에서 다른 교사의 이메일은 보이지 않는다 (연결 여부만)', async () => {
    const a = await newTeacher('목록A');
    const b = await newTeacher('목록B');
    await link(a.agent, uniqueEmail('list'));
    const row = (await b.agent.get('/api/teachers')).body.find((t: { id: number }) => t.id === a.id);
    expect(row.hasEmail).toBe(true);
    expect(row.email).toBeUndefined();
    expect(row.emailConsentAt).toBeUndefined();
  });
});

describe('Google 로그인', () => {
  it('연결한 계정으로 로그인하고, PIN 변경은 강제하지 않는다', async () => {
    const t = await newTeacher('구글로그인');
    const email = uniqueEmail('login');
    await link(t.agent, email);
    await prisma.teacher.update({ where: { id: t.id }, data: { mustChangePin: true } });

    const agent = request.agent(app);
    account = { email };
    expect(await googleRoundTrip(agent, '/api/auth/google/login')).toBe('/');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: t.id, mustChangePin: false });
  });

  it('state가 맞지 않거나 이미 쓴 요청이면 로그인하지 않는다', async () => {
    const agent = request.agent(app);
    const state = new URL((await agent.get('/api/auth/google/login')).headers.location).searchParams.get('state')!;
    const forged = await agent.get('/api/auth/google/callback').query({ code: 'c', state: 'forged' });
    expect(forged.headers.location).toBe('/?loginError=EXPIRED');
    // 한 번 확인한 흐름은 지워지므로 진짜 state로도 다시 쓸 수 없다
    const replay = await agent.get('/api/auth/google/callback').query({ code: 'c', state });
    expect(replay.headers.location).toBe('/?loginError=EXPIRED');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('Google 화면에서 취소하거나 연결하지 않은 계정이면 알려 준다', async () => {
    const agent = request.agent(app);
    account = { email: uniqueEmail('nobody') };
    expect(await googleRoundTrip(agent, '/api/auth/google/login', { error: 'access_denied' })).toBe('/?loginError=CANCELLED');
    expect(await googleRoundTrip(agent, '/api/auth/google/login')).toBe('/?loginError=NOT_REGISTERED');
  });

  it('비활성 교사와 동의를 철회한 교사는 Google로 로그인할 수 없다', async () => {
    const t = await newTeacher('철회');
    const email = uniqueEmail('withdraw');
    await link(t.agent, email);
    expect((await t.agent.delete('/api/me/email')).status).toBe(200);
    expect((await prisma.teacher.findUniqueOrThrow({ where: { id: t.id } })).email).toBeNull();
    account = { email };
    expect(await googleRoundTrip(request.agent(app), '/api/auth/google/login')).toBe('/?loginError=NOT_REGISTERED');

    const u = await newTeacher('비활성');
    const email2 = uniqueEmail('inactive');
    await link(u.agent, email2);
    await prisma.teacher.update({ where: { id: u.id }, data: { active: false } });
    account = { email: email2 };
    expect(await googleRoundTrip(request.agent(app), '/api/auth/google/login')).toBe('/?loginError=INACTIVE');
  });

  it('GOOGLE_CLIENT_ID 등이 설정되지 않았으면 Google로 보내지 않는다', async () => {
    const saved = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_SECRET;
    try {
      const res = await request(app).get('/api/auth/google/login');
      expect(res.headers.location).toBe('/?loginError=NOT_CONFIGURED');
    } finally {
      process.env.GOOGLE_CLIENT_SECRET = saved;
    }
  });
});

describe('동의 필수 (EMAIL_CONSENT_REQUIRED)', () => {
  beforeAll(() => {
    process.env.EMAIL_CONSENT_REQUIRED = 'true';
  });
  afterAll(() => {
    process.env.EMAIL_CONSENT_REQUIRED = 'false';
  });

  it('동의·연결 전에는 내 정보·PIN 변경·연결만 쓸 수 있고, 연결하면 모두 쓸 수 있다', async () => {
    const t = await newTeacher('동의필수');
    const me = await t.agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: null, emailConsentRequired: true });

    const blocked = await t.agent.get('/api/teachers');
    expect(blocked.status).toBe(403);
    expect(blocked.body.requiresEmailConsent).toBe(true);
    expect((await t.agent.get('/api/me/history')).status).toBe(403);
    expect((await t.agent.put('/api/auth/pin').send({ currentPin: '1234', newPin: '5678' })).status).toBe(200);

    await link(t.agent, uniqueEmail('required'));
    expect((await t.agent.get('/api/teachers')).status).toBe(200);

    // 동의를 철회하면 다시 막힌다
    expect((await t.agent.delete('/api/me/email')).status).toBe(200);
    expect((await t.agent.get('/api/teachers')).status).toBe(403);
  });

  it('관리자도 동의 전에는 막힌다', async () => {
    const admin = await newTeacher('동의관리자', { isAdmin: true });
    expect((await admin.agent.get('/api/api-clients')).status).toBe(403);
  });
});
