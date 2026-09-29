import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { findTeacherId } from '../test/helpers.js';
import { prisma } from '../lib/prisma.js';

const app = createApp();

async function loginAgent(teacherId: number, pin: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ teacherId, pin });
  return agent;
}

describe('특별 일정 등록 (F3)', () => {
  it('기간 등록 시 날짜별로 저장된다', async () => {
    const adminId = await findTeacherId(process.env.ADMIN_NAME!);
    const agent = await loginAgent(adminId, process.env.ADMIN_INITIAL_PIN!);

    const res = await agent.post('/api/special-days').send({
      startDate: '2026-10-20',
      endDate: '2026-10-23',
      type: 'EXAM',
      title: '중간고사',
    });
    expect(res.status).toBe(201);
    // 적용 학년 생략 = 전 학년 → 날짜 4일 × 3개 학년
    expect(res.body).toHaveLength(12);
    expect([...new Set(res.body.map((d: { date: string }) => d.date))]).toEqual([
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
    ]);

    const listRes = await agent.get('/api/special-days?year=2026&month=10');
    const titles = listRes.body.map((d: { title: string }) => d.title);
    expect(titles).toContain('중간고사');
  });

  it('학년부장은 특별 일정을 등록할 수 없다 (조회만 가능)', async () => {
    const headId = await findTeacherId('1학년부장');
    const agent = await loginAgent(headId, '1111');

    const res = await agent
      .post('/api/special-days')
      .send({ date: '2026-11-01', type: 'EVENT', title: '체육대회' });
    expect(res.status).toBe(403);

    const listRes = await agent.get('/api/special-days');
    expect(listRes.status).toBe(200);
  });

  it('이미 배정이 있는 날짜에 등록하면 경고 후, 확인 시 배정이 삭제된다', async () => {
    const adminId = await findTeacherId(process.env.ADMIN_NAME!);
    const teacherId = await findTeacherId('평교사');
    const agent = await loginAgent(adminId, process.env.ADMIN_INITIAL_PIN!);

    const assignment = await prisma.assignment.create({
      data: {
        date: '2026-10-28',
        grade: 1,
        teacherId,
        originalTeacherId: teacherId,
        rotationGroup: 'WEEKDAY',
      },
    });

    const warnRes = await agent
      .post('/api/special-days')
      .send({ date: '2026-10-28', type: 'HOLIDAY', title: '임시공휴일' });
    expect(warnRes.status).toBe(409);
    expect(warnRes.body.conflictingDates).toContain('2026-10-28');

    const confirmRes = await agent.post('/api/special-days').send({
      date: '2026-10-28',
      type: 'HOLIDAY',
      title: '임시공휴일',
      confirmDeleteAssignments: true,
    });
    expect(confirmRes.status).toBe(201);

    const remaining = await prisma.assignment.findUnique({ where: { id: assignment.id } });
    expect(remaining).toBeNull();
  });

  it('학년 단위로 등록하면 해당 학년 배정만 경고·삭제되고 다른 학년 배정은 유지된다', async () => {
    const adminId = await findTeacherId(process.env.ADMIN_NAME!);
    const teacherId = await findTeacherId('평교사');
    const agent = await loginAgent(adminId, process.env.ADMIN_INITIAL_PIN!);
    const date = '2035-05-15'; // 다른 테스트와 겹치지 않는 날짜
    const base = { date, teacherId, originalTeacherId: teacherId, rotationGroup: 'WEEKDAY' };
    const grade1 = await prisma.assignment.create({ data: { ...base, grade: 1 } });
    const grade2 = await prisma.assignment.create({ data: { ...base, grade: 2 } });

    const warn = await agent.post('/api/special-days').send({ date, type: 'EVENT', title: '2학년 수학여행', grades: [2] });
    expect(warn.status).toBe(409);
    expect(warn.body.conflictingCells).toEqual([`${date} 2학년`]);

    const ok = await agent
      .post('/api/special-days')
      .send({ date, type: 'EVENT', title: '2학년 수학여행', grades: [2], confirmDeleteAssignments: true });
    expect(ok.status).toBe(201);
    expect(ok.body).toHaveLength(1);
    expect(ok.body[0]).toMatchObject({ date, grade: 2, title: '2학년 수학여행' });

    expect(await prisma.assignment.findUnique({ where: { id: grade2.id } })).toBeNull();
    expect(await prisma.assignment.findUnique({ where: { id: grade1.id } })).not.toBeNull();

    // 같은 날 다른 학년에 다른 일정도 등록할 수 있다
    const exam = await agent.post('/api/special-days').send({ date, type: 'EXAM', title: '3학년 모의고사', grades: [3] });
    expect(exam.status).toBe(201);
    const list = await agent.get(`/api/special-days?from=${date}&to=${date}`);
    expect(list.body.map((d: { grade: number; title: string }) => `${d.grade}:${d.title}`)).toEqual([
      '2:2학년 수학여행',
      '3:3학년 모의고사',
    ]);

    // 여러 행 한 번에 삭제
    const del = await agent.delete(`/api/special-days?ids=${list.body.map((d: { id: number }) => d.id).join(',')}`);
    expect(del.body.deleted).toBe(2);
  });

  it('적용 학년을 비우면 400', async () => {
    const adminId = await findTeacherId(process.env.ADMIN_NAME!);
    const agent = await loginAgent(adminId, process.env.ADMIN_INITIAL_PIN!);
    const res = await agent.post('/api/special-days').send({ date: '2035-05-16', type: 'EVENT', title: 'x', grades: [] });
    expect(res.status).toBe(400);
  });

  it('공휴일 시드 불러오기는 ADMIN만 가능하다', async () => {
    const adminId = await findTeacherId(process.env.ADMIN_NAME!);
    const agent = await loginAgent(adminId, process.env.ADMIN_INITIAL_PIN!);

    const res = await agent.post('/api/special-days/seed-holidays').send({ year: 2026 });
    expect(res.status).toBe(201);
    const dates = res.body.map((d: { date: string }) => d.date);
    expect(dates).toContain('2026-01-01');
  });
});
