import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { dateRange, isWeekend } from '../lib/dateUtils.js';
import { handle } from '../lib/http.js';
import { dateStringSchema } from '../lib/validation.js';
import { requireAuth, requireScheduleManager } from '../permissions/middleware.js';

/**
 * 방과후 운영일 (학교 전체). 교사의 방과후 요일은 이 운영일에 해당하는 날에만 감독에서 제외된다.
 * 조회는 로그인, 등록·삭제는 ADMIN·학년부장.
 */
export const afterSchoolRouter = Router();
afterSchoolRouter.use(requireAuth);

const rangeSchema = z
  .object({ startDate: dateStringSchema, endDate: dateStringSchema.optional() })
  .transform((v) => ({ startDate: v.startDate, endDate: v.endDate ?? v.startDate }))
  .refine((v) => v.startDate <= v.endDate, '시작일이 종료일보다 늦을 수 없습니다.');

const MAX_DAYS = 400;

function weekdaysIn(startDate: string, endDate: string): string[] {
  return dateRange(startDate, endDate).filter((d) => !isWeekend(d));
}

/** GET /api/after-school-days?from=&to= — 운영일 목록 (기간 생략 시 전체). */
afterSchoolRouter.get(
  '/',
  handle(async (req, res) => {
    const parsed = z.object({ from: dateStringSchema, to: dateStringSchema }).partial().safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: '조회 기간(from, to)을 YYYY-MM-DD 형식으로 입력해주세요.' });
    const { from, to } = parsed.data;
    const rows = await prisma.afterSchoolDay.findMany({
      where: from || to ? { date: { ...(from && { gte: from }), ...(to && { lte: to }) } } : undefined,
      orderBy: { date: 'asc' },
    });
    res.json(rows.map((r) => r.date));
  }),
);

/**
 * POST /api/after-school-days — 운영 기간 등록 {startDate, endDate?}. 기간 안의 평일(월~금)을 운영일로 추가한다.
 * 이미 등록된 날은 그대로 둔다.
 */
afterSchoolRouter.post(
  '/',
  requireScheduleManager,
  handle(async (req, res) => {
    const parsed = rangeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '기간을 올바르게 입력해주세요.' });
    const days = weekdaysIn(parsed.data.startDate, parsed.data.endDate);
    if (days.length > MAX_DAYS) return res.status(400).json({ error: `한 번에 ${MAX_DAYS}일까지 등록할 수 있습니다.` });

    const existing = new Set(
      (await prisma.afterSchoolDay.findMany({ where: { date: { in: days } } })).map((r) => r.date),
    );
    const toAdd = days.filter((d) => !existing.has(d));
    if (toAdd.length > 0) await prisma.afterSchoolDay.createMany({ data: toAdd.map((date) => ({ date })) });
    res.status(201).json({ added: toAdd.length, alreadyRegistered: existing.size });
  }),
);

/** DELETE /api/after-school-days?from=&to= — 기간 안의 운영일 삭제 (예: 시험 기간 제외). to 생략 시 하루. */
afterSchoolRouter.delete(
  '/',
  requireScheduleManager,
  handle(async (req, res) => {
    const parsed = rangeSchema.safeParse({ startDate: req.query.from, endDate: req.query.to });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '기간을 올바르게 입력해주세요.' });
    const { count } = await prisma.afterSchoolDay.deleteMany({
      where: { date: { gte: parsed.data.startDate, lte: parsed.data.endDate } },
    });
    res.json({ removed: count });
  }),
);
