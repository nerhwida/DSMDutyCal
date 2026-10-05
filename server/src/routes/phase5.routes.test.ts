import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { findTeacherId, loginBody } from '../test/helpers.js';
import { hashPin } from '../auth/pin.js';
import { prisma } from '../lib/prisma.js';
import { weekdayOf } from '../lib/dateUtils.js';
import { rotationGroupForWeekday } from '../lib/enums.js';

const app = createApp();

// 다른 테스트 파일과 겹치지 않도록 2033년을 사용하고, 테스트마다 월을 나눠 쓴다.
// 2033-03-01(화), 2033-04-04(월), 2033-06-01(수), 2033-07-01(금)

let seq = 0;
let pinHashCache: string | null = null;

async function newTeacher(prefix: string, grades: number[] = [1]) {
  pinHashCache ??= await hashPin('1234');
  const t = await prisma.teacher.create({ data: { name: `${prefix}_${++seq}_${Date.now()}`, pinHash: pinHashCache } });
  for (const grade of grades) {
    await prisma.teacherGrade.create({ data: { teacherId: t.id, grade, weekdayOrder: 900 + seq, fridayOrder: 900 + seq } });
  }
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send(await loginBody(t.id, '1234'));
  return { id: t.id, name: t.name, agent };
}

async function loginFixture(name: string, pin: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send(await loginBody(await findTeacherId(name), pin));
  return agent;
}
const adminAgent = () => loginFixture(process.env.ADMIN_NAME!, process.env.ADMIN_INITIAL_PIN!);

async function setPlan(year: number, month: number, grade: number, status: 'DRAFT' | 'CONFIRMED' | 'CLOSED') {
  await prisma.monthPlan.upsert({
    where: { year_month_grade: { year, month, grade } },
    update: { status },
    create: { year, month, grade, status },
  });
}

function cell(date: string, grade: number, teacherId: number, extra: { originalTeacherId?: number; isModified?: boolean } = {}) {
  return prisma.assignment.create({
    data: {
      date,
      grade,
      teacherId,
      originalTeacherId: extra.originalTeacherId ?? teacherId,
      rotationGroup: rotationGroupForWeekday(weekdayOf(date)),
      isModified: extra.isModified ?? false,
    },
  });
}

const reload = (id: number) => prisma.assignment.findUniqueOrThrow({ where: { id } });

describe('월 마감 (F8)', () => {
  it('마감된 월은 재편성·셀 변경·초기화·본인 교체·특별 일정 등록이 모두 차단된다 (Phase 5 완료 기준)', async () => {
    const a = await newTeacher('마감A');
    const b = await newTeacher('마감B');
    await setPlan(2033, 2, 1, 'CONFIRMED');
    const x = await cell('2033-02-01', 1, a.id);
    const head1 = await loginFixture('1학년부장', '1111');

    const close = await head1.post('/api/months/2033/2/grades/1/close');
    expect(close.status).toBe(200);
    expect(close.body.status).toBe('CLOSED');
    expect((await head1.post('/api/months/2033/2/grades/1/close')).status).toBe(409);

    expect((await head1.post('/api/months/2033/2/grades/1/generate')).status).toBe(409);
    expect((await head1.post('/api/months/2033/2/grades/1/regenerate').send({ from: '2033-02-01', to: '2033-02-01' })).status).toBe(409);
    expect((await head1.put(`/api/assignments/${x.id}`).send({ teacherId: b.id })).status).toBe(409);
    expect((await head1.post('/api/months/2033/2/grades/1/reset')).status).toBe(409);
    expect((await a.agent.post(`/api/assignments/${x.id}/transfer`).send({ toTeacherId: b.id, confirmWarnings: true })).status).toBe(409);

    const admin = await adminAgent();
    const special = await admin
      .post('/api/special-days')
      .send({ date: '2033-02-01', type: 'EVENT', title: '행사', confirmDeleteAssignments: true });
    expect(special.status).toBe(409);
    expect(special.body.error).toContain('마감');

    const after = await reload(x.id);
    expect(after.teacherId).toBe(a.id);
  });

  it('확정되지 않은 월은 마감할 수 없다', async () => {
    await setPlan(2033, 9, 1, 'DRAFT');
    const head1 = await loginFixture('1학년부장', '1111');
    expect((await head1.post('/api/months/2033/9/grades/1/close')).status).toBe(409);
    expect((await head1.post('/api/months/2033/10/grades/1/close')).status).toBe(409); // EMPTY
  });

  it('2학년 부장은 1학년을 마감할 수 없다', async () => {
    await setPlan(2033, 11, 1, 'CONFIRMED');
    const head2 = await loginFixture('2학년부장', '2222');
    expect((await head2.post('/api/months/2033/11/grades/1/close')).status).toBe(403);
  });

  it('마감 해제는 ADMIN만, PIN 재확인 후 가능하고 AuditLog에 남는다', async () => {
    await setPlan(2033, 12, 1, 'CLOSED');
    const head1 = await loginFixture('1학년부장', '1111');
    expect((await head1.post('/api/months/2033/12/grades/1/reopen').send({ pin: '1111' })).status).toBe(403);

    const admin = await adminAgent();
    expect((await admin.post('/api/months/2033/12/grades/1/reopen').send({})).status).toBe(400);
    expect((await admin.post('/api/months/2033/12/grades/1/reopen').send({ pin: '0000' })).status).toBe(401);

    const ok = await admin.post('/api/months/2033/12/grades/1/reopen').send({ pin: process.env.ADMIN_INITIAL_PIN });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('CONFIRMED');

    const audit = await prisma.auditLog.findMany({ where: { action: 'REOPEN' } });
    expect(audit.some((l) => JSON.parse(l.target).month === 12 && JSON.parse(l.target).year === 2033)).toBe(true);
  });
});

