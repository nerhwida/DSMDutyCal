import { prisma } from '../lib/prisma.js';
import { hashPin, verifyPin } from './pin.js';

const MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS ?? '5');
const LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES ?? '5');

export type LoginResult =
  | { ok: true; teacherId: number; mustChangePin: boolean }
  | { ok: false; reason: 'NOT_FOUND' | 'INACTIVE' | 'LOCKED' | 'WRONG_PIN'; lockedUntil?: Date };

/** 최초 실행 시 .env의 ADMIN_NAME / ADMIN_INITIAL_PIN으로 관리자 계정을 생성한다. */
export async function ensureBootstrapAdmin(): Promise<void> {
  const existingAdmin = await prisma.teacher.findFirst({ where: { isAdmin: true } });
  if (existingAdmin) return;

  const adminName = process.env.ADMIN_NAME;
  const adminPin = process.env.ADMIN_INITIAL_PIN;
  if (!adminName || !adminPin) {
    throw new Error('ADMIN_NAME / ADMIN_INITIAL_PIN 환경변수가 설정되지 않았습니다.');
  }

  const pinHash = await hashPin(adminPin);
  const created = await prisma.teacher.create({
    data: {
      name: adminName,
      isAdmin: true,
      pinHash,
      mustChangePin: false,
      active: true,
      sortOrder: 0,
    },
  });
  // eslint-disable-next-line no-console
  console.log(`[bootstrap] 관리자 계정 생성됨: ${created.name} (id=${created.id})`);
}

export async function login(teacherId: number, pin: string): Promise<LoginResult> {
  const teacher = await prisma.teacher.findUnique({ where: { id: teacherId } });
  if (!teacher) return { ok: false, reason: 'NOT_FOUND' };
  if (!teacher.active) return { ok: false, reason: 'INACTIVE' };

  if (teacher.lockedUntil && teacher.lockedUntil.getTime() > Date.now()) {
    return { ok: false, reason: 'LOCKED', lockedUntil: teacher.lockedUntil };
  }

  const valid = await verifyPin(pin, teacher.pinHash);
  if (!valid) {
    const failedLoginCount = teacher.failedLoginCount + 1;
    const shouldLock = failedLoginCount >= MAX_ATTEMPTS;
    await prisma.teacher.update({
      where: { id: teacher.id },
      data: {
        failedLoginCount: shouldLock ? 0 : failedLoginCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null,
      },
    });
    if (shouldLock) {
      return {
        ok: false,
        reason: 'LOCKED',
        lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000),
      };
    }
    return { ok: false, reason: 'WRONG_PIN' };
  }

  await prisma.teacher.update({
    where: { id: teacher.id },
    data: { failedLoginCount: 0, lockedUntil: null },
  });

  return { ok: true, teacherId: teacher.id, mustChangePin: teacher.mustChangePin };
}

export interface AuthenticatedUser {
  id: number;
  name: string;
  isAdmin: boolean;
  active: boolean;
  mustChangePin: boolean;
  /** ADMIN은 가정 13에 따라 전 학년을 대행하므로 항상 [1,2,3]이 포함된다. */
  gradeHeadOf: number[];
}

export async function loadAuthenticatedUser(teacherId: number): Promise<AuthenticatedUser | null> {
  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherId },
    include: { gradeHead: true },
  });
  if (!teacher) return null;

  const gradeHeads = await prisma.gradeHead.findMany({ where: { teacherId } });
  const gradeHeadOf = teacher.isAdmin ? [1, 2, 3] : gradeHeads.map((g) => g.grade);

  return {
    id: teacher.id,
    name: teacher.name,
    isAdmin: teacher.isAdmin,
    active: teacher.active,
    mustChangePin: teacher.mustChangePin,
    gradeHeadOf,
  };
}
