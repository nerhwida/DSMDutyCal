import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { findTeacherId, loginBody } from '../test/helpers.js';
import { prisma } from '../lib/prisma.js';

const app = createApp();
const URL = '/api/public/duty/2032/3'; // 2032-03-01은 월요일. 다른 테스트와 겹치지 않는 월.

let teacherName = '';
let admin: ReturnType<typeof request.agent>;

async function newClient(name: string) {
  const res = await admin.post('/api/api-clients').send({ name });
  expect(res.status).toBe(201);
  return res.body as { client: { id: number; keyPrefix: string }; key: string };
}

beforeAll(async () => {
  admin = request.agent(app);
  await admin
    .post('/api/auth/login')
    .send(await loginBody(await findTeacherId(process.env.ADMIN_NAME!), process.env.ADMIN_INITIAL_PIN!));

  const t = await prisma.teacher.create({ data: { name: `배포교사_${Date.now()}`, pinHash: 'x' } });
  teacherName = t.name;
  await prisma.monthPlan.create({ data: { year: 2032, month: 3, grade: 1, status: 'CONFIRMED' } });
  await prisma.monthPlan.create({ data: { year: 2032, month: 3, grade: 2, status: 'DRAFT' } });
  for (const grade of [1, 2]) {
    await prisma.assignment.create({
      data: { date: '2032-03-01', grade, teacherId: t.id, originalTeacherId: t.id, rotationGroup: 'WEEKDAY' },
    });
  }
  for (const grade of [1, 2, 3]) {
    await prisma.specialDay.create({ data: { date: '2032-03-03', grade, type: 'EVENT', title: '체육대회' } });
  }
  // 3/1(월)은 2학년만 특별 일정 → 1·3학년은 운영, 2학년 duty는 null
  await prisma.specialDay.create({ data: { date: '2032-03-01', grade: 2, type: 'EVENT', title: '2학년 수학여행' } });
});

describe('월별 감독표 배포 API (GET /api/public/duty/:year/:month)', () => {
  it('API 키도 세션도 없으면 401, 발급되지 않은 키는 401', async () => {
    expect((await request(app).get(URL)).status).toBe(401);
    expect((await request(app).get(URL).set('X-API-Key', 'dcf_wrong')).status).toBe(401);
  });

  it('연동 계정 키로 날짜별 학년 감독 교사를 받는다 (확정 학년만, DRAFT 제외)', async () => {
    const { key } = await newClient('홈페이지 연동');
    const res = await request(app).get(URL).set('X-API-Key', key);
    expect(res.status).toBe(200);
    // 최상위는 year·month·days만 (generatedAt·grades는 내보내지 않음)
    expect(Object.keys(res.body).sort()).toEqual(['days', 'month', 'year']);
    expect(res.body).toMatchObject({ year: 2032, month: 3 });
    expect(res.body.days).toHaveLength(31);

    const byDate = new Map(res.body.days.map((d: { date: string }) => [d.date, d]));
    expect(byDate.get('2032-03-01')).toEqual({
      date: '2032-03-01',
      weekday: '월',
      type: 'OPERATING',
      specialDays: [{ grade: 2, type: 'EVENT', title: '2학년 수학여행' }],
      duty: { '1': { name: teacherName }, '2': null, '3': null },
    });
    expect(byDate.get('2032-03-03')).toMatchObject({ type: 'SPECIAL' });
    expect((byDate.get('2032-03-03') as { specialDays: unknown[] }).specialDays).toHaveLength(3);
    expect(byDate.get('2032-03-02')).not.toHaveProperty('specialDays');
    expect(byDate.get('2032-03-06')).toMatchObject({ weekday: '토', type: 'WEEKEND' });
  });

  it('일별 API는 층별 감독 교사를 준다 (3학년 2층, 2학년 3층, 1학년 4층, 층 오름차순)', async () => {
    const { key } = await newClient('일별 연동');
    const names = ['일학년감독', '이학년감독', '삼학년감독'].map((n) => `${n}_${Date.now()}`);
    for (const [i, name] of names.entries()) {
      const grade = i + 1;
      const t = await prisma.teacher.create({ data: { name, pinHash: 'x' } });
      await prisma.monthPlan.create({ data: { year: 2032, month: 5, grade, status: 'CONFIRMED' } });
      await prisma.assignment.create({
        data: { date: '2032-05-03', grade, teacherId: t.id, originalTeacherId: t.id, rotationGroup: 'WEEKDAY' },
      });
    }

    const res = await request(app).get('/api/public/duty/2032/5/3').set('X-API-Key', key);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      date: '2032-05-03',
      teacher: [
        { floor: 2, teacher: names[2] },
        { floor: 3, teacher: names[1] },
        { floor: 4, teacher: names[0] },
      ],
    });

    // 감독이 없는 학년(특별 일정·미확정)은 빠지고, 주말은 빈 배열
    expect((await request(app).get('/api/public/duty/2032/3/1').set('X-API-Key', key)).body).toEqual({
      date: '2032-03-01',
      teacher: [{ floor: 4, teacher: teacherName }],
    });
    expect((await request(app).get('/api/public/duty/2032/3/6').set('X-API-Key', key)).body).toEqual({
      date: '2032-03-06',
      teacher: [],
    });

    // 없는 날짜·잘못된 형식은 400, 키 없으면 401
    expect((await request(app).get('/api/public/duty/2032/2/30').set('X-API-Key', key)).status).toBe(400);
    expect((await request(app).get('/api/public/duty/2032/3/0').set('X-API-Key', key)).status).toBe(400);
    expect((await request(app).get('/api/public/duty/2032/3/1')).status).toBe(401);
  });

  it('로그인 세션으로도 조회할 수 있다', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send(await loginBody(await findTeacherId('평교사'), '4444'));
    expect((await agent.get(URL)).status).toBe(200);
  });

  it('방과후 운영일에는 지정한 학년만 감독이 있고 나머지 학년 duty는 null이다', async () => {
    const t = await prisma.teacher.create({ data: { name: `방과후배포_${Date.now()}`, pinHash: 'x' } });
    for (const grade of [1, 2, 3]) {
      await prisma.monthPlan.create({ data: { year: 2032, month: 4, grade, status: 'CONFIRMED' } });
    }
    await prisma.assignment.create({
      data: { date: '2032-04-05', grade: 1, teacherId: t.id, originalTeacherId: t.id, rotationGroup: 'WEEKDAY' },
    });
    await prisma.afterSchoolDay.create({ data: { date: '2032-04-05', grade: 1 } });

    const res = await admin.get('/api/public/duty/2032/4');
    const day = res.body.days.find((d: { date: string }) => d.date === '2032-04-05');
    expect(day.afterSchoolGrades).toEqual([1]);
    expect(day.duty).toEqual({ '1': { name: t.name }, '2': null, '3': null });
    expect(res.body.days.find((d: { date: string }) => d.date === '2032-04-06').afterSchoolGrades).toBeUndefined();
  });

  it('잘못된 월은 400', async () => {
    const { key } = await newClient('월 검증');
    expect((await request(app).get('/api/public/duty/2032/13').set('X-API-Key', key)).status).toBe(400);
  });
});

