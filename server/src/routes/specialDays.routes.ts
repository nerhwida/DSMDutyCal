import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { dateRange } from '../lib/dateUtils.js';
import { dateStringSchema, gradeSchema, specialDayTypeSchema } from '../lib/validation.js';
import { HOLIDAYS_BY_YEAR } from '../data/holidaysKr.js';
import { requireAuth, requireScheduleManager } from '../permissions/middleware.js';

export const specialDaysRouter = Router();
specialDaysRouter.use(requireAuth);

const ALL_GRADES = [1, 2, 3] as const;

/**
 * GET /api/special-days?year=&month= 또는 ?from=&to= — 특별 일정 조회 (로그인).
 * 특별 일정은 (날짜 × 학년) 단위 행이다. 전 학년 일정은 학년별 3행.
 */
specialDaysRouter.get('/', async (req, res) => {
  const { year, month, from, to } = req.query;
  let where = {};
  if (typeof year === 'string' && typeof month === 'string') {
    const y = Number(year);
    const m = Number(month);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    where = { date: { gte: start, lte: end } };
  } else if (typeof from === 'string' && typeof to === 'string') {
    where = { date: { gte: from, lte: to } };
  }
  const days = await prisma.specialDay.findMany({ where, orderBy: [{ date: 'asc' }, { grade: 'asc' }] });
  res.json(days);
});

/** 적용 학년 (생략 시 전 학년). 중복 제거 후 정렬. */
const gradesSchema = z
  .array(gradeSchema)
  .min(1, '적용 학년을 하나 이상 선택해주세요.')
  .optional()
  .transform((g) => [...new Set(g ?? ALL_GRADES)].sort());

const singleSchema = z.object({
  date: dateStringSchema,
  type: specialDayTypeSchema,
  title: z.string().min(1, '일정명을 입력해주세요.'),
  grades: gradesSchema,
  confirmDeleteAssignments: z.boolean().optional(),
});
const rangeSchema = z.object({
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  type: specialDayTypeSchema,
  title: z.string().min(1, '일정명을 입력해주세요.'),
  grades: gradesSchema,
  confirmDeleteAssignments: z.boolean().optional(),
});

/**
 * 특별 일정 저장 공통 처리 (등록·묶음 수정).
 * - (dates × grades) 칸에 이미 배정이 있으면 confirm이 아닌 이상 409 경고, 확인 시 그 배정만 삭제
 * - 마감(CLOSED) 월의 배정이 걸리면 확인해도 거부 (F8)
 * - replaceIds가 있으면 기존 행을 지우고 새 값으로 다시 만든다 (묶음 수정)
 */
async function saveSpecialDays(input: {
  dates: string[];
  grades: number[];
  type: string;
  title: string;
  confirmDeleteAssignments: boolean;
  replaceIds?: number[];
}): Promise<{ status: number; body: unknown }> {
  const { dates, grades, type, title, confirmDeleteAssignments, replaceIds = [] } = input;

  const conflictingAssignments = await prisma.assignment.findMany({
    where: { date: { in: dates }, grade: { in: grades } },
  });

  // F8: 마감(CLOSED)된 학년·월의 배정은 특별 일정 등록으로도 삭제할 수 없다.
  const closedPlans = await prisma.monthPlan.findMany({ where: { status: 'CLOSED' } });
  const closedKeys = new Set(closedPlans.map((p) => `${p.year}-${p.month}-${p.grade}`));
  const closedConflicts = conflictingAssignments.filter((a) => {
    const [y, m] = a.date.split('-').map(Number);
    return closedKeys.has(`${y}-${m}-${a.grade}`);
  });
  if (closedConflicts.length > 0) {
    const labels = [...new Set(closedConflicts.map((a) => `${a.date} ${a.grade}학년`))].sort();
    return {
      status: 409,
      body: {
        error: `마감된 월의 감독 배정이 포함되어 있어 저장할 수 없습니다. 마감 해제 후 저장해주세요. (${labels.join(', ')})`,
        closedConflicts: labels,
      },
    };
  }

  if (conflictingAssignments.length > 0 && !confirmDeleteAssignments) {
    const conflictingDates = [...new Set(conflictingAssignments.map((a) => a.date))].sort();
    const conflictingCells = [...new Set(conflictingAssignments.map((a) => `${a.date} ${a.grade}학년`))].sort();
    return {
      status: 409,
      body: {
        warning: true,
        error: '이미 감독 배정이 있는 날짜·학년이 포함되어 있습니다. 확인 시 해당 배정은 삭제됩니다.',
        conflictingDates,
        conflictingCells,
      },
    };
  }

  const assignmentIds = conflictingAssignments.map((a) => a.id);
  const created = await prisma.$transaction(async (tx) => {
    if (assignmentIds.length > 0) {
      await tx.assignmentHistory.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
      await tx.notification.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
      await tx.assignment.deleteMany({ where: { id: { in: assignmentIds } } });
    }
    if (replaceIds.length > 0) await tx.specialDay.deleteMany({ where: { id: { in: replaceIds } } });
    const rows = [];
    for (const date of dates) {
      for (const grade of grades) {
        rows.push(
          await tx.specialDay.upsert({
            where: { date_grade: { date, grade } },
            update: { type, title },
            create: { date, grade, type, title },
          }),
        );
      }
    }
    return rows;
  });
  return { status: replaceIds.length > 0 ? 200 : 201, body: created };
}

/**
 * POST /api/special-days — 특별 일정 등록 (ADMIN, 학년부장). 단일 날짜 또는 기간(startDate~endDate),
 * 적용 학년(grades, 생략 시 전 학년)을 지정한다. 예: 2학년 수학여행 → grades: [2].
 * 해당 날짜·학년에 이미 배정이 있으면 confirmDeleteAssignments=true가 아닌 이상 409로 경고를 반환한다.
 */
