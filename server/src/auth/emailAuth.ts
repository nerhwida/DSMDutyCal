import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { sendMail } from '../lib/mailer.js';

/** 로그인에 쓸 수 있는 학교 이메일 도메인. */
export const SCHOOL_EMAIL_DOMAIN = 'dsm.hs.kr';

const CODE_TTL_MINUTES = 10;
const RESEND_SECONDS = 60;
const MAX_CODE_ATTEMPTS = 5;

export type EmailCodePurpose = 'LOGIN' | 'REGISTER';

/** 소문자·공백 제거 후 @dsm.hs.kr 주소면 반환, 아니면 null. */
export function normalizeSchoolEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return /^[a-z0-9._%+-]+@dsm\.hs\.kr$/.test(email) ? email : null;
}

const hashCode = (code: string) => createHash('sha256').update(code).digest();

/**
 * 6자리 인증 코드를 만들어 메일로 보낸다. 교사·용도별로 가장 최근 코드 1건만 유효하다.
 * 직전 코드 발송 후 RESEND_SECONDS가 지나지 않았으면 보내지 않고 'TOO_SOON'.
 */
export async function issueEmailCode(
  teacherId: number,
  purpose: EmailCodePurpose,
  email: string,
): Promise<'SENT' | 'TOO_SOON'> {
  const last = await prisma.emailCode.findFirst({ where: { teacherId, purpose }, orderBy: { id: 'desc' } });
  if (last && Date.now() - last.createdAt.getTime() < RESEND_SECONDS * 1000) return 'TOO_SOON';

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const label = purpose === 'LOGIN' ? '로그인' : '이메일 등록';
  await sendMail({
    to: email,
    subject: `[DutyCal] ${label} 인증 코드 ${code}`,
    text: `DutyCal ${label} 인증 코드: ${code}\n\n${CODE_TTL_MINUTES}분 안에 입력해주세요. 요청하지 않았다면 이 메일을 무시하세요.`,
  });
  await prisma.$transaction([
    prisma.emailCode.deleteMany({ where: { teacherId, purpose } }),
    prisma.emailCode.create({
      data: {
        teacherId,
        purpose,
        email,
        codeHash: hashCode(code).toString('hex'),
        expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
      },
    }),
  ]);
  return 'SENT';
}

export type CodeCheck = { ok: true; email: string } | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'TOO_MANY' };

/**
 * 인증 코드 확인. 틀리면 시도 횟수를 올리고, MAX_CODE_ATTEMPTS번 틀리면 그 코드는 더 쓸 수 없다.
 * email을 주면 코드를 보낸 주소와 같아야 한다. 성공하면 코드를 지운다 (한 번만 쓸 수 있음).
 */
export async function checkEmailCode(
  teacherId: number,
  purpose: EmailCodePurpose,
  code: string,
  email?: string,
): Promise<CodeCheck> {
  const rec = await prisma.emailCode.findFirst({ where: { teacherId, purpose }, orderBy: { id: 'desc' } });
  if (!rec || (email !== undefined && rec.email !== email)) return { ok: false, reason: 'INVALID' };
  if (rec.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'EXPIRED' };
  if (rec.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: 'TOO_MANY' };

  if (!timingSafeEqual(hashCode(code.trim()), Buffer.from(rec.codeHash, 'hex'))) {
    const attempts = rec.attempts + 1;
    await prisma.emailCode.update({ where: { id: rec.id }, data: { attempts } });
    return { ok: false, reason: attempts >= MAX_CODE_ATTEMPTS ? 'TOO_MANY' : 'INVALID' };
  }
  await prisma.emailCode.delete({ where: { id: rec.id } });
  return { ok: true, email: rec.email };
}

export const CODE_FAILURE_MESSAGE: Record<'INVALID' | 'EXPIRED' | 'TOO_MANY', string> = {
  INVALID: '인증 코드가 올바르지 않습니다.',
  EXPIRED: '인증 코드가 만료되었습니다. 코드를 다시 받아주세요.',
  TOO_MANY: '인증 코드를 여러 번 틀렸습니다. 코드를 다시 받아주세요.',
};
