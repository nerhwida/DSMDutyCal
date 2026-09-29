import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { findTeacherId } from '../test/helpers.js';
import { prisma } from '../lib/prisma.js';
import { hashPin } from '../auth/pin.js';

const app = createApp();

describe('GET /api/auth/teachers', () => {
  it('로그인 없이 활성 교사 이름 목록을 조회할 수 있다', async () => {
    const res = await request(app).get('/api/auth/teachers');
    expect(res.status).toBe(200);
    const names = res.body.map((t: { name: string }) => t.name);
    expect(names).toContain('1학년부장');
    // 비활성 교사는 목록에서 제외된다.
    expect(names).not.toContain('비활성교사');
  });
});

describe('POST /api/auth/login', () => {
  it('올바른 이름/PIN이면 로그인에 성공하고 세션이 생성된다', async () => {
    const teacherId = await findTeacherId('평교사');
    const agent = request.agent(app);

    const loginRes = await agent.post('/api/auth/login').send({ teacherId, pin: '4444' });
    expect(loginRes.status).toBe(200);

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.name).toBe('평교사');
    expect(meRes.body.isAdmin).toBe(false);
    expect(meRes.body.gradeHeadOf).toEqual([]);
  });

  it('PIN이 틀리면 401을 반환한다', async () => {
    const teacherId = await findTeacherId('평교사');
    const res = await request(app).post('/api/auth/login').send({ teacherId, pin: '0000' });
    expect(res.status).toBe(401);
  });

  it('ADMIN으로 로그인하면 gradeHeadOf에 1,2,3학년이 모두 포함된다 (가정 13)', async () => {
    const teacherId = await findTeacherId(process.env.ADMIN_NAME!);
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ teacherId, pin: process.env.ADMIN_INITIAL_PIN });

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.body.isAdmin).toBe(true);
    expect(meRes.body.gradeHeadOf.sort()).toEqual([1, 2, 3]);
  });

  it('2학년 부장으로 로그인하면 gradeHeadOf는 [2]다', async () => {
    const teacherId = await findTeacherId('2학년부장');
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ teacherId, pin: '2222' });

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.body.isAdmin).toBe(false);
    expect(meRes.body.gradeHeadOf).toEqual([2]);
  });

  it('비활성 교사는 로그인할 수 없다', async () => {
    const teacherId = await findTeacherId('비활성교사');
    const res = await request(app).post('/api/auth/login').send({ teacherId, pin: '5555' });
    expect(res.status).toBe(403);
  });

  it('로그인 실패가 5회 누적되면 계정이 잠긴다', async () => {
    const teacher = await prisma.teacher.create({
      data: {
        name: `잠금테스트_${Date.now()}`,
        pinHash: await hashPin('7777'),
        active: true,
      },
    });

    for (let i = 0; i < 4; i++) {
      const res = await request(app).post('/api/auth/login').send({ teacherId: teacher.id, pin: 'wrong' });
      expect(res.status).toBe(401);
    }

    const lockRes = await request(app)
      .post('/api/auth/login')
      .send({ teacherId: teacher.id, pin: 'wrong' });
    expect(lockRes.status).toBe(423);

    // 잠긴 상태에서는 올바른 PIN을 입력해도 거부된다.
    const correctPinRes = await request(app)
      .post('/api/auth/login')
      .send({ teacherId: teacher.id, pin: '7777' });
    expect(correctPinRes.status).toBe(423);
  });
});

describe('인증 없이 보호된 API 접근', () => {
  it('GET /api/auth/me는 401을 반환한다', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/auth/pin', () => {
  it('최초 로그인 시 PIN 변경을 강제한다 (mustChangePin)', async () => {
    const teacher = await prisma.teacher.create({
      data: {
        name: `신규교사_${Date.now()}`,
        pinHash: await hashPin('1234'),
        active: true,
        mustChangePin: true,
      },
    });
    const agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send({ teacherId: teacher.id, pin: '1234' });
    expect(loginRes.body.mustChangePin).toBe(true);

    const changeRes = await agent.put('/api/auth/pin').send({ currentPin: '1234', newPin: '5678' });
    expect(changeRes.status).toBe(200);

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.body.mustChangePin).toBe(false);
  });
});