specialDaysRouter.post('/', requireScheduleManager, async (req, res) => {
  const rangeParsed = rangeSchema.safeParse(req.body);
  const singleParsed = singleSchema.safeParse(req.body);

  let dates: string[];
  let body: { type: string; title: string; grades: number[]; confirmDeleteAssignments?: boolean };

  if (rangeParsed.success) {
    try {
      dates = dateRange(rangeParsed.data.startDate, rangeParsed.data.endDate);
    } catch {
      return res.status(400).json({ error: '시작일이 종료일보다 늦을 수 없습니다.' });
    }
    body = rangeParsed.data;
  } else if (singleParsed.success) {
    dates = [singleParsed.data.date];
    body = singleParsed.data;
  } else {
    const issue = (rangeParsed.error.issues.find((i) => i.path[0] === 'grades') ?? singleParsed.error.issues[0])?.message;
    return res.status(400).json({ error: issue ?? '날짜, 유형, 일정명, 적용 학년을 올바르게 입력해주세요.' });
  }

  const result = await saveSpecialDays({
    dates,
    grades: body.grades,
    type: body.type,
    title: body.title,
    confirmDeleteAssignments: body.confirmDeleteAssignments ?? false,
  });
  res.status(result.status).json(result.body);
});

const groupUpdateSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
  date: dateStringSchema,
  type: specialDayTypeSchema,
  title: z.string().min(1, '일정명을 입력해주세요.'),
  grades: gradesSchema,
  confirmDeleteAssignments: z.boolean().optional(),
});

/**
 * PUT /api/special-days/group — 화면의 "일정 1건"(같은 날짜·유형·일정명의 학년별 행 묶음) 수정 (ADMIN, 학년부장).
 * 날짜·유형·일정명·감독 제외 학년을 바꿀 수 있다. 새로 제외되는 날짜·학년에 배정이 있으면 등록과 같은 경고 절차.
 * 제외에서 빠진 학년은 그날 다시 운영일이 된다 (배정은 부분 재편성 또는 미배정 칸 지정으로 채운다).
 */
specialDaysRouter.put('/group', requireScheduleManager, async (req, res) => {
  const parsed = groupUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' });
  }
  const { ids, date, type, title, grades, confirmDeleteAssignments } = parsed.data;
  const existing = await prisma.specialDay.count({ where: { id: { in: ids } } });
  if (existing !== ids.length) return res.status(404).json({ error: '수정할 일정을 찾을 수 없습니다.' });

  const result = await saveSpecialDays({
    dates: [date],
    grades,
    type,
    title,
    confirmDeleteAssignments: confirmDeleteAssignments ?? false,
    replaceIds: ids,
  });
  res.status(result.status).json(result.body);
});

const updateSchema = z.object({
  date: dateStringSchema.optional(),
  grade: gradeSchema.optional(),
  type: specialDayTypeSchema.optional(),
  title: z.string().min(1).optional(),
});

/** PUT /api/special-days/:id — 특별 일정 1행(날짜·학년) 수정 (ADMIN, 학년부장). */
specialDaysRouter.put('/:id', requireScheduleManager, async (req, res) => {
  const id = Number(req.params.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: '입력값이 올바르지 않습니다.' });
  }
  const existing = await prisma.specialDay.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: '해당 일정을 찾을 수 없습니다.' });
  }
  try {
    const updated = await prisma.specialDay.update({ where: { id }, data: parsed.data });
    res.json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: '같은 날짜·학년에 이미 특별 일정이 있습니다.' });
    }
    throw err;
  }
});

/** DELETE /api/special-days?ids=1,2,3 — 여러 행 한 번에 삭제 (ADMIN, 학년부장). 화면의 "일정 1건"은 학년별 여러 행이다. */
specialDaysRouter.delete('/', requireScheduleManager, async (req, res) => {
  const ids = String(req.query.ids ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return res.status(400).json({ error: '삭제할 일정을 지정해주세요.' });
  const { count } = await prisma.specialDay.deleteMany({ where: { id: { in: ids } } });
  res.json({ ok: true, deleted: count });
});

/** DELETE /api/special-days/:id — 특별 일정 1행 삭제 (ADMIN, 학년부장). */
specialDaysRouter.delete('/:id', requireScheduleManager, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.specialDay.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: '해당 일정을 찾을 수 없습니다.' });
  }
  await prisma.specialDay.delete({ where: { id } });
  res.json({ ok: true });
});

const seedHolidaysSchema = z.object({ year: z.number().int() });

/** POST /api/special-days/seed-holidays — 연도별 법정 공휴일 시드 불러오기 (ADMIN, 학년부장). 공휴일은 전 학년. */
specialDaysRouter.post('/seed-holidays', requireScheduleManager, async (req, res) => {
  const parsed = seedHolidaysSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: '연도를 입력해주세요.' });
  }
  const holidays = HOLIDAYS_BY_YEAR[parsed.data.year];
  if (!holidays) {
    return res.status(400).json({
      error: `${parsed.data.year}년 공휴일 시드 데이터가 없습니다. 지원 연도: ${Object.keys(HOLIDAYS_BY_YEAR).join(', ')}`,
    });
  }
  const created = await prisma.$transaction(
    holidays.flatMap((h) =>
      ALL_GRADES.map((grade) =>
        prisma.specialDay.upsert({
          where: { date_grade: { date: h.date, grade } },
          update: { type: 'HOLIDAY', title: h.title },
          create: { date: h.date, grade, type: 'HOLIDAY', title: h.title },
        }),
      ),
    ),
  );
  res.status(201).json(created);
});
