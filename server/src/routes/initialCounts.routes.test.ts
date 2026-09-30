import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { findTeacherId, loginBody } from '../test/helpers.js';

const app = createApp();

async function loginAgent(teacherId: number, pin: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send(await loginBody(teacherId, pin));
  return agent;
}

describe('초기 누계 (F2)', () => {
  it('ADMIN은 초기 누계를 일괄 저장하고 재조회할 수 있다', async () => {
    const adminId = await findTeacherId(process.env.ADMIN_NAME!);
    const teacherId = await findTeacherId('평교사');
    const agent = await loginAgent(adminId, process.env.ADMIN_INITIAL_PIN!);

    const putRes = await agent.put('/api/initial-counts').send({
      entries: [{ teacherId, grade: 1, rotationGroup: 'WEEKDAY', count: 5 }],
    });
    expect(putRes.status).toBe(200);

    const getRes = await agent.get('/api/initial-counts');
    const entry = getRes.body.find(
      (e: { teacherId: number; grade: number; rotationGroup: string }) =>
        e.teacherId === teacherId && e.grade === 1 && e.rotationGroup === 'WEEKDAY',
    );
    expect(entry.count).toBe(5);
  });

  it('일반 교사는 초기 누계를 조회할 수 없다', async () => {
    const teacherId = await findTeacherId('평교사');
    const agent = await loginAgent(teacherId, '4444');

    const res = await agent.get('/api/initial-counts');
    expect(res.status).toBe(403);
  });
});
