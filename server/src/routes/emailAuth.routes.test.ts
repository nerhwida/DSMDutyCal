import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { loginBody } from '../test/helpers.js';
import { hashPin } from '../auth/pin.js';
import { prisma } from '../lib/prisma.js';
import { devOutbox } from '../lib/mailer.js';

const app = createApp();

let seq = 0;

/** 테스트 전용 교사 + PIN 로그인된 agent. */
async function newTeacher(prefix: string, data: { mustChangePin?: boolean } = {}) {
  const t = await prisma.teacher.create({
    data: { name: `${prefix}_${++seq}_${Date.now()}`, pinHash: await hashPin('1234'), ...data },
  });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send(await loginBody(t.id, '1234'));
  return { id: t.id, agent };
}

const uniqueEmail = (prefix: string) => `${prefix}${++seq}.${Date.now()}@dsm.hs.kr`;

/** 해당 주소로 마지막에 보낸 메일의 6자리 코드. */
function lastCodeTo(email: string): string {
  const mail = [...devOutbox].reverse().find((m) => m.to === email);
  if (!mail) throw new Error(`${email}로 보낸 메일이 없습니다.`);
  return /\b(\d{6})\b/.exec(mail.text)![1];
}

async function register(agent: request.Agent, email: string) {
  expect((await agent.post('/api/me/email/request').send({ email, consent: true })).status).toBe(200);
  const res = await agent.post('/api/me/email/verify').send({ code: lastCodeTo(email) });
  expect(res.status).toBe(200);
}

describe('학교 이메일 등록 (개인정보 수집·이용 동의)', () => {
  it('동의하지 않았거나 학교 도메인이 아니면 거부한다', async () => {
    const t = await newTeacher('동의없음');
    const noConsent = await t.agent.post('/api/me/email/request').send({ email: uniqueEmail('a'), consent: false });
    expect(noConsent.status).toBe(400);
    expect(noConsent.body.error).toContain('동의');
    const other = await t.agent.post('/api/me/email/request').send({ email: 'teacher@gmail.com', consent: true });
    expect(other.status).toBe(400);
    const lookalike = await t.agent.post('/api/me/email/request').send({ email: 'x@evil-dsm.hs.kr', consent: true });
    expect(lookalike.status).toBe(400);
  });

  it('인증 코드를 확인하면 이메일과 동의 일시가 저장되고, 대소문자는 소문자로 맞춘다', async () => {
    const t = await newTeacher('등록');
    const email = uniqueEmail('reg');
    expect((await t.agent.post('/api/me/email/request').send({ email: email.toUpperCase(), consent: true })).status).toBe(200);
    // 1분 안에 다시 요청하면 거부
    expect((await t.agent.post('/api/me/email/request').send({ email, consent: true })).status).toBe(429);
    expect((await t.agent.post('/api/me/email/verify').send({ code: '000000' === lastCodeTo(email) ? '111111' : '000000' })).status).toBe(400);
    expect((await t.agent.post('/api/me/email/verify').send({ code: lastCodeTo(email) })).status).toBe(200);

    const saved = await prisma.teacher.findUniqueOrThrow({ where: { id: t.id } });
    expect(saved.email).toBe(email);
    expect(saved.emailConsentAt).not.toBeNull();
    expect((await t.agent.get('/api/auth/me')).body.email).toBe(email);
    expect(await prisma.auditLog.count({ where: { actorId: t.id, action: 'REGISTER_EMAIL' } })).toBe(1);
  });

  it('다른 교사가 등록한 이메일은 등록할 수 없다', async () => {
    const a = await newTeacher('중복A');
    const b = await newTeacher('중복B');
    const email = uniqueEmail('dup');
    await register(a.agent, email);
    expect((await b.agent.post('/api/me/email/request').send({ email, consent: true })).status).toBe(409);
  });

  it('교사 목록에서 다른 교사의 이메일은 보이지 않는다 (등록 여부만)', async () => {
    const a = await newTeacher('목록A');
    const b = await newTeacher('목록B');
    await register(a.agent, uniqueEmail('list'));
    const list = await b.agent.get('/api/teachers');
    const row = list.body.find((t: { id: number }) => t.id === a.id);
    expect(row.hasEmail).toBe(true);
    expect(row.email).toBeUndefined();
    expect(row.emailConsentAt).toBeUndefined();
  });
});

