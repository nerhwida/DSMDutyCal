import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handle } from '../lib/http.js';
import { dateRangeQuerySchema } from '../lib/validation.js';
import { requireAuth } from '../permissions/middleware.js';
import { listMyHistory, listTeacherAssignments } from '../services/assignmentService.js';

export const meRouter = Router();

meRouter.use(requireAuth);

/** GET /api/me/assignments?from=&to= — 내 감독 목록. */
meRouter.get(
  '/assignments',
  handle(async (req, res) => {
    const parsed = dateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: '조회 기간(from, to)을 YYYY-MM-DD 형식으로 입력해주세요.' });
    res.json(await listTeacherAssignments(req.user!.id, parsed.data, req.user!));
  }),
);

/** GET /api/me/history — 본인 관련 교체 이력. */
meRouter.get(
  '/history',
  handle(async (req, res) => {
    res.json(await listMyHistory(req.user!.id));
  }),
);

/** GET /api/me/notifications — 알림 목록 + 읽지 않은 개수. */
meRouter.get(
  '/notifications',
  handle(async (req, res) => {
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { teacherId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.count({ where: { teacherId: req.user!.id, readAt: null } }),
    ]);
    res.json({ items, unreadCount });
  }),
);

/** PUT /api/me/notifications — 읽음 처리. body.ids가 없으면 전체 읽음. */
meRouter.put(
  '/notifications',
  handle(async (req, res) => {
    const parsed = z.object({ ids: z.array(z.number().int()).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: '입력값이 올바르지 않습니다.' });
    await prisma.notification.updateMany({
      where: {
        teacherId: req.user!.id,
        readAt: null,
        ...(parsed.data.ids ? { id: { in: parsed.data.ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    res.json({ ok: true });
  }),
);
