import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { dateLabel, dateRange, isWeekend, weekdayOf } from '../lib/dateUtils.js';
import { handle } from '../lib/http.js';
import { recordAudit } from '../lib/audit.js';
import { dateStringSchema, gradeSchema, weekdaySchema } from '../lib/validation.js';
import { requireAuth, requireScheduleManager } from '../permissions/middleware.js';
import { removeAssignmentsTx } from '../services/assignmentService.js';

/**
 * 방과후 운영일 (날짜 × 학년). 방과후 시간에 자습하는 학년을 지정하면, 그 학년 감독에서만
 * 그날 방과후 수업이 있는 교사(방과후 요일)를 제외한다. 조회는 로그인, 등록·변경·삭제는 ADMIN·학년부장.
 *
 * 새로 운영일이 되는 (날짜, 학년)에 방과후 요일 교사가 이미 배정돼 있으면 409로 경고하고,
 * confirmRemoveAssignments=true면 그 배정을 취소(미배정)한 뒤 저장한다. 마감 월 배정이 걸리면 거부한다.
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

/** 요일 (1=월 … 5=금, 생략 시 월~금). */
const weekdaysSchema = z.array(weekdaySchema).min(1, '요일을 하나 이상 선택해주세요.').optional();

const rangeSchema = z
  .object({
    startDate: dateStringSchema,
    endDate: dateStringSchema.optional(),
    weekdays: weekdaysSchema,
    grades: gradesSchema,
    confirmRemoveAssignments: z.boolean().optional(),
  })
  .transform((v) => ({ ...v, endDate: v.endDate ?? v.startDate }))
  .refine((v) => v.startDate <= v.endDate, '시작일이 종료일보다 늦을 수 없습니다.');

const MAX_DAYS = 400;

/** 기간 안의 평일 중 지정한 요일. */
function weekdaysIn(startDate: string, endDate: string, weekdays?: number[]): string[] {
  return dateRange(startDate, endDate).filter((d) => !isWeekend(d) && (!weekdays || weekdays.includes(weekdayOf(d))));
}

type Cell = { date: string; grade: number };
const cellKey = (c: Cell) => `${c.date}:${c.grade}`;

/**
 * 운영일 칸 추가·삭제를 저장한다. 추가되는 칸에 방과후 요일 교사가 배정돼 있으면 경고 → 확인 시 배정 취소.
 * status가 200이 아니면 저장하지 않은 것이다.
 */
async function applyCells(
  toAdd: Cell[],
  toRemove: Cell[],
  confirmRemoveAssignments: boolean,
  actor: { id: number; name: string },
): Promise<{ status: number; body?: Record<string, unknown>; removedAssignments: number }> {
  const addKeys = new Set(toAdd.map(cellKey));
  const candidates =
    toAdd.length === 0
      ? []
      : await prisma.assignment.findMany({
          where: { date: { in: [...new Set(toAdd.map((c) => c.date))] } },
          include: { teacher: { select: { name: true, weekdayExclusions: true } } },
        });
  const conflicts = candidates.filter(
    (a) =>
      addKeys.has(cellKey(a)) &&
      a.teacher.weekdayExclusions.some((e) => e.reason === 'AFTER_SCHOOL' && e.weekday === weekdayOf(a.date)),
  );
  const labels = (rows: typeof conflicts) => rows.map((a) => `${dateLabel(a.date)} ${a.grade}학년 ${a.teacher.name}`).sort();

  if (conflicts.length > 0) {
    const closed = await prisma.monthPlan.findMany({ where: { status: 'CLOSED' } });
    const closedKeys = new Set(closed.map((p) => `${p.year}-${p.month}-${p.grade}`));
    const closedConflicts = conflicts.filter((a) => {
      const [y, m] = a.date.split('-').map(Number);
      return closedKeys.has(`${y}-${m}-${a.grade}`);
    });
    if (closedConflicts.length > 0) {
      return {
        status: 409,
        removedAssignments: 0,
        body: {
          error: `마감된 월에 방과후 요일 교사가 배정된 칸이 있어 저장할 수 없습니다. 해당 기간을 빼고 저장해주세요. (${labels(closedConflicts).join(', ')})`,
          closedConflicts: labels(closedConflicts),
        },
      };
    }
    if (!confirmRemoveAssignments) {
      return {
        status: 409,
        removedAssignments: 0,
        body: {
          warning: true,
          error: '방과후 수업이 있는 교사가 이미 감독으로 배정된 칸이 있습니다. 계속하면 해당 배정이 취소(미배정)됩니다.',
          conflictingAssignments: labels(conflicts),
        },
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    if (toRemove.length > 0) {
      await tx.afterSchoolDay.deleteMany({ where: { OR: toRemove.map((c) => ({ date: c.date, grade: c.grade })) } });
    }
    if (toAdd.length > 0) await tx.afterSchoolDay.createMany({ data: toAdd });
    await removeAssignmentsTx(tx, conflicts, actor, '방과후 운영일 지정');
  });
  if (conflicts.length > 0) {
    await recordAudit(actor.id, 'CANCEL_ASSIGNMENT', {
      reason: '방과후 운영일 지정',
      cells: conflicts.map((a) => ({ date: a.date, grade: a.grade, teacherId: a.teacherId, teacherName: a.teacher.name })),
    });
  }
  return { status: 200, removedAssignments: conflicts.length };
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
 * POST /api/after-school-days — 운영 기간 등록 {startDate, endDate?, weekdays?, grades?, confirmRemoveAssignments?}.
 * 기간 안의 평일(요일 지정 시 그 요일만) × 적용 학년을 운영일로 추가한다. 이미 등록된 칸은 그대로 둔다.
 */
afterSchoolRouter.post(
  '/',
  requireScheduleManager,
  handle(async (req, res) => {
    const parsed = rangeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '기간을 올바르게 입력해주세요.' });
    const { startDate, endDate, weekdays, grades, confirmRemoveAssignments } = parsed.data;
    const days = weekdaysIn(startDate, endDate, weekdays);
    if (days.length === 0) return res.status(400).json({ error: '기간 안에 해당하는 평일이 없습니다.' });
    if (days.length > MAX_DAYS) return res.status(400).json({ error: `한 번에 ${MAX_DAYS}일까지 등록할 수 있습니다.` });

    const existing = new Set(
      (await prisma.afterSchoolDay.findMany({ where: { date: { in: days }, grade: { in: grades } } })).map(cellKey),
    );
    const toAdd = days.flatMap((date) => grades.map((grade) => ({ date, grade }))).filter((c) => !existing.has(cellKey(c)));
    const result = await applyCells(toAdd, [], confirmRemoveAssignments ?? false, req.user!);
    if (result.status !== 200) return res.status(result.status).json(result.body);
    res.status(201).json({
      days: days.length,
      added: toAdd.length,
      alreadyRegistered: existing.size,
      removedAssignments: result.removedAssignments,
    });
  }),
);

