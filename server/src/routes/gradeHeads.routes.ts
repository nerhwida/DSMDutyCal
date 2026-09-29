import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { recordAudit } from '../lib/audit.js';
import { requireAdmin, requireAuth } from '../permissions/middleware.js';

export const gradeHeadsRouter = Router();
gradeHeadsRouter.use(requireAuth);

const setGradeHeadSchema = z.object({ teacherId: z.number().int() });

/** PUT /api/grade-heads/:grade — 학년부장 지정 (ADMIN 전용, 가정 10: 교사 1명당 최대 1개 학년). */
gradeHeadsRouter.put('/:grade', requireAdmin, async (req, res) => {
  const grade = Number(req.params.grade);
  if (![1, 2, 3].includes(grade)) {
    return res.status(400).json({ error: '학년은 1~3 사이여야 합니다.' });
  }
  const parsed = setGradeHeadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: '교사를 지정해주세요.' });
  }
  const { teacherId } = parsed.data;

  const teacher = await prisma.teacher.findUnique({ where: { id: teacherId } });
  if (!teacher || !teacher.active) {
    return res.status(404).json({ error: '활성 상태인 교사만 학년부장으로 지정할 수 있습니다.' });
  }

  const otherHead = await prisma.gradeHead.findFirst({
    where: { teacherId, grade: { not: grade } },
  });
  if (otherHead) {
    return res.status(400).json({
      error: `${teacher.name} 선생님은 이미 ${otherHead.grade}학년 부장으로 지정되어 있습니다. 먼저 ${otherHead.grade}학년 부장을 변경해주세요.`,
    });
  }

  const previous = await prisma.gradeHead.findUnique({ where: { grade } });
  const result = await prisma.gradeHead.upsert({
    where: { grade },
    update: { teacherId, assignedAt: new Date() },
    create: { grade, teacherId },
  });

  await recordAudit(req.user!.id, 'SET_GRADE_HEAD', {
    grade,
    previousTeacherId: previous?.teacherId ?? null,
    newTeacherId: teacherId,
  });

  res.json(result);
});

/** GET /api/grade-heads — 학년부장 현황 조회 (로그인). */
gradeHeadsRouter.get('/', async (_req, res) => {
  const heads = await prisma.gradeHead.findMany({
    include: { teacher: { select: { id: true, name: true } } },
    orderBy: { grade: 'asc' },
  });
  res.json(heads);
});
