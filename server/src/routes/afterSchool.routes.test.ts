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
const ALL = [1, 2, 3];

describe('방과후 운영일', () => {
  it('학년부장은 기간을 등록(평일만)·일부 제외할 수 있고, 일반 교사는 조회만 가능하다', async () => {
    const head = await loginAgent('2학년부장', '2222');

    // 학년 생략 시 전 학년: 평일 10일 × 3개 학년
    const add = await head.post('/api/after-school-days').send({ startDate: '2036-03-01', endDate: '2036-03-15' });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ days: 10, added: 30, alreadyRegistered: 0 }); // 주말 제외

    const again = await head.post('/api/after-school-days').send({ startDate: '2036-03-03', endDate: '2036-03-04', grades: [1] });
    expect(again.body).toMatchObject({ added: 0, alreadyRegistered: 2 });

    // 시험 주간(3/10~3/14) 제외
    const removed = await head.delete('/api/after-school-days?from=2036-03-10&to=2036-03-14');
    expect(removed.body.removed).toBe(15);

    const teacher = await loginAgent('평교사', '4444');
    const list = await teacher.get('/api/after-school-days?from=2036-03-01&to=2036-03-31');
    expect(list.status).toBe(200);
    expect(list.body).toEqual(
      ['2036-03-03', '2036-03-04', '2036-03-05', '2036-03-06', '2036-03-07'].map((date) => ({ date, grades: ALL })),
    );

    expect((await teacher.post('/api/after-school-days').send({ startDate: '2036-04-01' })).status).toBe(403);
    expect((await teacher.delete('/api/after-school-days?from=2036-03-03')).status).toBe(403);

    // 하루의 일부 학년만 삭제
    expect((await head.delete('/api/after-school-days?from=2036-03-03&grades=1,3')).body.removed).toBe(2);
    const after = await teacher.get('/api/after-school-days?from=2036-03-03&to=2036-03-03');
    expect(after.body).toEqual([{ date: '2036-03-03', grades: [2] }]);
  });

  it('학년을 지정해 등록할 수 있다', async () => {
    const admin = await loginAgent(process.env.ADMIN_NAME!, process.env.ADMIN_INITIAL_PIN!);
    const add = await admin.post('/api/after-school-days').send({ startDate: '2036-04-07', endDate: '2036-04-08', grades: [3, 1] });
    expect(add.body).toMatchObject({ days: 2, added: 4 });
    const list = await admin.get('/api/after-school-days?from=2036-04-07&to=2036-04-08');
    expect(list.body).toEqual([
      { date: '2036-04-07', grades: [1, 3] },
      { date: '2036-04-08', grades: [1, 3] },
    ]);
    expect((await admin.post('/api/after-school-days').send({ startDate: '2036-04-09', grades: [] })).status).toBe(400);
  });

  it('잘못된 기간은 400', async () => {
    const admin = await loginAgent(process.env.ADMIN_NAME!, process.env.ADMIN_INITIAL_PIN!);
    expect((await admin.post('/api/after-school-days').send({ startDate: '2036-05-10', endDate: '2036-05-01' })).status).toBe(400);
    expect((await admin.post('/api/after-school-days').send({ startDate: '2036/05/10' })).status).toBe(400);
  });

  it('달력 데이터에 방과후 운영일과 적용 학년이 포함된다', async () => {
    const admin = await loginAgent(process.env.ADMIN_NAME!, process.env.ADMIN_INITIAL_PIN!);
    await admin.post('/api/after-school-days').send({ startDate: '2036-06-02', endDate: '2036-06-03', grades: [2] });
    const view = await admin.get('/api/months/2036/6');
    expect(view.body.afterSchoolDays).toEqual([
      { date: '2036-06-02', grades: [2] },
      { date: '2036-06-03', grades: [2] },
    ]);
  });
});