describe('감독 초기화 (학년 단위)', () => {
  it('확정 월의 해당 학년 배정·이력을 모두 지우고 미편성으로 되돌리며, 배정되어 있던 교사에게 알린다', async () => {
    const a = await newTeacher('초기화A', [1]);
    const b = await newTeacher('초기화B', [1, 2]);
    await setPlan(2037, 1, 1, 'CONFIRMED');
    await setPlan(2037, 1, 2, 'CONFIRMED');
    const x = await cell('2037-01-01', 1, a.id);
    await cell('2037-01-02', 1, b.id);
    const other = await cell('2037-01-01', 2, b.id); // 다른 학년 → 유지
    await prisma.assignmentHistory.create({ data: { assignmentId: x.id, fromTeacherId: b.id, toTeacherId: a.id, changedById: a.id, changedByRole: 'TEACHER' } });

    const head1 = await loginFixture('1학년부장', '1111');
    const res = await head1.post('/api/months/2037/1/grades/1/reset');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'EMPTY', removedCount: 2 });

    expect(await prisma.assignment.count({ where: { grade: 1, date: { gte: '2037-01-01', lte: '2037-01-31' } } })).toBe(0);
    expect(await prisma.assignmentHistory.count({ where: { assignmentId: x.id } })).toBe(0);
    expect((await reload(other.id)).teacherId).toBe(b.id);
    const plan = await prisma.monthPlan.findUniqueOrThrow({ where: { year_month_grade: { year: 2037, month: 1, grade: 1 } } });
    expect(plan).toMatchObject({ status: 'EMPTY', confirmedAt: null });
    expect(await prisma.notification.count({ where: { teacherId: { in: [a.id, b.id] }, type: 'MONTH_RESET' } })).toBe(2);

    // 초기화 후에는 다시 자동 편성할 수 있고, 다시 초기화하면 편성된 감독이 없다는 409
    expect((await head1.post('/api/months/2037/1/grades/1/reset')).status).toBe(409);
    expect((await head1.post('/api/months/2037/1/grades/1/generate')).status).toBe(200);
  });

  it('DRAFT 월은 알림 없이 초기화되고, 담당 학년이 아니거나 일반 교사면 403', async () => {
    const a = await newTeacher('초안초기화', [1]);
    await setPlan(2037, 2, 1, 'DRAFT');
    await cell('2037-02-01', 1, a.id);

    expect((await (await loginFixture('2학년부장', '2222')).post('/api/months/2037/2/grades/1/reset')).status).toBe(403);
    expect((await (await loginFixture('평교사', '4444')).post('/api/months/2037/2/grades/1/reset')).status).toBe(403);

    const admin = await adminAgent();
    const res = await admin.post('/api/months/2037/2/grades/1/reset');
    expect(res.status).toBe(200);
    expect(res.body.removedCount).toBe(1);
    expect(await prisma.notification.count({ where: { teacherId: a.id, type: 'MONTH_RESET' } })).toBe(0);
  });
});

