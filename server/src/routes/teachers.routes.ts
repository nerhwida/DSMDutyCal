import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPin } from '../auth/pin.js';
import { recordAudit } from '../lib/audit.js';
import {
  dateRangeQuerySchema,
  gradeSchema,
  pinSchema,
  weekdayExclusionReasonSchema,
  weekdaySchema,
} from '../lib/validation.js';
import { requireAdmin, requireAuth, requireGradeScope, requireSelfOrAdmin } from '../permissions/middleware.js';
import { handle } from '../lib/http.js';
import { listTeacherAssignments } from '../services/assignmentService.js';

export const teachersRouter = Router();

teachersRouter.use(requireAuth);

/** GET /api/teachers — 교사 관리 화면용 전체 목록 (활성/비활성 포함, 로그인만 하면 조회 가능). */
teachersRouter.get('/', async (_req, res) => {
  const teachers = await prisma.teacher.findMany({
    // 관리자가 맨 앞, 나머지는 이름 오름차순.
    orderBy: [{ isAdmin: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    include: {
      teacherGrades: true,
      weekdayExclusions: true,
      unavailableDates: { orderBy: { date: 'asc' } },
      gradeHead: true,
    },
  });
  res.json(
    teachers.map(({ pinHash: _pinHash, ...t }) => t), // pinHash는 절대 클라이언트로 내려보내지 않는다.
  );
});

const createTeacherSchema = z.object({
  name: z.string().min(1, '이름을 입력해주세요.'),
  initialPin: pinSchema,
  sortOrder: z.number().int().optional(),
});

/** POST /api/teachers — 교사 등록 (ADMIN). */
teachersRouter.post('/', requireAdmin, async (req, res) => {
  const parsed = createTeacherSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' });
  }
  const { name, initialPin, sortOrder } = parsed.data;
  const pinHash = await hashPin(initialPin);
  const teacher = await prisma.teacher.create({
    data: { name, pinHash, mustChangePin: true, active: true, sortOrder: sortOrder ?? 0 },
  });
  await recordAudit(req.user!.id, 'CREATE_TEACHER', { teacherId: teacher.id, name: teacher.name });
  const { pinHash: _pinHash, ...safeTeacher } = teacher;
  res.status(201).json(safeTeacher);
});

const updateTeacherSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

/** PUT /api/teachers/:id — 교사 정보 수정/비활성화 (ADMIN). */
teachersRouter.put('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const parsed = updateTeacherSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: '입력값이 올바르지 않습니다.' });
  }
  const existing = await prisma.teacher.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: '해당 교사를 찾을 수 없습니다.' });
  }
  const teacher = await prisma.teacher.update({ where: { id }, data: parsed.data });
  const { pinHash: _pinHash, ...safeTeacher } = teacher;
  res.json(safeTeacher);
});

/** DELETE /api/teachers/:id — 감독 기록이 없는 교사만 완전 삭제 가능 (ADMIN). */
teachersRouter.delete('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const teacher = await prisma.teacher.findUnique({ where: { id } });
  if (!teacher) {
    return res.status(404).json({ error: '해당 교사를 찾을 수 없습니다.' });
  }

  const gradeHead = await prisma.gradeHead.findFirst({ where: { teacherId: id } });
  if (gradeHead) {
    return res
      .status(409)
      .json({ error: `${gradeHead.grade}학년 학년부장으로 지정되어 있습니다. 먼저 학년부장을 변경해주세요.` });
  }

  const hasHistory = await prisma.assignment.findFirst({
    where: { OR: [{ teacherId: id }, { originalTeacherId: id }] },
  });
  if (hasHistory) {
    return res
      .status(409)
      .json({ error: '감독 기록이 있는 교사는 삭제할 수 없습니다. 비활성화를 사용해주세요.' });
  }

  await prisma.$transaction([
    prisma.teacherGrade.deleteMany({ where: { teacherId: id } }),
    prisma.teacherWeekdayExclusion.deleteMany({ where: { teacherId: id } }),
    prisma.teacherUnavailableDate.deleteMany({ where: { teacherId: id } }),
    prisma.initialCount.deleteMany({ where: { teacherId: id } }),
    prisma.teacher.delete({ where: { id } }),
  ]);
  res.json({ ok: true });
});

