import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { findTeacherId, loginBody } from '../test/helpers.js';
import { prisma } from '../lib/prisma.js';

const app = createApp();

async function loginAgent(teacherId: number, pin: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send(await loginBody(teacherId, pin));
  return agent;
}

describe('GET /api/teachers 정렬', () => {
  it('관리자가 맨 앞이고 나머지는 이름 오름차순이다', async () => {
    const agent = await loginAgent(await findTeacherId('평교사'), '4444');
    const res = await agent.get('/api/teachers');
    const list = res.body as { name: string; isAdmin: boolean }[];
    const firstNonAdmin = list.findIndex((t) => !t.isAdmin);
    expect(list[0].isAdmin).toBe(true);
    expect(list.slice(firstNonAdmin).every((t) => !t.isAdmin)).toBe(true);
    const names = list.slice(firstNonAdmin).map((t) => t.name);
    expect(names).toEqual([...names].sort());
  });
});

describe('교사 학년·방과후·금요일 설정', () => {
  it('학년부장은 담당 학년의 감독 가능 여부를 저장/재조회할 수 있다', async () => {
    const headId = await findTeacherId('2학년부장');
    const teacherId = await findTeacherId('평교사');
    const agent = await loginAgent(headId, '2222');

    const res = await agent
      .put(`/api/teachers/${teacherId}/grades`)
      .send({ grade: 2, canWeekday: true, canFriday: false });
    expect(res.status).toBe(200);
    expect(res.body.canFriday).toBe(false);

    const list = await agent.get('/api/teachers');
    const target = list.body.find((t: { id: number }) => t.id === teacherId);
    const tg = target.teacherGrades.find((g: { grade: number }) => g.grade === 2);
    expect(tg.canWeekday).toBe(true);
    expect(tg.canFriday).toBe(false);
  });

  it('2학년 부장이 1학년 설정을 변경하면 403', async () => {
    const headId = await findTeacherId('2학년부장');
    const teacherId = await findTeacherId('평교사');
    const agent = await loginAgent(headId, '2222');

    const res = await agent
      .put(`/api/teachers/${teacherId}/grades`)
      .send({ grade: 1, canWeekday: true, canFriday: true });
    expect(res.status).toBe(403);
  });

  it('본인 방과후 요일을 등록/재조회할 수 있다', async () => {
    const teacherId = await findTeacherId('평교사');
    const agent = await loginAgent(teacherId, '4444');

    const putRes = await agent
      .put(`/api/teachers/${teacherId}/weekday-exclusions`)
      .send([{ weekday: 2, reason: 'AFTER_SCHOOL' }]);
    expect(putRes.status).toBe(200);

    const getRes = await agent.get('/api/teachers');
    const me = getRes.body.find((t: { id: number }) => t.id === teacherId);
    expect(me.weekdayExclusions).toEqual([
      expect.objectContaining({ weekday: 2, reason: 'AFTER_SCHOOL' }),
    ]);
  });

  it('타인의 방과후 요일을 변경하려 하면 403', async () => {
    const teacherId = await findTeacherId('평교사');
    const other = await findTeacherId('3학년부장');
    const agent = await loginAgent(other, '3333');

    const res = await agent.put(`/api/teachers/${teacherId}/weekday-exclusions`).send([]);
    expect(res.status).toBe(403);
  });

  it('일반 교사가 교사 등록(POST)을 시도하면 403', async () => {
    const teacherId = await findTeacherId('평교사');
    const agent = await loginAgent(teacherId, '4444');

    const res = await agent.post('/api/teachers').send({ name: '새교사', initialPin: '1111' });
    expect(res.status).toBe(403);
  });

  it('ADMIN은 교사를 등록할 수 있다', async () => {
    const adminId = await findTeacherId(process.env.ADMIN_NAME!);
    const agent = await loginAgent(adminId, process.env.ADMIN_INITIAL_PIN!);

    const res = await agent.post('/api/teachers').send({ name: '신규교사A', initialPin: '1111' });
    expect(res.status).toBe(201);
    expect(res.body.mustChangePin).toBe(true);
  });

  it('감독 기록이 없는 교사는 완전 삭제할 수 있다', async () => {
    const adminId = await findTeacherId(process.env.ADMIN_NAME!);
    const agent = await loginAgent(adminId, process.env.ADMIN_INITIAL_PIN!);

    const created = await agent.post('/api/teachers').send({ name: `삭제대상_${Date.now()}`, initialPin: '1111' });
    const res = await agent.delete(`/api/teachers/${created.body.id}`);
    expect(res.status).toBe(200);
  });

  it('감독 기록이 있는 교사는 삭제 대신 비활성화만 가능하다', async () => {
    const adminId = await findTeacherId(process.env.ADMIN_NAME!);
    const agent = await loginAgent(adminId, process.env.ADMIN_INITIAL_PIN!);

    const created = await agent.post('/api/teachers').send({ name: `이력있음_${Date.now()}`, initialPin: '1111' });
    const teacherId = created.body.id as number;
    await prisma.assignment.create({
      data: {
        date: '2026-10-30',
        grade: 3,
        teacherId,
        originalTeacherId: teacherId,
        rotationGroup: 'FRIDAY',
      },
    });

    const deleteRes = await agent.delete(`/api/teachers/${teacherId}`);
    expect(deleteRes.status).toBe(409);

    const deactivateRes = await agent.put(`/api/teachers/${teacherId}`).send({ active: false });
    expect(deactivateRes.status).toBe(200);
    expect(deactivateRes.body.active).toBe(false);
  });
});