describe('부분 재편성 (F4)', () => {
  it('확정 월: 범위 안 셀만 바뀌고, 최초 교사는 유지(노란 표시)되며 이력은 남고 알림은 없다', async () => {
    const a = await newTeacher('재편성A');
    const b = await newTeacher('재편성B');
    await setPlan(2033, 3, 1, 'CONFIRMED');
    const busy = ['2033-03-01', '2033-03-02', '2033-03-03'];
    for (const date of busy) await prisma.teacherUnavailableDate.create({ data: { teacherId: a.id, date, reason: '출장' } });

    const x = await cell('2033-03-01', 1, a.id); // 범위 안, A 출장 → 바뀌어야 함
    const locked = await cell('2033-03-02', 1, a.id, { originalTeacherId: b.id, isModified: true }); // 범위 안, 수동 변경 → 유지
    const outside = await cell('2033-03-07', 1, a.id); // 범위 밖 → 유지
    await cell('2033-03-03', 1, b.id);

    const head1 = await loginFixture('1학년부장', '1111');
    const res = await head1.post('/api/months/2033/3/grades/1/regenerate').send({ from: '2033-03-01', to: '2033-03-03' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CONFIRMED');

    const changed = await reload(x.id);
    expect(changed.teacherId).not.toBe(a.id);
    expect(changed.originalTeacherId).toBe(a.id); // B안: 확정 시점 교사 유지
    expect(changed.isModified).toBe(true);
    const history = await prisma.assignmentHistory.findMany({ where: { assignmentId: x.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromTeacherId: a.id, toTeacherId: changed.teacherId, note: '부분 재편성' });
    expect(await prisma.notification.count({ where: { assignmentId: x.id } })).toBe(0);

    expect((await reload(locked.id)).teacherId).toBe(a.id);
    expect((await reload(outside.id)).teacherId).toBe(a.id);
  });

  it('수동 변경 셀은 기본적으로 유지되고, "수동 변경 셀도 다시 편성" 옵션일 때만 다시 편성된다', async () => {
    const a = await newTeacher('수동A');
    const b = await newTeacher('수동B');
    await setPlan(2033, 5, 1, 'CONFIRMED');
    const date = '2033-05-02'; // 월
    await prisma.teacherUnavailableDate.create({ data: { teacherId: b.id, date, reason: '연수' } });
    const x = await cell(date, 1, b.id, { originalTeacherId: a.id, isModified: true });
    const head1 = await loginFixture('1학년부장', '1111');

    const keep = await head1.post('/api/months/2033/5/grades/1/regenerate').send({ from: date, to: date });
    expect(keep.status).toBe(200);
    expect((await reload(x.id)).teacherId).toBe(b.id);

    const redo = await head1
      .post('/api/months/2033/5/grades/1/regenerate')
      .send({ from: date, to: date, includeModified: true });
    expect(redo.status).toBe(200);
    expect((await reload(x.id)).teacherId).not.toBe(b.id);
  });

  it('DRAFT 월: 새 결과로 교체되고 최초 교사도 새 교사가 된다 (이력 없음)', async () => {
    const a = await newTeacher('초안A');
    await newTeacher('초안B');
    await setPlan(2033, 4, 1, 'DRAFT');
    const date = '2033-04-04';
    await prisma.teacherUnavailableDate.create({ data: { teacherId: a.id, date, reason: '출장' } });
    const x = await cell(date, 1, a.id);
    const head1 = await loginFixture('1학년부장', '1111');

    const res = await head1.post('/api/months/2033/4/grades/1/regenerate').send({ from: date, to: date });
    expect(res.status).toBe(200);
    const after = await reload(x.id);
    expect(after.teacherId).not.toBe(a.id);
    expect(after.originalTeacherId).toBe(after.teacherId);
    expect(after.isModified).toBe(false);
    expect(await prisma.assignmentHistory.count({ where: { assignmentId: x.id } })).toBe(0);
  });

  it('범위가 월을 벗어나거나 미편성 월이면 거부', async () => {
    await setPlan(2033, 8, 1, 'CONFIRMED');
    const head1 = await loginFixture('1학년부장', '1111');
    expect((await head1.post('/api/months/2033/8/grades/1/regenerate').send({ from: '2033-07-31', to: '2033-08-02' })).status).toBe(400);
    expect((await head1.post('/api/months/2033/8/grades/1/regenerate').send({ from: '2033-08-05', to: '2033-08-02' })).status).toBe(400);
    expect((await head1.post('/api/months/2034/1/grades/1/regenerate').send({ from: '2034-01-02', to: '2034-01-03' })).status).toBe(409);
    const head2 = await loginFixture('2학년부장', '2222');
    expect((await head2.post('/api/months/2033/8/grades/1/regenerate').send({ from: '2033-08-01', to: '2033-08-02' })).status).toBe(403);
  });
});

describe('변경 이력 (F10)', () => {
  it('ADMIN은 전체, 학년부장은 담당 학년 + 본인 관련, 일반 교사는 본인 관련만 조회한다', async () => {
    const a = await newTeacher('이력A', [1]);
    const b = await newTeacher('이력B', [1]);
    const c = await newTeacher('이력C', [2]);
    const d = await newTeacher('이력D', [2]);
    const e = await newTeacher('이력E', [1, 2]);
    const x = await cell('2033-01-03', 1, b.id, { originalTeacherId: a.id, isModified: true });
    const y = await cell('2033-01-04', 2, d.id, { originalTeacherId: c.id, isModified: true });
    await prisma.assignmentHistory.create({
      data: { assignmentId: x.id, fromTeacherId: a.id, toTeacherId: b.id, changedById: a.id, changedByRole: 'TEACHER', note: '1학년 교체' },
    });
    await prisma.assignmentHistory.create({
      data: { assignmentId: y.id, fromTeacherId: c.id, toTeacherId: d.id, changedById: c.id, changedByRole: 'TEACHER' },
    });

    const ids = async (agent: ReturnType<typeof request.agent>, query = '') => {
      const res = await agent.get(`/api/history?year=2033&month=1${query}`);
      expect(res.status).toBe(200);
      return res.body.map((h: { date: string }) => h.date).sort();
    };

    expect(await ids(await adminAgent())).toEqual(['2033-01-03', '2033-01-04']);
    expect(await ids(await adminAgent(), '&grade=2')).toEqual(['2033-01-04']);
    expect(await ids(await loginFixture('2학년부장', '2222'))).toEqual(['2033-01-04']);
    expect(await ids(a.agent)).toEqual(['2033-01-03']);
    expect(await ids(d.agent)).toEqual(['2033-01-04']);
    expect(await ids(e.agent)).toEqual([]);

    const row = (await (await adminAgent()).get('/api/history?year=2033&month=1&grade=1')).body[0];
    expect(row).toMatchObject({ grade: 1, fromTeacherName: a.name, toTeacherName: b.name, changedByName: a.name, note: '1학년 교체' });
  });
});

describe('기간 통계 (F7)', () => {
  it('기간 안의 확정·마감 배정만 학년·그룹별로 집계한다 (DRAFT 제외)', async () => {
    const f = await newTeacher('통계F', [1]);
    await setPlan(2033, 6, 1, 'CONFIRMED');
    await setPlan(2033, 7, 1, 'CLOSED');
    await setPlan(2033, 8, 2, 'DRAFT');
    await cell('2033-06-01', 1, f.id); // 수 → 월~목
    await cell('2033-07-01', 1, f.id); // 금
    await cell('2033-08-01', 2, f.id); // DRAFT → 제외

    const res = await f.agent.get('/api/stats/range?from=2033-06&to=2033-08');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: '2033-06-01', to: '2033-08-31' });
    const row = res.body.rows.find((r: { teacherId: number }) => r.teacherId === f.id);
    expect(row).toMatchObject({ periodTotal: 2, periodWeekday: 1, periodFriday: 1, grandTotal: 2 });
    expect(row.period['1:WEEKDAY']).toBe(1);
    expect(row.period['1:FRIDAY']).toBe(1);
    expect(row.period['2:WEEKDAY']).toBe(0);

    const june = await f.agent.get('/api/stats/range?from=2033-06&to=2033-06');
    const juneRow = june.body.rows.find((r: { teacherId: number }) => r.teacherId === f.id);
    expect(juneRow).toMatchObject({ periodTotal: 1, grandTotal: 1 });
  });

  it('교사별 통계 제외 월: 그 달 현황·통계 목록에서 빠지고, 기간 전체가 제외면 기간 통계에서도 숨긴다', async () => {
    const x = await newTeacher('통계제외', [1]);
    const head1 = await loginFixture('1학년부장', '1111');

    // 일반 교사는 등록할 수 없다
    expect((await x.agent.post(`/api/teachers/${x.id}/stats-exclusions`).send({ from: '2038-03' })).status).toBe(403);
    expect((await head1.post(`/api/teachers/${x.id}/stats-exclusions`).send({ from: '2038-04', to: '2038-03' })).status).toBe(400);

    const add = await head1.post(`/api/teachers/${x.id}/stats-exclusions`).send({ from: '2038-03', to: '2038-04' });
    expect(add.status).toBe(201);
    expect(add.body.added).toBe(2);
    const listed = (await head1.get('/api/teachers')).body.find((t: { id: number }) => t.id === x.id);
    expect(listed.statsExclusions.map((e: { year: number; month: number }) => `${e.year}-${e.month}`)).toEqual(['2038-3', '2038-4']);

    const has = (rows: { teacherId: number }[]) => rows.some((r) => r.teacherId === x.id);
    expect(has((await head1.get('/api/stats?year=2038&month=3')).body.rows)).toBe(false);
    expect(has((await head1.get('/api/stats?year=2038&month=5')).body.rows)).toBe(true);
    expect(has((await head1.get('/api/stats/range?from=2038-03&to=2038-04')).body.rows)).toBe(false);
    const partial = (await head1.get('/api/stats/range?from=2038-03&to=2038-05')).body.rows.find(
      (r: { teacherId: number }) => r.teacherId === x.id,
    );
    expect(partial.excludedMonths).toEqual(['2038-03', '2038-04']);

    // 삭제하면 다시 나온다
    const march = listed.statsExclusions[0];
    expect((await head1.delete(`/api/teachers/${x.id}/stats-exclusions/${march.id}`)).status).toBe(200);
    expect(has((await head1.get('/api/stats?year=2038&month=3')).body.rows)).toBe(true);
  });

  it('월 현황은 이번 달·초기 누계·월별 확정 횟수를 학년·그룹별로 준다 (현황 패널 표시용)', async () => {
    const x = await newTeacher('월별현황', [1]);
    await prisma.initialCount.create({ data: { teacherId: x.id, grade: 1, rotationGroup: 'FRIDAY', count: 2 } });
    await setPlan(2038, 9, 1, 'CONFIRMED');
    await setPlan(2038, 10, 1, 'CONFIRMED');
    await cell('2038-09-01', 1, x.id); // 수
    await cell('2038-09-03', 1, x.id); // 금
    await cell('2038-10-01', 1, x.id); // 금

    const res = await x.agent.get('/api/stats?year=2038&month=10');
    const row = res.body.rows.find((r: { teacherId: number }) => r.teacherId === x.id);
    expect(row.monthByGradeGroup).toMatchObject({ '1:WEEKDAY': 0, '1:FRIDAY': 1 });
    expect(row.initialByGradeGroup).toMatchObject({ '1:FRIDAY': 2 });
    expect(row.total).toBe(5); // 초기 2 + 확정 3
    expect(row.monthly).toEqual([
      { month: '2038-09', byGradeGroup: expect.objectContaining({ '1:WEEKDAY': 1, '1:FRIDAY': 1 }) },
      { month: '2038-10', byGradeGroup: expect.objectContaining({ '1:WEEKDAY': 0, '1:FRIDAY': 1 }) },
    ]);
  });

  it('기간이 잘못되면 400', async () => {
    const admin = await adminAgent();
    expect((await admin.get('/api/stats/range?from=2033-08&to=2033-06')).status).toBe(400);
    expect((await admin.get('/api/stats/range?from=2031-01&to=2033-06')).status).toBe(400);
    expect((await admin.get('/api/stats/range?from=2033-6&to=2033-07')).status).toBe(400);
  });
});
