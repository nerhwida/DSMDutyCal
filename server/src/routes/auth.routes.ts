import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { login } from '../auth/authService.js';
import { hashPin, isValidPinFormat, verifyPin } from '../auth/pin.js';
import { requireAuth } from '../permissions/middleware.js';

export const authRouter = Router();

/** GET /api/auth/teachers — 로그인 화면용 교사 이름 목록 (공개). */
authRouter.get('/teachers', async (_req, res) => {
  const teachers = await prisma.teacher.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { sortOrder: 'asc' },
  });
  res.json(teachers);
});

const loginSchema = z.object({
  teacherId: z.number().int(),
  pin: z.string().min(4).max(6),
});

/** POST /api/auth/login — 이름(teacherId) + PIN 로그인. */
authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: '이름과 PIN을 올바르게 입력해주세요.' });
  }

  const result = await login(parsed.data.teacherId, parsed.data.pin);
  if (!result.ok) {
    if (result.reason === 'LOCKED') {
      return res.status(423).json({
        error: '로그인 실패 횟수를 초과하여 계정이 잠겼습니다. 잠시 후 다시 시도해주세요.',
        lockedUntil: result.lockedUntil,
      });
    }
    if (result.reason === 'INACTIVE') {
      return res.status(403).json({ error: '비활성화된 계정입니다. 관리자에게 문의하세요.' });
    }
    return res.status(401).json({ error: '이름 또는 PIN이 올바르지 않습니다.' });
  }

  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다.' });
    }
    req.session.teacherId = result.teacherId;
    res.json({ ok: true, mustChangePin: result.mustChangePin });
  });
});

/** POST /api/auth/logout */
authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('dutycal.sid');
    res.json({ ok: true });
  });
});

/** GET /api/auth/me — 세션·역할·담당 학년. */
authRouter.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

const pinChangeSchema = z.object({
  currentPin: z.string().min(4).max(6),
  newPin: z.string().min(4).max(6),
});

/** PUT /api/auth/pin — 본인 PIN 변경. */
authRouter.put('/pin', requireAuth, async (req, res) => {
  const parsed = pinChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: '현재 PIN과 새 PIN을 올바르게 입력해주세요.' });
  }
  if (!isValidPinFormat(parsed.data.newPin)) {
    return res.status(400).json({ error: '새 PIN은 숫자 4~6자리로 입력해주세요.' });
  }

  const teacher = await prisma.teacher.findUnique({ where: { id: req.user!.id } });
  if (!teacher) {
    return res.status(401).json({ error: '세션이 유효하지 않습니다.' });
  }

  const valid = await verifyPin(parsed.data.currentPin, teacher.pinHash);
  if (!valid) {
    return res.status(401).json({ error: '현재 PIN이 올바르지 않습니다.' });
  }

  const pinHash = await hashPin(parsed.data.newPin);
  await prisma.teacher.update({
    where: { id: teacher.id },
    data: { pinHash, mustChangePin: false },
  });

  res.json({ ok: true });
});