describe('API 연동 계정 (조회 전용 권한)', () => {
  it('연동 계정 키로는 배포 API 외 다른 API를 호출할 수 없다 (403)', async () => {
    const { key } = await newClient('조회 전용');
    for (const path of ['/api/months/2032/3', '/api/teachers', '/api/stats?year=2032&month=3', '/api/api-clients']) {
      const res = await request(app).get(path).set('X-API-Key', key);
      expect(res.status, path).toBe(403);
    }
    // 로그인 세션이 있어도 키를 함께 보내면 배포 API 외에는 거부
    expect((await admin.get('/api/teachers').set('X-API-Key', key)).status).toBe(403);
  });

  it('비활성화하면 키가 막히고, 다시 활성화하면 허용된다. 마지막 사용 시각이 기록된다', async () => {
    const { client, key } = await newClient('메신저 봇');
    expect((await request(app).get(URL).set('X-API-Key', key)).status).toBe(200);

    expect((await admin.put(`/api/api-clients/${client.id}`).send({ active: false })).status).toBe(200);
    expect((await request(app).get(URL).set('X-API-Key', key)).status).toBe(401);

    await admin.put(`/api/api-clients/${client.id}`).send({ active: true });
    expect((await request(app).get(URL).set('X-API-Key', key)).status).toBe(200);

    const list = await admin.get('/api/api-clients');
    const row = list.body.find((c: { id: number }) => c.id === client.id);
    expect(row.lastUsedAt).not.toBeNull();
    expect(row).not.toHaveProperty('keyHash'); // 해시·원문은 목록에 내려주지 않는다
    expect(row.keyPrefix).toBe(key.slice(0, 8));
  });

  it('키를 재발급하면 기존 키는 즉시 무효가 된다. 삭제하면 새 키도 무효', async () => {
    const { client, key: oldKey } = await newClient('재발급');
    const regen = await admin.post(`/api/api-clients/${client.id}/regenerate`);
    expect(regen.status).toBe(200);
    const newKey = regen.body.key as string;
    expect(newKey).not.toBe(oldKey);

    expect((await request(app).get(URL).set('X-API-Key', oldKey)).status).toBe(401);
    expect((await request(app).get(URL).set('X-API-Key', newKey)).status).toBe(200);

    expect((await admin.delete(`/api/api-clients/${client.id}`)).status).toBe(200);
    expect((await request(app).get(URL).set('X-API-Key', newKey)).status).toBe(401);
  });

  it('키 원문은 DB에 저장되지 않는다 (해시만 저장)', async () => {
    const { client, key } = await newClient('해시 확인');
    const stored = await prisma.apiClient.findUniqueOrThrow({ where: { id: client.id } });
    expect(stored.keyHash).not.toContain(key);
    expect(JSON.stringify(stored)).not.toContain(key);
  });

  it('연동 계정 관리는 ADMIN만 가능하다', async () => {
    const head = request.agent(app);
    await head.post('/api/auth/login').send(await loginBody(await findTeacherId('1학년부장'), '1111'));
    expect((await head.get('/api/api-clients')).status).toBe(403);
    expect((await head.post('/api/api-clients').send({ name: 'x' })).status).toBe(403);
  });
});
