import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { findTeacherId } from '../test/helpers.js';
import { hashPin } from '../auth/pin.js';
import { prisma } from '../lib/prisma.js';

const app = createApp();

// 다른 테스트 파일(2026년 특별 일정·배정 등)과 겹치지 않도록 2030년 월만 사용한다.
// 테스트마다 다른 월을 사용해 파일 실행 순서와 무관하게 동작하게 한다.

async function loginAgent(teacherId: number, pin: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ teacherId, pin });
  return agent;
}

async function adminAgent() {
  return loginAgent(await findTeacherId(process.env.ADMIN_NAME!), process.env.ADMIN_INITIAL_PIN!);
}

/** 테스트 전용 교사 생성 (공유 픽스처를 오염시키지 않도록). */
async function createGradeTeachers(prefix: string, count: number, grades: number[]) {
  const pinHash = await hashPin('1234');
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = await prisma.teacher.create({ data: { name: `${prefix}_${i}_${Date.now()}`, pinHash } });
    for (const grade of grades) {
      await prisma.teacherGrade.create({
        data: { teacherId: t.id, grade, weekdayOrder: 100 + i, fridayOrder: 100 + i },
      });
    }
    ids.push(t.id);
  }
  return ids;
}

describe('자동 편성 API 권한 (6.5)', () => {
  it('일반 교사가 자동 편성 API 호출 시 403', async () => {
    const agent = await loginAgent(await findTeacherId('평교사'), '4444');
    const res = await agent.post('/api/months/2030/1/grades/1/generate');
    expect(res.status).toBe(403);
  });

  it('2학년 부장이 1학년 편성·확정 시 403', async () => {
    const agent = await loginAgent(await findTeacherId('2학년부장'), '2222');
    expect((await agent.post('/api/months/2030/1/grades/1/generate')).status).toBe(403);
    expect((await agent.post('/api/months/2030/1/grades/1/confirm')).status).toBe(403);
  });

  it('잘못된 학년·월은 400', async () => {
    const agent = await adminAgent();
    expect((await agent.post('/api/months/2030/13/grades/1/generate')).status).toBe(400);
    expect((await agent.post('/api/months/2030/1/grades/4/generate')).status).toBe(400);
  });

  it('일반 교사는 DRAFT 배정을 조회할 수 없다', async () => {
    await createGradeTeachers('draft조회', 3, [1]);
    const head = await loginAgent(await findTeacherId('1학년부장'), '1111');
    const gen = await head.post('/api/months/2030/2/grades/1/generate');
    expect(gen.status).toBe(200);

    const headView = await head.get('/api/months/2030/2');
    expect(headView.body.grades[0]).toMatchObject({ grade: 1, status: 'DRAFT', assignmentsVisible: true });
    expect(headView.body.assignments.some((a: { grade: number }) => a.grade === 1)).toBe(true);

    const teacher = await loginAgent(await findTeacherId('평교사'), '4444');
    const view = await teacher.get('/api/months/2030/2');
    expect(view.status).toBe(200);
    expect(view.body.grades[0]).toMatchObject({ grade: 1, status: 'DRAFT', assignmentsVisible: false });
    expect(view.body.assignments.some((a: { grade: number }) => a.grade === 1)).toBe(false);
    expect(view.body.unassigned.some((u: { grade: number }) => u.grade === 1)).toBe(false);
  });
});

describe('자동 편성 → 확정 흐름 (F4)', () => {
  it('편성하면 DRAFT, 확정하면 CONFIRMED + 알림, 확정 후 재편성은 409', async () => {
    await createGradeTeachers('확정흐름', 4, [3]);
    const agent = await adminAgent();

    const gen = await agent.post('/api/months/2030/3/grades/3/generate');
    expect(gen.status).toBe(200);
    expect(gen.body.status).toBe('DRAFT');
    expect(gen.body.generatedCount).toBe(21); // 2030년 3월 운영일 21일
    expect(gen.body.fairness.length).toBeGreaterThan(0);

    // 다시 편성(DRAFT 덮어쓰기)도 가능하며 중복 행이 생기지 않는다.
    const regen = await agent.post('/api/months/2030/3/grades/3/generate');
    expect(regen.status).toBe(200);
    const count = await prisma.assignment.count({ where: { grade: 3, date: { startsWith: '2030-03' } } });
    expect(count).toBe(21);

    const confirm = await agent.post('/api/months/2030/3/grades/3/confirm');
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe('CONFIRMED');

    const assignments = await prisma.assignment.findMany({ where: { grade: 3, date: { startsWith: '2030-03' } } });
    expect(assignments.every((a) => a.originalTeacherId === a.teacherId && !a.isModified)).toBe(true);

    const notified = await prisma.notification.findMany({
      where: { type: 'MONTH_CONFIRMED', teacherId: { in: [...new Set(assignments.map((a) => a.teacherId))] } },
    });
    expect(notified.length).toBeGreaterThan(0);
    expect(notified[0].message).toContain('2030년 3월 3학년');

    expect((await agent.post('/api/months/2030/3/grades/3/generate')).status).toBe(409);
    expect((await agent.post('/api/months/2030/3/grades/3/confirm')).status).toBe(409);

    // 확정 후에는 일반 교사도 조회 가능
    const teacher = await loginAgent(await findTeacherId('평교사'), '4444');
    const view = await teacher.get('/api/months/2030/3');
    expect(view.body.assignments.filter((a: { grade: number }) => a.grade === 3)).toHaveLength(21);
  });

  it('미편성 월은 확정할 수 없다 (409)', async () => {
    const agent = await adminAgent();
    expect((await agent.post('/api/months/2030/12/grades/2/confirm')).status).toBe(409);
  });
});

describe('학년 단위 편성 (Phase 3 완료 기준)', () => {
  it('2학년 → 1학년 순서로 따로 편성해도 같은 날 중복 배정이 없다', async () => {
    // 1·2학년 모두 가능한 교사만 추가 → 학년 간 중복 위험이 있는 구성
    await createGradeTeachers('학년순서', 4, [1, 2]);

    const head2 = await loginAgent(await findTeacherId('2학년부장'), '2222');
    expect((await head2.post('/api/months/2030/4/grades/2/generate')).status).toBe(200);
    const grade2Before = await prisma.assignment.findMany({
      where: { grade: 2, date: { startsWith: '2030-04' } },
      orderBy: { date: 'asc' },
    });

    const head1 = await loginAgent(await findTeacherId('1학년부장'), '1111');
    const started = performance.now();
    const gen1 = await head1.post('/api/months/2030/4/grades/1/generate');
    expect(gen1.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(1000); // 8장: 한 달 편성 API 1초 이내

    // 2학년 배정은 변경되지 않는다.
    const grade2After = await prisma.assignment.findMany({
      where: { grade: 2, date: { startsWith: '2030-04' } },
      orderBy: { date: 'asc' },
    });
    expect(grade2After.map((a) => [a.date, a.teacherId])).toEqual(grade2Before.map((a) => [a.date, a.teacherId]));

    const all = await prisma.assignment.findMany({ where: { date: { startsWith: '2030-04' } } });
    const seen = new Set<string>();
    for (const a of all) {
      const key = `${a.date}:${a.teacherId}`;
      expect(seen.has(key), `${a.date} 교사 ${a.teacherId} 중복`).toBe(false);
      seen.add(key);
    }
  });
});
