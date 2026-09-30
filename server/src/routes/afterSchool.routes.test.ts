import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { findTeacherId, loginBody } from '../test/helpers.js';
import { prisma } from '../lib/prisma.js';
import { weekdayOf } from '../lib/dateUtils.js';

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

// 2036-09-01(월)~09-05(금), 2036-10 사용
async function afterSchoolTeacher(prefix: string, weekday: number) {
  const t = await prisma.teacher.create({ data: { name: `${prefix}_${Date.now()}`, pinHash: 'x' } });
  await prisma.teacherWeekdayExclusion.create({ data: { teacherId: t.id, weekday, reason: 'AFTER_SCHOOL' } });
  return t;
}

async function confirmedCell(date: string, grade: number, teacherId: number, status: 'CONFIRMED' | 'CLOSED' = 'CONFIRMED') {
  const [year, month] = date.split('-').map(Number);
  await prisma.monthPlan.upsert({
    where: { year_month_grade: { year, month, grade } },
    update: { status },
    create: { year, month, grade, status },
  });
  return prisma.assignment.create({
    data: { date, grade, teacherId, originalTeacherId: teacherId, rotationGroup: weekdayOf(date) === 5 ? 'FRIDAY' : 'WEEKDAY' },
  });
}

describe('방과후 운영일 지정 시 배정 취소', () => {
  it('새로 적용되는 학년에 방과후 요일 교사가 배정돼 있으면 경고 후, 확인 시 그 배정만 취소한다', async () => {
    const mon = await afterSchoolTeacher('월방과후', 1);
    const plain = await prisma.teacher.create({ data: { name: `방과후없음_${Date.now()}`, pinHash: 'x' } });
    const hit = await confirmedCell('2036-09-01', 1, mon.id); // 월요일 + 1학년 적용 → 취소 대상
    const otherGrade = await confirmedCell('2036-09-01', 2, plain.id); // 방과후 교사 아님 → 유지
    const head = await loginAgent('1학년부장', '1111');

    const body = { startDate: '2036-09-01', endDate: '2036-09-05', grades: [1, 2] };
    const warn = await head.post('/api/after-school-days').send(body);
    expect(warn.status).toBe(409);
    expect(warn.body.warning).toBe(true);
    expect(warn.body.conflictingAssignments).toEqual([`9/1(월) 1학년 ${mon.name} (방과후 수업)`]);
    expect(await prisma.afterSchoolDay.count({ where: { date: '2036-09-01' } })).toBe(0); // 저장 안 됨

    const ok = await head.post('/api/after-school-days').send({ ...body, confirmRemoveAssignments: true });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ days: 5, added: 10, removedAssignments: 1 });
    expect(await prisma.assignment.findUnique({ where: { id: hit.id } })).toBeNull();
    expect(await prisma.assignment.findUnique({ where: { id: otherGrade.id } })).not.toBeNull();
    expect(await prisma.notification.count({ where: { teacherId: mon.id, type: 'REMOVED_BY_CHANGE' } })).toBe(1);
  });

  it('지정하지 않은 학년은 그날 자습이 없어 기존 배정이 취소되고, 편성 대상에서도 빠진다', async () => {
    const plain = await prisma.teacher.create({ data: { name: `학년해제_${Date.now()}`, pinHash: 'x' } });
    const g2 = await confirmedCell('2036-09-08', 2, plain.id); // 9/8(월) 2학년
    const keeper = await prisma.teacher.create({ data: { name: `학년유지_${Date.now()}`, pinHash: 'x' } });
    const g1 = await confirmedCell('2036-09-08', 1, keeper.id); // 9/8(월) 1학년 (방과후 없음) → 유지
    const admin = await loginAgent(process.env.ADMIN_NAME!, process.env.ADMIN_INITIAL_PIN!);

    const warn = await admin.post('/api/after-school-days').send({ startDate: '2036-09-08', grades: [1] });
    expect(warn.status).toBe(409);
    expect(warn.body.conflictingAssignments).toEqual([`9/8(월) 2학년 ${plain.name} (자습 없음)`]);
    const ok = await admin.post('/api/after-school-days').send({ startDate: '2036-09-08', grades: [1], confirmRemoveAssignments: true });
    expect(ok.status).toBe(201);
    expect(await prisma.assignment.findUnique({ where: { id: g2.id } })).toBeNull();
    expect(await prisma.assignment.findUnique({ where: { id: g1.id } })).not.toBeNull();

    // 달력: 9/8은 1학년만 편성하는 날이고 2학년 미배정으로 보이지 않는다
    const view = await admin.get('/api/months/2036/9');
    expect(view.body.operatingDays.find((d: { date: string }) => d.date === '2036-09-08').grades).toEqual([1]);
    expect(view.body.unassigned.some((u: { date: string; grade: number }) => u.date === '2036-09-08' && u.grade === 2)).toBe(false);
    // 2학년 빈 칸 직접 지정도 운영일이 아니라 거부
    const fill = await admin.post('/api/assignments').send({ date: '2036-09-08', grade: 2, teacherId: plain.id });
    expect(fill.status).toBe(400);
  });

  it('날짜를 지정해 적용 학년을 그대로 바꾸고, 비우면 운영일에서 빠진다', async () => {
    const tue = await afterSchoolTeacher('화방과후', 2);
    const x = await confirmedCell('2036-09-02', 3, tue.id);
    const admin = await loginAgent(process.env.ADMIN_NAME!, process.env.ADMIN_INITIAL_PIN!);

    // 9/2(화)는 첫 테스트에서 1·2학년으로 등록됨 → 2·3학년으로 변경 (3학년 추가 시 화요일 방과후 교사 배정 충돌)
    const warn = await admin.put('/api/after-school-days/2036-09-02').send({ grades: [2, 3] });
    expect(warn.status).toBe(409);
    const ok = await admin.put('/api/after-school-days/2036-09-02').send({ grades: [2, 3], confirmRemoveAssignments: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ grades: [2, 3], removedAssignments: 1 });
    expect(await prisma.assignment.findUnique({ where: { id: x.id } })).toBeNull();
    expect((await admin.get('/api/after-school-days?from=2036-09-02&to=2036-09-02')).body).toEqual([{ date: '2036-09-02', grades: [2, 3] }]);

    expect((await admin.put('/api/after-school-days/2036-09-02').send({ grades: [] })).status).toBe(200);
    expect((await admin.get('/api/after-school-days?from=2036-09-02&to=2036-09-02')).body).toEqual([]);
    expect((await admin.put('/api/after-school-days/2036-09-06').send({ grades: [1] })).status).toBe(400); // 토요일
  });

  it('요일을 지정해 등록할 수 있고, 마감 월에 걸리면 거부한다', async () => {
    const admin = await loginAgent(process.env.ADMIN_NAME!, process.env.ADMIN_INITIAL_PIN!);
    const add = await admin.post('/api/after-school-days').send({ startDate: '2036-10-01', endDate: '2036-10-31', weekdays: [1, 3], grades: [2] });
    expect(add.status).toBe(201);
    const list = await admin.get('/api/after-school-days?from=2036-10-01&to=2036-10-31');
    expect(list.body.every((d: { date: string }) => [1, 3].includes(weekdayOf(d.date)))).toBe(true);

    const thu = await afterSchoolTeacher('목방과후', 4);
    await confirmedCell('2036-10-02', 1, thu.id, 'CLOSED');
    const res = await admin
      .post('/api/after-school-days')
      .send({ startDate: '2036-10-02', grades: [1], confirmRemoveAssignments: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('마감');
  });
});