const dayUpdateSchema = z.object({
  grades: z.array(gradeSchema).transform((g) => [...new Set(g)].sort()),
  confirmRemoveAssignments: z.boolean().optional(),
});

/**
 * PUT /api/after-school-days/:date — 한 날짜의 적용 학년을 그대로 지정한다 {grades, confirmRemoveAssignments?}.
 * grades가 비면 그 날은 운영일에서 빠진다. (일정 관리 화면에서 날짜를 클릭해 학년을 고를 때 사용)
 */
afterSchoolRouter.put(
  '/:date',
  requireScheduleManager,
  handle(async (req, res) => {
    const date = dateStringSchema.safeParse(req.params.date);
    const parsed = dayUpdateSchema.safeParse(req.body);
    if (!date.success || !parsed.success) return res.status(400).json({ error: '날짜와 적용 학년을 올바르게 입력해주세요.' });
    if (isWeekend(date.data)) return res.status(400).json({ error: '주말은 방과후 운영일로 지정할 수 없습니다.' });

    const rows = await prisma.afterSchoolDay.findMany({ where: { date: date.data } });
    const current = new Set(rows.map((r) => r.grade));
    const toAdd = parsed.data.grades.filter((g) => !current.has(g)).map((grade) => ({ date: date.data, grade }));
    const wanted = new Set<number>(parsed.data.grades);
    const toRemove = rows.filter((r) => !wanted.has(r.grade)).map((r) => ({ date: r.date, grade: r.grade }));

    const result = await applyCells(toAdd, toRemove, parsed.data.confirmRemoveAssignments ?? false, req.user!);
    if (result.status !== 200) return res.status(result.status).json(result.body);
    res.json({ date: date.data, grades: parsed.data.grades, removedAssignments: result.removedAssignments });
  }),
);

/** DELETE /api/after-school-days?from=&to=&grades=1,2&weekdays=1,3 — 기간 안의 운영일 삭제 (예: 시험 기간). to 생략 시 하루, grades 생략 시 전 학년. */
afterSchoolRouter.delete(
  '/',
  requireScheduleManager,
  handle(async (req, res) => {
    const list = (v: unknown) => (typeof v === 'string' && v ? v.split(',').map(Number) : undefined);
    const parsed = rangeSchema.safeParse({
      startDate: req.query.from,
      endDate: req.query.to,
      grades: list(req.query.grades),
      weekdays: list(req.query.weekdays),
    });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '기간을 올바르게 입력해주세요.' });
    const { startDate, endDate, weekdays, grades } = parsed.data;
    const { count } = await prisma.afterSchoolDay.deleteMany({
      where: { date: { in: weekdaysIn(startDate, endDate, weekdays) }, grade: { in: grades } },
    });
    res.json({ removed: count });
  }),
);
