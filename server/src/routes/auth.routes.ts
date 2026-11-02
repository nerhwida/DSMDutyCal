import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { login } from '../auth/authService.js';
import { hashPin, isValidPinFormat, verifyPin } from '../auth/pin.js';
import { emailConsentRequired, requireAuth } from '../permissions/middleware.js';
import { handle } from '../lib/http.js';
import { recordAudit } from '../lib/audit.js';
import {
  FLOW_TTL_MS,
  authorizationUrl,
  googleConfig,
  googleOAuth,
  identityFromIdToken,
  newFlow,
  type GoogleFlow,
} from '../auth/googleAuth.js';

export const authRouter = Router();

const loginSchema = z.object({
  name: z.string().trim().min(1),
  pin: z.string().min(4).max(6),
});

/** POST /api/auth/login — 이름 + PIN 로그인. (로그인 화면에 교사 목록을 공개하지 않는다.) */
authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'ID 또는 PASSWD가 올바르지 않습니다.' });
  }

  const result = await login(parsed.data.name, parsed.data.pin);
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
    return res.status(401).json({ error: 'ID 또는 PASSWD가 올바르지 않습니다.' });
  }

  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다.' });
    }
    req.session.teacherId = result.teacherId;
    req.session.loginMethod = 'PIN';
    res.json({ ok: true, mustChangePin: result.mustChangePin });
  });
});

// ---------------------------------------------------------------------------
// Google 계정(학교 Workspace) 로그인
//   로그인: GET /google/login → Google → GET /google/callback → 등록된 이메일의 교사로 로그인
//   연결:   (PIN 로그인 후 동의) GET /google/link?consent=1 → Google → callback → 이메일·동의 일시 저장
// 결과는 화면으로 되돌려 보내고, 실패하면 ?loginError= / ?linkError= 코드를 붙인다 (메시지는 화면이 정한다).
// ---------------------------------------------------------------------------

type GoogleError =
  | 'NOT_CONFIGURED'
  | 'NO_CONSENT'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED'
  | 'NOT_SCHOOL_ACCOUNT'
  | 'NOT_REGISTERED'
  | 'INACTIVE'
  | 'EMAIL_TAKEN';

function redirectWithError(res: Response, mode: GoogleFlow['mode'], code: GoogleError) {
  res.redirect(`/?${mode === 'LOGIN' ? 'loginError' : 'linkError'}=${code}`);
}

function startGoogle(req: Request, res: Response, mode: GoogleFlow['mode']) {
  const config = googleConfig();
  if (!config) return redirectWithError(res, mode, 'NOT_CONFIGURED');
  const flow = newFlow(mode, mode === 'LINK' ? req.user!.id : undefined);
  req.session.googleFlow = flow;
  req.session.save((err) => {
    if (err) return redirectWithError(res, mode, 'FAILED');
    res.redirect(authorizationUrl(config, flow));
  });
}

/** GET /api/auth/google/login — Google 로그인 시작. */
authRouter.get('/google/login', (req, res) => startGoogle(req, res, 'LOGIN'));

/** GET /api/auth/google/link?consent=1 — 개인정보 수집·이용 동의 후 내 계정에 Google 계정(학교 이메일) 연결. */
authRouter.get('/google/link', requireAuth, (req, res) => {
  if (req.query.consent !== '1') return redirectWithError(res, 'LINK', 'NO_CONSENT');
  startGoogle(req, res, 'LINK');
});

/** GET /api/auth/google/callback — Google이 돌려보내는 주소 (GCP에 등록한 리디렉션 URI). */
authRouter.get(
  '/google/callback',
  handle(async (req, res) => {
    const flow = req.session.googleFlow;
    delete req.session.googleFlow;
    const mode = flow?.mode ?? 'LOGIN';
    if (typeof req.query.error === 'string') return redirectWithError(res, mode, 'CANCELLED');
    if (!flow || req.query.state !== flow.state || Date.now() - flow.startedAt > FLOW_TTL_MS) {
      return redirectWithError(res, mode, 'EXPIRED');
    }
    const config = googleConfig();
    if (!config) return redirectWithError(res, mode, 'NOT_CONFIGURED');
    if (typeof req.query.code !== 'string') return redirectWithError(res, mode, 'FAILED');

    let idToken: string;
    try {
      idToken = await googleOAuth.exchangeCode(config, req.query.code, flow.verifier);
    } catch (err) {
      console.error(err);
      return redirectWithError(res, mode, 'FAILED');
    }
    const identity = identityFromIdToken(idToken, { clientId: config.clientId, nonce: flow.nonce });
    if (identity === 'INVALID_TOKEN') return redirectWithError(res, mode, 'FAILED');
    if (identity === 'NOT_SCHOOL_ACCOUNT') return redirectWithError(res, mode, 'NOT_SCHOOL_ACCOUNT');
    const owner = await prisma.teacher.findUnique({ where: { email: identity.email } });

    if (flow.mode === 'LINK') {
      // 연결을 시작한 교사로 아직 로그인되어 있어야 한다
      if (!req.session.teacherId || req.session.teacherId !== flow.teacherId) return redirectWithError(res, mode, 'EXPIRED');
      if (owner && owner.id !== flow.teacherId) return redirectWithError(res, mode, 'EMAIL_TAKEN');
      const consentAt = new Date();
      await prisma.teacher.update({ where: { id: flow.teacherId }, data: { email: identity.email, emailConsentAt: consentAt } });
      await recordAudit(flow.teacherId, 'REGISTER_EMAIL', { email: identity.email, consentAt, method: 'GOOGLE' });
      return res.redirect('/');
    }

    if (!owner) return redirectWithError(res, mode, 'NOT_REGISTERED');
    if (!owner.active) return redirectWithError(res, mode, 'INACTIVE');
    await prisma.teacher.update({ where: { id: owner.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    await new Promise<void>((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.teacherId = owner.id;
    req.session.loginMethod = 'GOOGLE';
    res.redirect('/');
  }),
);

/** POST /api/auth/logout */
authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('dutycal.sid');
    res.json({ ok: true });
  });
});

/** GET /api/auth/me — 세션·역할·담당 학년. */
authRouter.get('/me', requireAuth, (req, res) => {
  // emailConsentRequired: 이메일 미등록이면 화면이 동의·등록 화면만 보여 준다.
  res.json({ ...req.user, emailConsentRequired: emailConsentRequired() });
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
  // 초기화 PIN(예: 0000)을 그대로 쓰지 못하게 한다
  if (parsed.data.newPin === parsed.data.currentPin) {
    return res.status(400).json({ error: '새 PIN은 현재 PIN과 달라야 합니다.' });
  }

  const pinHash = await hashPin(parsed.data.newPin);
  await prisma.teacher.update({
    where: { id: teacher.id },
    data: { pinHash, mustChangePin: false },
  });

  res.json({ ok: true });
});