describe('학년부장 지정', () => {
  it('ADMIN은 학년부장을 지정할 수 있다', async () => {
    const adminId = await findTeacherId(process.env.ADMIN_NAME!);
    const agent = await loginAgent(adminId, process.env.ADMIN_INITIAL_PIN!);

    // 공용 픽스처(평교사 등)는 다른 테스트 파일에서도 참조하므로,
    // 학년부장 지정처럼 전역 상태를 바꾸는 테스트는 전용 교사를 새로 만들어 사용한다.
    const createRes = await agent
      .post('/api/teachers')
      .send({ name: `부장후보_${Date.now()}`, initialPin: '1234' });
    const teacherId = createRes.body.id as number;

    const res = await agent.put('/api/grade-heads/3').send({ teacherId });
    expect(res.status).toBe(200);
    expect(res.body.teacherId).toBe(teacherId);
  });

  it('이미 다른 학년의 부장인 교사는 지정할 수 없다', async () => {
    const adminId = await findTeacherId(process.env.ADMIN_NAME!);
    const grade1Head = await findTeacherId('1학년부장');
    const agent = await loginAgent(adminId, process.env.ADMIN_INITIAL_PIN!);

    const res = await agent.put('/api/grade-heads/2').send({ teacherId: grade1Head });
    expect(res.status).toBe(400);
  });

  it('일반 교사는 학년부장을 지정할 수 없다', async () => {
    const teacherId = await findTeacherId('평교사');
    const agent = await loginAgent(teacherId, '4444');

    const res = await agent.put('/api/grade-heads/3').send({ teacherId });
    expect(res.status).toBe(403);
  });
});

describe('순환 순서 변경', () => {
  it('학년부장은 담당 학년의 순환 순서를 변경할 수 있다', async () => {
    const headId = await findTeacherId('2학년부장');
    const teacherId = await findTeacherId('평교사');
    const agent = await loginAgent(headId, '2222');

    // 먼저 평교사를 2학년 후보로 등록
    await agent.put(`/api/teachers/${teacherId}/grades`).send({ grade: 2, canWeekday: true, canFriday: true });
    await agent.put(`/api/teachers/${headId}/grades`).send({ grade: 2, canWeekday: true, canFriday: true });

    const res = await agent
      .put('/api/grades/2/order')
      .send({ rotationGroup: 'WEEKDAY', teacherIds: [teacherId, headId] });
    expect(res.status).toBe(200);
    const t = res.body.find((r: { teacherId: number }) => r.teacherId === teacherId);
    const h = res.body.find((r: { teacherId: number }) => r.teacherId === headId);
    expect(t.weekdayOrder).toBe(1);
    expect(h.weekdayOrder).toBe(2);
  });
});