describe('이메일 인증 로그인', () => {
  it('등록한 이메일로 코드를 받아 로그인하고, PIN 변경은 강제하지 않는다', async () => {
    const t = await newTeacher('메일로그인');
    const email = uniqueEmail('login');
    await register(t.agent, email);
    await prisma.teacher.update({ where: { id: t.id }, data: { mustChangePin: true } });

    const agent = request.agent(app);
    expect((await agent.post('/api/auth/email/request').send({ email })).status).toBe(200);
    expect((await agent.post('/api/auth/email/verify').send({ email, code: '12345' })).status).toBe(400);
    const res = await agent.post('/api/auth/email/verify').send({ email, code: lastCodeTo(email) });
    expect(res.status).toBe(200);
    expect(res.body.mustChangePin).toBe(false);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: t.id, mustChangePin: false });

    // 코드는 한 번만 쓸 수 있다
    const again = await request(app).post('/api/auth/email/verify').send({ email, code: lastCodeTo(email) });
    expect(again.status).toBe(401);
  });

  it('등록되지 않은 주소도 같은 응답을 주지만 메일은 보내지 않는다', async () => {
    const email = uniqueEmail('nobody');
    const res = await request(app).post('/api/auth/email/request').send({ email });
    expect(res.status).toBe(200);
    expect(devOutbox.some((m) => m.to === email)).toBe(false);
    expect((await request(app).post('/api/auth/email/request').send({ email: 'a@naver.com' })).status).toBe(400);
  });

  it('코드를 5번 틀리면 그 코드로는 로그인할 수 없다', async () => {
    const t = await newTeacher('메일잠금');
    const email = uniqueEmail('lock');
    await register(t.agent, email);
    await request(app).post('/api/auth/email/request').send({ email });
    const code = lastCodeTo(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      expect((await request(app).post('/api/auth/email/verify').send({ email, code: wrong })).status).toBe(401);
    }
    expect((await request(app).post('/api/auth/email/verify').send({ email, code: wrong })).status).toBe(429);
    expect((await request(app).post('/api/auth/email/verify').send({ email, code })).status).toBe(429);
  });

  it('비활성 교사와 동의를 철회한 교사는 이메일로 로그인할 수 없다', async () => {
    const t = await newTeacher('철회');
    const email = uniqueEmail('withdraw');
    await register(t.agent, email);
    expect((await t.agent.delete('/api/me/email')).status).toBe(200);
    expect((await prisma.teacher.findUniqueOrThrow({ where: { id: t.id } })).email).toBeNull();
    const before = devOutbox.length;
    await request(app).post('/api/auth/email/request').send({ email });
    expect(devOutbox.length).toBe(before);

    const u = await newTeacher('비활성메일');
    const email2 = uniqueEmail('inactive');
    await register(u.agent, email2);
    await prisma.teacher.update({ where: { id: u.id }, data: { active: false } });
    const sent = devOutbox.length;
    await request(app).post('/api/auth/email/request').send({ email: email2 });
    expect(devOutbox.length).toBe(sent);
  });
});

describe('동의 필수 (EMAIL_CONSENT_REQUIRED)', () => {
  beforeAll(() => {
    process.env.EMAIL_CONSENT_REQUIRED = 'true';
  });
  afterAll(() => {
    process.env.EMAIL_CONSENT_REQUIRED = 'false';
  });

  it('동의·등록 전에는 내 정보·PIN 변경·등록 API만 쓸 수 있고, 등록하면 모두 쓸 수 있다', async () => {
    const t = await newTeacher('동의필수');
    const me = await t.agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: null, emailConsentRequired: true });

    const blocked = await t.agent.get('/api/teachers');
    expect(blocked.status).toBe(403);
    expect(blocked.body.requiresEmailConsent).toBe(true);
    expect((await t.agent.get('/api/me/history')).status).toBe(403);
    expect((await t.agent.put('/api/auth/pin').send({ currentPin: '1234', newPin: '5678' })).status).toBe(200);

    await register(t.agent, uniqueEmail('required'));
    expect((await t.agent.get('/api/teachers')).status).toBe(200);

    // 동의를 철회하면 다시 막힌다
    expect((await t.agent.delete('/api/me/email')).status).toBe(200);
    expect((await t.agent.get('/api/teachers')).status).toBe(403);
  });

  it('관리자도 동의 전에는 막힌다', async () => {
    const admin = await prisma.teacher.create({ data: { name: `동의관리자_${Date.now()}`, pinHash: await hashPin('1234'), isAdmin: true } });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send(await loginBody(admin.id, '1234'));
    expect((await agent.get('/api/api-clients')).status).toBe(403);
  });
});
