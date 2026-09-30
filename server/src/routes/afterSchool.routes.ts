import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { dateRange, isWeekend } from '../lib/dateUtils.js';
import { handle } from '../lib/http.js';
import { dateStringSchema, gradeSchema } from '../lib/validation.js';
import { requireAuth, requireScheduleManager } from '../permissions/middleware.js';

/**
 * 방과후 운영일 (날짜 × 학년). 방과후 시간에 자습하는 학년을 지정하면, 그 학년 감독에서만
 * 그날 방과후 수업이 있는 교사(방과후 요일)를 제외한다. 조회는 로그인, 등록·삭제는 ADMIN·학년부장.
 */
export const afterSchoolRouter = Router();
afterSchoolRouter.use(requireAuth);

const ALL_GRADES = [1, 2, 3];

/** 적용 학년 (생략 시 전 학년). */
const gradesSchema = z
  .array(gradeSchema)
  .min(1, '적용 학년을 하나 이상 선택해주세요.')
  .optional()
  .transform((g) => [...new Set(g ?? ALL_GRADES)].sort());

const rangeSchema = z
  .object({ startDate: dateStringSchema, endDate: dateStringSchema.optional(), grades: gradesSchema })
  .transform((v) => ({ ...v, endDate: v.endDate ?? v.startDate }))
  .refine((v) => v.startDate <= v.endDate, '시작일이 종료일보다 늦을 수 없습니다.');

const MAX_DAYS = 400;

function weekdaysIn(startDate: string, endDate: string): string[] {
  return dateRange(startDate, endDate).filter((d) => !isWeekend(d));
}

/** GET /api/after-school-days?from=&to= — 운영일 목록 [{date, grades}] (기간 생략 시 전체). */
afterSchoolRouter.get(
  '/',
  handle(async (req, res) => {
    const parsed = z.object({ from: dateStringSchema, to: dateStringSchema }).partial().safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: '조회 기간(from, to)을 YYYY-MM-DD 형식으로 입력해주세요.' });
    const { from, to } = parsed.data;
    const rows = await prisma.afterSchoolDay.findMany({
      where: from || to ? { date: { ...(from && { gte: from }), ...(to && { lte: to }) } } : undefined,
      orderBy: [{ date: 'asc' }, { grade: 'asc' }],
    });
    const byDate = new Map<string, number[]>();
    for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r.grade]);
    res.json([...byDate].map(([date, grades]) => ({ date, grades })));
  }),
);

/**
 * POST /api/after-school-days — 운영 기간 등록 {startDate, endDate?, grades?}.
 * 기간 안의 평일(월~금) × 적용 학년을 운영일로 추가한다. 이미 등록된 칸은 그대로 둔다.
 */
afterSchoolRouter.post(
  '/',
  requireScheduleManager,
  handle(async (req, res) => {
    const parsed = rangeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '기간을 올바르게 입력해주세요.' });
    const { startDate, endDate, grades } = parsed.data;
    const days = weekdaysIn(startDate, endDate);
    if (days.length > MAX_DAYS) return res.status(400).json({ error: `한 번에 ${MAX_DAYS}일까지 등록할 수 있습니다.` });

    const existing = new Set(
      (await prisma.afterSchoolDay.findMany({ where: { date: { in: days }, grade: { in: grades } } })).map(
        (r) => `${r.date}:${r.grade}`,
      ),
    );
    const toAdd = days.flatMap((date) => grades.filter((grade) => !existing.has(`${date}:${grade}`)).map((grade) => ({ date, grade })));
    if (toAdd.length > 0) await prisma.afterSchoolDay.createMany({ data: toAdd });
    res.status(201).json({ days: days.length, added: toAdd.length, alreadyRegistered: existing.size });
  }),
);

/** DELETE /api/after-school-days?from=&to=&grades=1,2 — 기간 안의 운영일 삭제 (예: 시험 기간). to 생략 시 하루, grades 생략 시 전 학년. */
afterSchoolRouter.delete(
  '/',
  requireScheduleManager,
  handle(async (req, res) => {
    const grades = typeof req.query.grades === 'string' && req.query.grades ? req.query.grades.split(',').map(Number) : undefined;
    const parsed = rangeSchema.safeParse({ startDate: req.query.from, endDate: req.query.to, grades });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '기간을 올바르게 입력해주세요.' });
    const { count } = await prisma.afterSchoolDay.deleteMany({
      where: { date: { gte: parsed.data.startDate, lte: parsed.data.endDate }, grade: { in: parsed.data.grades } },
    });
    res.json({ removed: count });
  }),
);
