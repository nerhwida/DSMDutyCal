import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { findTeacherId, loginBody } from '../test/helpers.js';

const app = createApp();

async function loginAgent(name: string, pin: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send(await loginBody(await findTeacherId(name), pin));
  return agent;
}

// 다른 테스트와 겹치지 않도록 2036년 사용. 2036-03-01(토)~03-15(토) 안의 평일은 3/3~3/7, 3/10~3/14 = 10일
describe('방과후 운영일', () => {
  it('학년부장은 기간을 등록(평일만)·일부 제외할 수 있고, 일반 교사는 조회만 가능하다', async () => {
    const head = await loginAgent('2학년부장', '2222');

    const add = await head.post('/api/after-school-days').send({ startDate: '2036-03-01', endDate: '2036-03-15' });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ added: 10, alreadyRegistered: 0 }); // 주말 제외

    const again = await head.post('/api/after-school-days').send({ startDate: '2036-03-03', endDate: '2036-03-04' });
    expect(again.body).toMatchObject({ added: 0, alreadyRegistered: 2 });

    // 시험 주간(3/10~3/14) 제외
    const removed = await head.delete('/api/after-school-days?from=2036-03-10&to=2036-03-14');
    expect(removed.body.removed).toBe(5);

    const teacher = await loginAgent('평교사', '4444');
    const list = await teacher.get('/api/after-school-days?from=2036-03-01&to=2036-03-31');
    expect(list.status).toBe(200);
    expect(list.body).toEqual(['2036-03-03', '2036-03-04', '2036-03-05', '2036-03-06', '2036-03-07']);

    expect((await teacher.post('/api/after-school-days').send({ startDate: '2036-04-01' })).status).toBe(403);
    expect((await teacher.delete('/api/after-school-days?from=2036-03-03')).status).toBe(403);

    // 하루만 삭제 (to 생략)
    expect((await head.delete('/api/after-school-days?from=2036-03-03')).body.removed).toBe(1);
  });

  it('잘못된 기간은 400', async () => {
    const admin = await loginAgent(process.env.ADMIN_NAME!, process.env.ADMIN_INITIAL_PIN!);
    expect((await admin.post('/api/after-school-days').send({ startDate: '2036-05-10', endDate: '2036-05-01' })).status).toBe(400);
    expect((await admin.post('/api/after-school-days').send({ startDate: '2036/05/10' })).status).toBe(400);
  });

  it('달력 데이터에 방과후 운영일이 포함된다', async () => {
    const admin = await loginAgent(process.env.ADMIN_NAME!, process.env.ADMIN_INITIAL_PIN!);
    await admin.post('/api/after-school-days').send({ startDate: '2036-06-02', endDate: '2036-06-03' });
    const view = await admin.get('/api/months/2036/6');
    expect(view.body.afterSchoolDays).toEqual(['2036-06-02', '2036-06-03']);
  });
});
