import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { findTeacherId } from '../test/helpers.js';

/**
 * 6.5절 "권한(Supertest 통합 테스트)" 중 권한 매트릭스(F1-1) 기본 검증.
 * 실제 앱의 자동 편성 API(Phase 3)와 학년부장 지정 API를 호출한다.
 * 다른 테스트의 2026년 데이터와 겹치지 않도록 2030년 1월을 사용한다.
 */
const app = createApp();

async function loginAgent(teacherId: number, pin: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ teacherId, pin });
  return agent;
}

describe('권한 매트릭스 (F1-1)', () => {
  it('일반 교사가 자동 편성 API를 호출하면 403', async () => {
    const teacherId = await findTeacherId('평교사');
    const agent = await loginAgent(teacherId, '4444');

    const res = await agent.post('/api/months/2030/1/grades/1/generate');
    expect(res.status).toBe(403);
  });

  it('2학년 부장이 1학년 자동 편성을 호출하면 403', async () => {
    const teacherId = await findTeacherId('2학년부장');
    const agent = await loginAgent(teacherId, '2222');

    const res = await agent.post('/api/months/2030/1/grades/1/generate');
    expect(res.status).toBe(403);
  });

  it('2학년 부장이 2학년 자동 편성을 호출하면 성공', async () => {
    const teacherId = await findTeacherId('2학년부장');
    const agent = await loginAgent(teacherId, '2222');

    const res = await agent.post('/api/months/2030/1/grades/2/generate');
    expect(res.status).toBe(200);
  });

  it('ADMIN은 모든 학년의 자동 편성을 호출할 수 있다', async () => {
    const teacherId = await findTeacherId(process.env.ADMIN_NAME!);
    const agent = await loginAgent(teacherId, process.env.ADMIN_INITIAL_PIN!);

    for (const grade of [1, 2, 3]) {
      const res = await agent.post(`/api/months/2030/1/grades/${grade}/generate`);
      expect(res.status).toBe(200);
    }
  });

  it('일반 교사가 학년부장 지정 API를 호출하면 403', async () => {
    const teacherId = await findTeacherId('평교사');
    const agent = await loginAgent(teacherId, '4444');

    const res = await agent.put('/api/grade-heads/3').send({ teacherId });
    expect(res.status).toBe(403);
  });

  it('로그인하지 않은 요청은 401', async () => {
    const res = await request(app).post('/api/months/2030/1/grades/1/generate');
    expect(res.status).toBe(401);
  });
});