const resetPinSchema = z.object({ newPin: pinSchema.optional() });

/** POST /api/teachers/:id/reset-pin — PIN 초기화 (ADMIN). */
teachersRouter.post('/:id/reset-pin', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const parsed = resetPinSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'PIN 형식이 올바르지 않습니다.' });
  }
  const teacher = await prisma.teacher.findUnique({ where: { id } });
  if (!teacher) {
    return res.status(404).json({ error: '해당 교사를 찾을 수 없습니다.' });
  }

  const newPin = parsed.data.newPin ?? String(Math.floor(1000 + Math.random() * 9000));
  const pinHash = await hashPin(newPin);
  await prisma.teacher.update({
    where: { id },
    data: { pinHash, mustChangePin: true, failedLoginCount: 0, lockedUntil: null },
  });
  await recordAudit(req.user!.id, 'RESET_PIN', { teacherId: id });
  res.json({ ok: true, newPin });
});

const teacherGradeSchema = z.object({
  grade: gradeSchema,
  canWeekday: z.boolean(),
  canFriday: z.boolean(),
});

/**
 * PUT /api/teachers/:id/grades — 학년별 감독 가능 여부 (ADMIN, 해당 학년부장).
 * body.grade로 대상 학년을 지정하므로 requireGradeScope는 body를 읽는다.
 */
teachersRouter.put(
  '/:id/grades',
  requireGradeScope((req) => teacherGradeSchema.safeParse(req.body).data?.grade),
  async (req, res) => {
    const teacherId = Number(req.params.id);
    const parsed = teacherGradeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '입력값이 올바르지 않습니다.' });
    }
    const { grade, canWeekday, canFriday } = parsed.data;

    const teacher = await prisma.teacher.findUnique({ where: { id: teacherId } });
    if (!teacher) {
      return res.status(404).json({ error: '해당 교사를 찾을 수 없습니다.' });
    }

    const existingCount = await prisma.teacherGrade.count({ where: { grade } });
    const result = await prisma.teacherGrade.upsert({
      where: { teacherId_grade: { teacherId, grade } },
      update: { canWeekday, canFriday },
      create: {
        teacherId,
        grade,
        canWeekday,
        canFriday,
        weekdayOrder: existingCount + 1,
        fridayOrder: existingCount + 1,
      },
    });
    res.json(result);
  },
);

/** GET /api/teachers/:id/assignments?from=&to= — 맞교환 대상 교사의 감독 목록 (확정 월만, 로그인). */
teachersRouter.get(
  '/:id/assignments',
  handle(async (req, res) => {
    const parsed = dateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: '조회 기간(from, to)을 YYYY-MM-DD 형식으로 입력해주세요.' });
    res.json(await listTeacherAssignments(Number(req.params.id), parsed.data, req.user!, { swappableOnly: true }));
  }),
);

const unavailableSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식이어야 합니다.'),
  reason: z.string().min(1, '사유를 입력해주세요.'),
});

/** GET /api/teachers/:id/unavailable — 감독 불가일 목록 (본인, ADMIN). */
teachersRouter.get(
  '/:id/unavailable',
  requireSelfOrAdmin((req) => Number(req.params.id)),
  async (req, res) => {
    const teacherId = Number(req.params.id);
    const list = await prisma.teacherUnavailableDate.findMany({
      where: { teacherId },
      orderBy: { date: 'asc' },
    });
    res.json(list);
  },
);