describe('POST /api/teachers/reset-pin-all', () => {
  it('관리자 PIN을 확인한 뒤 관리자를 뺀 교사 전원의 PIN을 0000으로 바꾸고 변경을 강제한다', async () => {
    const adminId = await findTeacherId(process.env.ADMIN_NAME!);
    const admin = await loginAgent(adminId, process.env.ADMIN_INITIAL_PIN!);
    const teacher = await loginAgent(await findTeacherId('평교사'), '4444');

    const adminPin = process.env.ADMIN_INITIAL_PIN!;
    const wrongPin = adminPin === '1357' ? '2468' : '1357';
    // 공용 픽스처의 PIN까지 바뀔 수 있으므로 모든 요청을 되돌리는 구간 안에서 한다
    const snapshot = await prisma.teacher.findMany({ select: { id: true, pinHash: true, mustChangePin: true } });
    try {
      // 권한·검증: 일반 교사 403, 관리자 PIN 틀림 401, PIN 형식 오류 400 (이때는 아무것도 바뀌지 않는다)
      expect((await teacher.post('/api/teachers/reset-pin-all').send({ adminPin: '4444' })).status).toBe(403);
      expect((await admin.post('/api/teachers/reset-pin-all').send({ adminPin: wrongPin })).status).toBe(401);
      expect((await admin.post('/api/teachers/reset-pin-all').send({ newPin: '12', adminPin })).status).toBe(400);
      expect((await request(app).post('/api/auth/login').send({ name: '평교사', pin: '4444' })).status).toBe(200);

      const res = await admin.post('/api/teachers/reset-pin-all').send({ adminPin });
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(await prisma.teacher.count({ where: { isAdmin: false } }));

      // 일반 교사는 0000으로 로그인되고 변경이 강제된다. 관리자 PIN은 그대로.
      const login = await request(app).post('/api/auth/login').send({ name: '평교사', pin: '0000' });
      expect(login.status).toBe(200);
      expect(login.body.mustChangePin).toBe(true);
      expect((await request(app).post('/api/auth/login').send({ name: process.env.ADMIN_NAME, pin: adminPin })).body.mustChangePin).toBe(false);
    } finally {
      for (const t of snapshot) {
        await prisma.teacher.update({ where: { id: t.id }, data: { pinHash: t.pinHash, mustChangePin: t.mustChangePin } });
      }
    }
  });
});

describe('GET /api/grades/rotation-status', () => {
  it('학년·그룹별 순서와 마지막 확정 감독, 그 다음 순번의 다음 시작 교사를 준다', async () => {
    const x = await prisma.teacher.create({ data: { name: `순환현황_${Date.now()}`, pinHash: 'x' } });
    await prisma.teacherGrade.create({ data: { teacherId: x.id, grade: 3, canWeekday: true, canFriday: true, weekdayOrder: 5000, fridayOrder: 5000 } });
    // 다른 테스트보다 늦은 날짜의 확정 금요일 배정 → 3학년 금요일 포인터
    await prisma.monthPlan.create({ data: { year: 2045, month: 1, grade: 3, status: 'CONFIRMED' } });
    await prisma.assignment.create({
      data: { date: '2045-01-06', grade: 3, teacherId: x.id, originalTeacherId: x.id, rotationGroup: 'FRIDAY' },
    });

    const agent = await loginAgent(await findTeacherId('평교사'), '4444');
    const res = await agent.get('/api/grades/rotation-status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(6);
    const friday3 = res.body.find((s: { grade: number; group: string }) => s.grade === 3 && s.group === 'FRIDAY');
    expect(friday3.last).toMatchObject({ teacherId: x.id, date: '2045-01-06' });
    const ids = friday3.order.map((o: { teacherId: number }) => o.teacherId);
    expect(ids).toContain(x.id);
    expect(friday3.next.teacherId).toBe(ids[(ids.indexOf(x.id) + 1) % ids.length]);
    // 순서 항목의 횟수 = 확정 통계 총횟수·금요일 횟수 (날짜 제한 없음: 2045년 확정분도 포함)
    expect(friday3.order.find((o: { teacherId: number }) => o.teacherId === x.id)).toMatchObject({ total: 1, friday: 1 });
  });
});
