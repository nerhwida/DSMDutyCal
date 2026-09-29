import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { gradeSchema, rotationGroupSchema } from '../lib/validation.js';
import { requireAdmin, requireAuth } from '../permissions/middleware.js';

export const initialCountsRouter = Router();
initialCountsRouter.use(requireAuth, requireAdmin);

/** GET /api/initial-counts — 초기 누계 전체 조회 (ADMIN). */
initialCountsRouter.get('/', async (_req, res) => {
  const list = await prisma.initialCount.findMany({
    include: { teacher: { select: { id: true, name: true } } },
    orderBy: [{ teacherId: 'asc' }, { grade: 'asc' }, { rotationGroup: 'asc' }],
  });
  res.json(list);
});

const bulkSchema = z.object({
  entries: z.array(
    z.object({
      teacherId: z.number().int(),
      grade: gradeSchema,
      rotationGroup: rotationGroupSchema,
      count: z.number().int().min(0),
    }),
  ),
});

/** PUT /api/initial-counts — 초기 누계 일괄 저장 (교사 x 학년 x 순환그룹) (ADMIN). */
initialCountsRouter.put('/', async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: '입력값이 올바르지 않습니다.' });
  }

  const results = await prisma.$transaction(
    parsed.data.entries.map((e) =>
      prisma.initialCount.upsert({
        where: {
          teacherId_grade_rotationGroup: {
            teacherId: e.teacherId,
            grade: e.grade,
            rotationGroup: e.rotationGroup,
          },
        },
        update: { count: e.count },
        create: e,
      }),
    ),
  );
  res.json(results);
});