/** POST /api/teachers/:id/unavailable — 감독 불가일 등록 (본인, ADMIN). */
teachersRouter.post(
  '/:id/unavailable',
  requireSelfOrAdmin((req) => Number(req.params.id)),
  async (req, res) => {
    const teacherId = Number(req.params.id);
    const parsed = unavailableSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' });
    }
    const created = await prisma.teacherUnavailableDate.upsert({
      where: { teacherId_date: { teacherId, date: parsed.data.date } },
      update: { reason: parsed.data.reason },
      create: { teacherId, date: parsed.data.date, reason: parsed.data.reason },
    });
    res.status(201).json(created);
  },
);

/** DELETE /api/teachers/:id/unavailable/:recordId — 감독 불가일 삭제 (본인, ADMIN). */
teachersRouter.delete(
  '/:id/unavailable/:recordId',
  requireSelfOrAdmin((req) => Number(req.params.id)),
  async (req, res) => {
    const teacherId = Number(req.params.id);
    const recordId = Number(req.params.recordId);
    const record = await prisma.teacherUnavailableDate.findUnique({ where: { id: recordId } });
    if (!record || record.teacherId !== teacherId) {
      return res.status(404).json({ error: '해당 기록을 찾을 수 없습니다.' });
    }
    await prisma.teacherUnavailableDate.delete({ where: { id: recordId } });
    res.json({ ok: true });
  },
);

const weekdayExclusionsSchema = z.array(
  z.object({ weekday: weekdaySchema, reason: weekdayExclusionReasonSchema }),
);

/**
 * PUT /api/teachers/:id/weekday-exclusions — 요일 제외(방과후 등) 전체 교체 (본인, ADMIN).
 * body: [{ weekday, reason }, ...] — 현재 목록으로 완전히 대체한다.
 */
teachersRouter.put(
  '/:id/weekday-exclusions',
  requireSelfOrAdmin((req) => Number(req.params.id)),
  async (req, res) => {
    const teacherId = Number(req.params.id);
    const parsed = weekdayExclusionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '입력값이 올바르지 않습니다.' });
    }

    await prisma.$transaction([
      prisma.teacherWeekdayExclusion.deleteMany({ where: { teacherId } }),
      prisma.teacherWeekdayExclusion.createMany({
        data: parsed.data.map((e) => ({ teacherId, weekday: e.weekday, reason: e.reason })),
      }),
    ]);

    const list = await prisma.teacherWeekdayExclusion.findMany({ where: { teacherId } });
    res.json(list);
  },
);

const orderSchema = z.object({
  rotationGroup: z.enum(['WEEKDAY', 'FRIDAY']),
  teacherIds: z.array(z.number().int()).min(1),
});

export const gradeOrderRouter = Router();
gradeOrderRouter.use(requireAuth);

/** PUT /api/grades/:grade/order — 학년×요일그룹별 순환 순서 변경 (ADMIN, 해당 학년부장). */
gradeOrderRouter.put(
  '/:grade/order',
  requireGradeScope((req) => Number(req.params.grade)),
  async (req, res) => {
    const grade = Number(req.params.grade);
    const parsed = orderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '입력값이 올바르지 않습니다.' });
    }
    const { rotationGroup, teacherIds } = parsed.data;

    const rows = await prisma.teacherGrade.findMany({ where: { grade, teacherId: { in: teacherIds } } });
    if (rows.length !== teacherIds.length) {
      return res
        .status(400)
        .json({ error: '해당 학년에 등록되지 않은 교사가 순서 목록에 포함되어 있습니다.' });
    }

    const field = rotationGroup === 'WEEKDAY' ? 'weekdayOrder' : 'fridayOrder';
    await prisma.$transaction(
      teacherIds.map((teacherId, index) =>
        prisma.teacherGrade.update({
          where: { teacherId_grade: { teacherId, grade } },
          data: { [field]: index + 1 },
        }),
      ),
    );

    const updated = await prisma.teacherGrade.findMany({
      where: { grade },
      orderBy: { [field]: 'asc' },
    });
    res.json(updated);
  },
);
