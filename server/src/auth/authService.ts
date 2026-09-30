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

/**
 * 이름 + PIN 로그인. 동명이인이 있으면 PIN이 맞는 교사로 로그인한다.
 * PIN이 틀리면 같은 이름의 (잠기지 않은 활성) 교사 모두에 실패 횟수를 올린다.
 */
export async function login(name: string, pin: string): Promise<LoginResult> {
  const teachers = await prisma.teacher.findMany({ where: { name: name.trim() } });
  if (teachers.length === 0) return { ok: false, reason: 'NOT_FOUND' };

  const active = teachers.filter((t) => t.active);
  if (active.length === 0) return { ok: false, reason: 'INACTIVE' };

  const now = Date.now();
  const unlocked = active.filter((t) => !t.lockedUntil || t.lockedUntil.getTime() <= now);
  if (unlocked.length === 0) {
    const lockedUntil = new Date(Math.max(...active.map((t) => t.lockedUntil!.getTime())));
    return { ok: false, reason: 'LOCKED', lockedUntil };
  }

  const matched = [];
  for (const t of unlocked) {
    if (await verifyPin(pin, t.pinHash)) matched.push(t);
  }

  // 동명이인이 같은 PIN을 쓰면 누구인지 알 수 없으므로 실패로 처리한다 (실패 횟수는 올리지 않는다).
  if (matched.length > 1) return { ok: false, reason: 'WRONG_PIN' };

  if (matched.length === 0) {
    const lockedUntil = new Date(now + LOCKOUT_MINUTES * 60 * 1000);
    let anyLocked = false;
    for (const t of unlocked) {
      const failedLoginCount = t.failedLoginCount + 1;
      const shouldLock = failedLoginCount >= MAX_ATTEMPTS;
      anyLocked ||= shouldLock;
      await prisma.teacher.update({
        where: { id: t.id },
        data: {
          failedLoginCount: shouldLock ? 0 : failedLoginCount,
          lockedUntil: shouldLock ? lockedUntil : null,
        },
      });
    }
    // 잠긴 계정이 있고 나머지 동명이인도 모두 잠겼을 때만 잠김으로 안내한다.
    if (anyLocked && unlocked.every((t) => t.failedLoginCount + 1 >= MAX_ATTEMPTS)) {
      return { ok: false, reason: 'LOCKED', lockedUntil };
    }
    return { ok: false, reason: 'WRONG_PIN' };
  }

  const teacher = matched[0];
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
