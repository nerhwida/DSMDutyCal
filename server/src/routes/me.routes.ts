import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handle } from '../lib/http.js';
import { dateRangeQuerySchema } from '../lib/validation.js';
import { requireAuth } from '../permissions/middleware.js';
import { listMyHistory, listTeacherAssignments } from '../services/assignmentService.js';
import { recordAudit } from '../lib/audit.js';

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
    res.json(await listMyHistory(req.user!.id, req.user!));
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

// 학교 Google 계정 연결은 /api/auth/google/link (Google 로그인 흐름과 같은 callback을 쓴다).

/** DELETE /api/me/email — 동의 철회: 연결한 이메일을 지운다 (동의 필수면 다시 연결할 때까지 이용 중지). */
meRouter.delete(
  '/email',
  handle(async (req, res) => {
    await prisma.teacher.update({ where: { id: req.user!.id }, data: { email: null, emailConsentAt: null } });
    await recordAudit(req.user!.id, 'WITHDRAW_EMAIL', {});
    res.json({ ok: true });
  }),
);
