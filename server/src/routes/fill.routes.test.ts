import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { findTeacherId } from '../test/helpers.js';
import { hashPin } from '../auth/pin.js';
import { prisma } from '../lib/prisma.js';
import { weekdayOf } from '../lib/dateUtils.js';
import { rotationGroupForWeekday } from '../lib/enums.js';

const app = createApp();

// 다른 테스트 파일과 겹치지 않도록 2034년 사용. 2034-01-02(월) ~ 01-06(금), 01-07(토).

let seq = 0;
let pinHashCache: string | null = null;
async function newTeacher(prefix: string, grades: number[] = [1]) {
  pinHashCache ??= await hashPin('1234');
  const t = await prisma.teacher.create({ data: { name: `${prefix}_${++seq}_${Date.now()}`, pinHash: pinHashCache } });
  for (const grade of grades) {
    await prisma.teacherGrade.create({ data: { teacherId: t.id, grade, weekdayOrder: 950 + seq, fridayOrder: 950 + seq } });
  }
  return t;
}
async function loginFixture(name: string, pin: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ teacherId: await findTeacherId(name), pin });
  return agent;
}
async function setPlan(year: number, month: number, grade: number, status: 'DRAFT' | 'CONFIRMED' | 'CLOSED') {
  await prisma.monthPlan.upsert({
    where: { year_month_grade: { year, month, grade } },
    update: { status },
    create: { year, month, grade, status },
  });
}
const cell = (date: string, grade: number, teacherId: number) =>
  prisma.assignment.create({
    data: { date, grade, teacherId, originalTeacherId: teacherId, rotationGroup: rotationGroupForWeekday(weekdayOf(date)) },
  });

describe('미배정 칸 직접 지정', () => {
  it('학년부장이 확정 월의 빈 칸에 교사를 지정한다: 기본 고정, 노란 표시 없음, 이력(미배정 → 교사)과 알림', async () => {
    const t = await newTeacher('지정');
    await setPlan(2034, 1, 1, 'CONFIRMED');
    const head1 = await loginFixture('1학년부장', '1111');

    const before = await head1.get('/api/months/2034/1');
    expect(before.body.unassigned.some((u: { date: string; grade: number }) => u.date === '2034-01-02' && u.grade === 1)).toBe(true);

    const candidates = await head1.get('/api/assignments/candidates?date=2034-01-02&grade=1');
    expect(candidates.status).toBe(200);
    expect(candidates.body.cell).toMatchObject({ date: '2034-01-02', grade: 1, rotationGroup: 'WEEKDAY', status: 'CONFIRMED' });
    expect(candidates.body.candidates.find((c: { teacherId: number }) => c.teacherId === t.id)).toMatchObject({ blocking: null, warnings: [] });

    const res = await head1.post('/api/assignments').send({ date: '2034-01-02', grade: 1, teacherId: t.id, note: '추가 배정' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ teacherId: t.id, originalTeacherId: t.id, isModified: false, isLocked: true });

    const history = await prisma.assignmentHistory.findFirstOrThrow({ where: { assignmentId: res.body.id } });
    expect(history.fromTeacherId).toBeNull();
    expect(history.note).toContain('미배정 칸 지정');
    expect(history.note).toContain('추가 배정');
    expect(await prisma.notification.count({ where: { teacherId: t.id, assignmentId: res.body.id } })).toBe(1);

    const after = await head1.get('/api/months/2034/1');
    expect(after.body.unassigned.some((u: { date: string; grade: number }) => u.date === '2034-01-02' && u.grade === 1)).toBe(false);

    const list = await head1.get('/api/history?year=2034&month=1&grade=1');
    const row = list.body.find((h: { date: string }) => h.date === '2034-01-02');
    expect(row).toMatchObject({ fromTeacherName: null, toTeacherName: t.name });
  });

  it('고정 없이 지정할 수 있고, DRAFT 월은 알림을 보내지 않는다', async () => {
    const t = await newTeacher('초안지정');
    await setPlan(2034, 2, 1, 'DRAFT');
    const head1 = await loginFixture('1학년부장', '1111');
    const res = await head1.post('/api/assignments').send({ date: '2034-02-01', grade: 1, teacherId: t.id, lock: false });
    expect(res.status).toBe(201);
    expect(res.body.isLocked).toBe(false);
    expect(await prisma.notification.count({ where: { assignmentId: res.body.id } })).toBe(0);
  });

  it('담당 학년이 아니거나 일반 교사면 403', async () => {
    const t = await newTeacher('권한');
    await setPlan(2034, 1, 1, 'CONFIRMED');
    const head2 = await loginFixture('2학년부장', '2222');
    expect((await head2.get('/api/assignments/candidates?date=2034-01-03&grade=1')).status).toBe(403);
    expect((await head2.post('/api/assignments').send({ date: '2034-01-03', grade: 1, teacherId: t.id })).status).toBe(403);
    const teacher = await loginFixture('평교사', '4444');
    expect((await teacher.post('/api/assignments').send({ date: '2034-01-03', grade: 1, teacherId: t.id })).status).toBe(403);
  });

  it('이미 배정된 칸·운영일이 아닌 날·미편성·마감 월은 거부', async () => {
    const t = await newTeacher('거부');
    const other = await newTeacher('거부기존');
    await setPlan(2034, 1, 1, 'CONFIRMED');
    await cell('2034-01-04', 1, other.id);
    await prisma.specialDay.create({ data: { date: '2034-01-05', grade: 1, type: 'EVENT', title: '1학년 행사' } });
    const admin = await loginFixture(process.env.ADMIN_NAME!, process.env.ADMIN_INITIAL_PIN!);
    const fill = (date: string, grade = 1) => admin.post('/api/assignments').send({ date, grade, teacherId: t.id });

    expect((await fill('2034-01-04')).status).toBe(409); // 이미 배정
    expect((await fill('2034-01-07')).status).toBe(400); // 토요일
    expect((await fill('2034-01-05')).status).toBe(400); // 특별 일정
    expect((await fill('2034-03-01')).status).toBe(409); // 미편성 월

    await setPlan(2034, 4, 1, 'CLOSED');
    expect((await fill('2034-04-03')).status).toBe(409); // 마감 월
  });

  it('불가 사유가 있는 교사는 강제 배정일 때만, 같은 날 다른 학년 감독 중이면 강제로도 불가', async () => {
    const busy = await newTeacher('출장', [1]);
    const dual = await newTeacher('겸임', [1, 2]);
    await setPlan(2034, 1, 1, 'CONFIRMED');
    await prisma.teacherUnavailableDate.create({ data: { teacherId: busy.id, date: '2034-01-06', reason: '출장' } });
    await cell('2034-01-06', 2, dual.id);
    const head1 = await loginFixture('1학년부장', '1111');

    const noForce = await head1.post('/api/assignments').send({ date: '2034-01-06', grade: 1, teacherId: busy.id });
    expect(noForce.status).toBe(409);
    expect(noForce.body.requiresForce).toBe(true);

    const doubled = await head1.post('/api/assignments').send({ date: '2034-01-06', grade: 1, teacherId: dual.id, force: true });
    expect(doubled.status).toBe(409);
    expect(doubled.body.error).toContain('같은 날 2학년 감독 중');

    const forced = await head1.post('/api/assignments').send({ date: '2034-01-06', grade: 1, teacherId: busy.id, force: true });
    expect(forced.status).toBe(201);
    const history = await prisma.assignmentHistory.findFirstOrThrow({ where: { assignmentId: forced.body.id } });
    expect(history.note).toContain('강제 배정');
  });
});
