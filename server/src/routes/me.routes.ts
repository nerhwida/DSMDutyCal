import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handle } from '../lib/http.js';
import { dateRangeQuerySchema } from '../lib/validation.js';
import { requireAuth } from '../permissions/middleware.js';
import { listMyHistory, listTeacherAssignments } from '../services/assignmentService.js';
import { CODE_FAILURE_MESSAGE, checkEmailCode, issueEmailCode, normalizeSchoolEmail } from '../auth/emailAuth.js';
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

// ---------------------------------------------------------------------------
// 학교 이메일 등록 (개인정보 수집·이용 동의 → 인증 코드 확인 → 이메일 로그인 가능)
// ---------------------------------------------------------------------------

const registerRequestSchema = z.object({ email: z.string().max(200), consent: z.literal(true) });

/** POST /api/me/email/request — 동의 후 등록할 주소로 인증 코드 발송. */
meRouter.post(
  '/email/request',
  handle(async (req, res) => {
    if (req.body?.consent !== true) {
      return res.status(400).json({ error: '개인정보 수집·이용에 동의해야 이메일을 등록할 수 있습니다.' });
    }
    const parsed = registerRequestSchema.safeParse(req.body);
    const email = parsed.success ? normalizeSchoolEmail(parsed.data.email) : null;
    if (!email) return res.status(400).json({ error: '@dsm.hs.kr 학교 이메일만 등록할 수 있습니다.' });

    const owner = await prisma.teacher.findUnique({ where: { email } });
    if (owner && owner.id !== req.user!.id) return res.status(409).json({ error: '이미 다른 교사가 등록한 이메일입니다.' });
    if ((await issueEmailCode(req.user!.id, 'REGISTER', email)) === 'TOO_SOON') {
      return res.status(429).json({ error: '인증 코드를 방금 보냈습니다. 1분 뒤에 다시 요청해주세요.' });
    }
    res.json({ ok: true });
  }),
);

/** POST /api/me/email/verify — 인증 코드 확인 후 이메일·동의 일시 저장. */
meRouter.post(
  '/email/verify',
  handle(async (req, res) => {
    const parsed = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: CODE_FAILURE_MESSAGE.INVALID });
    const check = await checkEmailCode(req.user!.id, 'REGISTER', parsed.data.code);
    if (!check.ok) {
      return res.status(check.reason === 'TOO_MANY' ? 429 : 400).json({ error: CODE_FAILURE_MESSAGE[check.reason] });
    }

    const owner = await prisma.teacher.findUnique({ where: { email: check.email } });
    if (owner && owner.id !== req.user!.id) return res.status(409).json({ error: '이미 다른 교사가 등록한 이메일입니다.' });
    const consentAt = new Date();
    await prisma.teacher.update({ where: { id: req.user!.id }, data: { email: check.email, emailConsentAt: consentAt } });
    await recordAudit(req.user!.id, 'REGISTER_EMAIL', { email: check.email, consentAt });
    res.json({ ok: true, email: check.email });
  }),
);

/** DELETE /api/me/email — 동의 철회: 이메일을 지우고 다시 ID·PIN으로만 로그인한다. */
meRouter.delete(
  '/email',
  handle(async (req, res) => {
    await prisma.$transaction([
      prisma.teacher.update({ where: { id: req.user!.id }, data: { email: null, emailConsentAt: null } }),
      prisma.emailCode.deleteMany({ where: { teacherId: req.user!.id } }),
    ]);
    await recordAudit(req.user!.id, 'WITHDRAW_EMAIL', {});
    res.json({ ok: true });
  }),
);
