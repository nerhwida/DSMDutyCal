import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { recordAudit } from '../lib/audit.js';
import { dateLabel, weekdayOf } from '../lib/dateUtils.js';
import { rotationGroupForWeekday, type Grade, type NotificationType, type Role } from '../lib/enums.js';
import type { AuthenticatedUser } from '../auth/authService.js';
import { BLOCKING_RULE_IDS, allViolations, monthBounds, operatingDays } from '../scheduler/index.js';
import type { ScheduleContext } from '../scheduler/index.js';
import { ServiceError, getPlanStatusForDate, loadSchedulerTeachers } from './schedulerService.js';

type Db = Prisma.TransactionClient | typeof prisma;

async function loadAssignment(id: number) {
  const a = await prisma.assignment.findUnique({ where: { id }, include: { teacher: { select: { name: true } } } });
  if (!a) throw new ServiceError(404, '해당 감독 배정을 찾을 수 없습니다.');
  return a;
}

const cellLabel = (a: { date: string; grade: number }) => `${dateLabel(a.date)} ${a.grade}학년`;

/** 당일 배정 (grade → teacherId). excludeIds의 배정은 이번 변경으로 바뀔 셀이므로 제외한다. */
async function dayAssignmentsOf(db: Db, date: string, excludeIds: number[]): Promise<Map<number, number>> {
  const rows = await db.assignment.findMany({ where: { date, id: { notIn: excludeIds } } });
  return new Map(rows.map((r) => [r.grade, r.teacherId]));
}

function contextFor(
  date: string,
  grade: number,
  dayAssignments: Map<number, number>,
  afterSchoolDay: boolean,
): ScheduleContext {
  const weekday = weekdayOf(date);
  return { date, weekday, grade: grade as Grade, group: rotationGroupForWeekday(weekday), dayAssignments, afterSchoolDay };
}

export interface TeacherEvaluation {
  teacherId: number;
  name: string;
  /** 차단 사유 (같은 날 다른 학년 감독 중, 비활성). null이면 배정 가능. */
  blocking: string | null;
  /** 경고 사유 (방과후 수업, 감독 불가일, 학년 미지정, 금요일 감독 제외 등). */
  warnings: string[];
}

/** 특정 셀(date, grade)에 교사들을 배정했을 때의 차단·경고 사유를 평가한다. */
async function evaluateTeachers(
  db: Db,
  cell: { date: string; grade: number },
  excludeIds: number[],
  teacherIds?: number[],
): Promise<TeacherEvaluation[]> {
  const [teachers, dayAssignments, afterSchoolDay] = await Promise.all([
    loadSchedulerTeachers(cell.date, cell.date, teacherIds),
    dayAssignmentsOf(db, cell.date, excludeIds),
    db.afterSchoolDay.findUnique({ where: { date_grade: { date: cell.date, grade: cell.grade } } }),
  ]);
  const ctx = contextFor(cell.date, cell.grade, dayAssignments, afterSchoolDay !== null);
  return teachers.map((t) => {
    const violations = allViolations(t, ctx);
    return {
      teacherId: t.id,
      name: t.name,
      blocking: violations.find((v) => BLOCKING_RULE_IDS.has(v.ruleId))?.reason ?? null,
      warnings: violations.filter((v) => !BLOCKING_RULE_IDS.has(v.ruleId)).map((v) => v.reason),
    };
  });
}

async function evaluateOne(db: Db, cell: { date: string; grade: number }, excludeIds: number[], teacherId: number) {
  const [evaluation] = await evaluateTeachers(db, cell, excludeIds, [teacherId]);
  if (!evaluation) throw new ServiceError(404, '대상 교사를 찾을 수 없습니다.');
  return evaluation;
}

/** 교체(넘기기·맞교환)는 CONFIRMED 월만 가능 (F1-2 차단 조건 1). */
async function assertSwappable(a: { date: string; grade: number }) {
  const status = await getPlanStatusForDate(a.date, a.grade as Grade);
  if (status === 'CLOSED') throw new ServiceError(409, `${cellLabel(a)}은(는) 마감된 월이라 교체할 수 없습니다.`);
  if (status !== 'CONFIRMED') {
    throw new ServiceError(409, `${cellLabel(a)}은(는) 아직 확정되지 않은 월이라 교체할 수 없습니다.`);
  }
}

/** 관리 목적 변경은 CLOSED 월만 차단한다 (F6). */
async function assertNotClosed(a: { date: string; grade: number }) {
  const status = await getPlanStatusForDate(a.date, a.grade as Grade);
  if (status === 'CLOSED') throw new ServiceError(409, `${cellLabel(a)}은(는) 마감된 월이라 변경할 수 없습니다.`);
  return status;
}

function assertGradeScope(user: AuthenticatedUser, grade: number) {
  if (!user.gradeHeadOf.includes(grade)) {
    throw new ServiceError(403, `${grade}학년 담당 학년부장 또는 관리자만 사용할 수 있는 기능입니다.`);
  }
}

const formatWarnings = (e: TeacherEvaluation, cell: { date: string }) =>
  e.warnings.map((w) => `${e.name} 선생님: ${dateLabel(cell.date)} ${w}`);

async function gradeHeadIds(db: Db, grades: number[]): Promise<number[]> {
  const heads = await db.gradeHead.findMany({ where: { grade: { in: grades } } });
  return heads.map((h) => h.teacherId);
}

async function notify(
  db: Db,
  entries: { teacherId: number; type: NotificationType; assignmentId?: number; message: string }[],
) {
  // 같은 교사에게 같은 알림이 중복되지 않도록 teacherId 기준으로 정리
  const unique = [...new Map(entries.map((e) => [e.teacherId, e])).values()];
  if (unique.length > 0) await db.notification.createMany({ data: unique });
}

function managementRole(user: AuthenticatedUser): Role {
  return user.isAdmin ? 'ADMIN' : 'GRADE_HEAD';
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

/**
 * GET /api/assignments/:id/candidates — F6 팝오버 교사 목록.
 * 수정 권한자(해당 학년부장·ADMIN) 또는 본인 감독 교사만 조회 가능.
 */
export async function getCandidates(assignmentId: number, user: AuthenticatedUser) {
  const a = await loadAssignment(assignmentId);
  if (!user.gradeHeadOf.includes(a.grade) && a.teacherId !== user.id) {
    throw new ServiceError(403, '해당 감독을 변경할 권한이 없습니다.');
  }

  const candidates = await evaluateActiveTeachers(a, [a.id]);
  return {
    assignment: {
      id: a.id,
      date: a.date,
      grade: a.grade,
      rotationGroup: a.rotationGroup,
      teacherId: a.teacherId,
      teacherName: a.teacher.name,
      originalTeacherId: a.originalTeacherId,
      status: await getPlanStatusForDate(a.date, a.grade as Grade),
    },
    candidates: candidates.map((c) => ({
      ...c,
      isCurrent: c.teacherId === a.teacherId,
      isOriginal: c.teacherId === a.originalTeacherId,
    })),
  };
}

/** 셀(date, grade)에 대한 전체 활성 교사 평가 + 이번 달 해당 학년·그룹 감독 횟수 (선택 참고용). */
async function evaluateActiveTeachers(cell: { date: string; grade: number }, excludeIds: number[]) {
  const activeIds = (await prisma.teacher.findMany({ where: { active: true }, select: { id: true } })).map((t) => t.id);
  const evaluations = await evaluateTeachers(prisma, cell, excludeIds, activeIds);

  const group = rotationGroupForWeekday(weekdayOf(cell.date));
  const { start, end } = monthBounds(Number(cell.date.slice(0, 4)), Number(cell.date.slice(5, 7)));
  const monthRows = await prisma.assignment.groupBy({
    by: ['teacherId'],
    where: { grade: cell.grade, rotationGroup: group, date: { gte: start, lte: end } },
    _count: { _all: true },
  });
  const monthCount = new Map(monthRows.map((r) => [r.teacherId, r._count._all]));
  return evaluations.map((e) => ({ ...e, monthCount: monthCount.get(e.teacherId) ?? 0 }));
}

/**
 * 미배정 칸 직접 채우기의 대상 셀 검증: 담당 학년 권한, 편성된(미리보기·확정) 월, 운영일, 비어 있는 칸.
 */
async function assertFillableCell(date: string, grade: number, user: AuthenticatedUser) {
  assertGradeScope(user, grade);
  const status = await getPlanStatusForDate(date, grade as Grade);
  if (status === 'EMPTY') throw new ServiceError(409, `${cellLabel({ date, grade })}: 아직 편성되지 않은 월입니다. 자동 편성을 먼저 실행해주세요.`);
  if (status === 'CLOSED') throw new ServiceError(409, `${cellLabel({ date, grade })}은(는) 마감된 월이라 변경할 수 없습니다.`);

  const [year, month] = date.split('-').map(Number);
  const { start, end } = monthBounds(year, month);
  const specialDays = await prisma.specialDay.findMany({ where: { date: { gte: start, lte: end } } });
  if (!operatingDays(year, month, specialDays, grade).includes(date)) {
    throw new ServiceError(400, `${cellLabel({ date, grade })}은(는) 자율학습 운영일이 아닙니다.`);
  }
  if (await prisma.assignment.findUnique({ where: { date_grade: { date, grade } } })) {
    throw new ServiceError(409, `${cellLabel({ date, grade })}에는 이미 감독이 배정되어 있습니다.`);
  }
  return status;
}

/** GET /api/assignments/candidates?date=&grade= — 미배정 칸 채우기용 교사 목록 (ADMIN, 해당 학년부장). */
export async function getCellCandidates(date: string, grade: number, user: AuthenticatedUser) {
  const status = await assertFillableCell(date, grade, user);
  const candidates = await evaluateActiveTeachers({ date, grade }, []);
  return {
    cell: { date, grade, rotationGroup: rotationGroupForWeekday(weekdayOf(date)), status },
    candidates: candidates.map((c) => ({ ...c, isCurrent: false, isOriginal: false })),
  };
}

/**
 * POST /api/assignments — 미배정 칸 직접 지정 (ADMIN, 해당 학년부장).
 * 관리 변경(F6)과 같은 규칙: 차단 사유(같은 날 다른 학년·비활성)는 불가, 경고 사유는 force일 때만 허용.
 * 최초 교사 = 지정한 교사 (노란 표시 없음).
 * 이력은 "미배정 → 교사"(fromTeacherId=null)로 남고, 확정 월이면 지정된 교사에게 알림을 보낸다.
 */
export async function fillAssignment(
  input: { date: string; grade: number; teacherId: number; force?: boolean; note?: string },
  user: AuthenticatedUser,
) {
  const status = await assertFillableCell(input.date, input.grade, user);
  const cell = { date: input.date, grade: input.grade };

  const e = await evaluateOne(prisma, cell, [], input.teacherId);
  if (e.blocking) throw new ServiceError(409, `${e.name} 선생님: ${e.blocking}`, { blocking: e.blocking });
  if (e.warnings.length > 0 && !input.force) {
    throw new ServiceError(409, '배정 불가 사유가 있는 교사입니다. 강제 배정을 선택하면 저장할 수 있습니다.', {
      warnings: formatWarnings(e, cell),
      requiresForce: true,
    });
  }

  const note = ['[미배정 칸 지정]', input.force && e.warnings.length > 0 ? '[강제 배정]' : null, input.note]
    .filter(Boolean)
    .join(' ');
  return prisma.$transaction(async (tx) => {
    const created = await tx.assignment.create({
      data: {
        date: input.date,
        grade: input.grade,
        teacherId: input.teacherId,
        originalTeacherId: input.teacherId,
        rotationGroup: rotationGroupForWeekday(weekdayOf(input.date)),
        modifiedAt: new Date(),
      },
    });
    await tx.assignmentHistory.create({
      data: {
        assignmentId: created.id,
        fromTeacherId: null,
        toTeacherId: input.teacherId,
        changedById: user.id,
        changedByRole: managementRole(user),
        note,
      },
    });
    if (status === 'CONFIRMED' && input.teacherId !== user.id) {
      await notify(tx, [
        {
          teacherId: input.teacherId,
          type: 'ASSIGNED_BY_CHANGE',
          assignmentId: created.id,
          message: `${user.name} 선생님이 ${cellLabel(cell)} 감독에 배정했습니다.`,
        },
      ]);
    }
    return created;
  });
}

/**
 * 교사의 감독 목록 (내 감독 화면, 맞교환 대상 목록).
 * DRAFT 배정은 해당 학년 조회 권한자에게만 보이며, swappableOnly면 CONFIRMED 월만 반환한다.
 */
export async function listTeacherAssignments(
  teacherId: number,
  range: { from: string; to: string },
  user: AuthenticatedUser,
  options: { swappableOnly?: boolean } = {},
) {
  const rows = await prisma.assignment.findMany({
    where: { teacherId, date: { gte: range.from, lte: range.to } },
    orderBy: [{ date: 'asc' }, { grade: 'asc' }],
  });
  const result = [];
  for (const a of rows) {
    const status = await getPlanStatusForDate(a.date, a.grade as Grade);
    if (options.swappableOnly && status !== 'CONFIRMED') continue;
    if (status === 'DRAFT' && !user.gradeHeadOf.includes(a.grade)) continue;
    result.push({
      id: a.id,
      date: a.date,
      grade: a.grade,
      rotationGroup: a.rotationGroup,
      isModified: a.isModified,
      status,
    });
  }
  return result;
}

/** 본인 관련 교체 이력 (넘긴 감독 / 넘겨받은 감독 / 맞교환). */
export async function listMyHistory(teacherId: number) {
  const rows = await prisma.assignmentHistory.findMany({
    where: { OR: [{ fromTeacherId: teacherId }, { toTeacherId: teacherId }] },
    include: {
      assignment: { select: { date: true, grade: true } },
      fromTeacher: { select: { name: true } },
      toTeacher: { select: { name: true } },
      changedBy: { select: { name: true } },
    },
    orderBy: { changedAt: 'desc' },
    take: 100,
  });
  return rows.map((h) => ({
    id: h.id,
    kind: h.swapGroupId
      ? 'SWAP'
      : h.fromTeacherId === teacherId
        ? 'GAVE'
        : h.fromTeacherId === null
          ? 'ASSIGNED' // 미배정 칸에 지정됨
          : 'RECEIVED',
    date: h.assignment.date,
    grade: h.assignment.grade,
    fromTeacherName: h.fromTeacher?.name ?? null, // null = 미배정 칸을 채운 경우
    toTeacherName: h.toTeacher.name,
    changedByName: h.changedBy.name,
    changedAt: h.changedAt,
    note: h.note,
  }));
}

/** GET /api/assignments/:id/transfer-preview — 넘기기 전 경고 사항 조회 (본인). */
export async function transferPreview(assignmentId: number, toTeacherId: number) {
  const a = await loadAssignment(assignmentId);
  const e = await evaluateOne(prisma, a, [a.id], toTeacherId);
  return { blocking: e.blocking, warnings: formatWarnings(e, a) };
}

// ---------------------------------------------------------------------------
// 관리 목적 변경 (F6) — ADMIN, 해당 학년부장
// ---------------------------------------------------------------------------

export async function changeAssignment(
  assignmentId: number,
  input: { teacherId: number; note?: string; force?: boolean },
  user: AuthenticatedUser,
) {
  const a = await loadAssignment(assignmentId);
  assertGradeScope(user, a.grade);
  const status = await assertNotClosed(a);
  if (input.teacherId === a.teacherId) throw new ServiceError(400, '현재 감독 교사와 같은 교사입니다.');

  const e = await evaluateOne(prisma, a, [a.id], input.teacherId);
  if (e.blocking) throw new ServiceError(409, `${e.name} 선생님: ${e.blocking}`, { blocking: e.blocking });
  if (e.warnings.length > 0 && !input.force) {
    throw new ServiceError(409, '배정 불가 사유가 있는 교사입니다. 강제 배정을 선택하면 저장할 수 있습니다.', {
      warnings: formatWarnings(e, a),
      requiresForce: true,
    });
  }

  const note = [
    user.isAdmin ? '[관리자 지정]' : null,
    input.force && e.warnings.length > 0 ? '[강제 배정]' : null,
    input.note,
  ]
    .filter(Boolean)
    .join(' ');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.assignment.update({
      where: { id: a.id },
      data: user.isAdmin
        ? {
            // 관리자가 직접 지정한 교사는 교체가 아니라 초기 배정으로 본다 (변경 표시 없음, 이력은 유지).
            teacherId: input.teacherId,
            originalTeacherId: input.teacherId,
            isModified: false,
            modifiedAt: new Date(),
          }
        : {
            teacherId: input.teacherId,
            isModified: input.teacherId !== a.originalTeacherId, // 최초 교사로 되돌리면 false (이력은 유지)
            modifiedAt: new Date(),
          },
    });
    await tx.assignmentHistory.create({
      data: {
        assignmentId: a.id,
        fromTeacherId: a.teacherId,
        toTeacherId: input.teacherId,
        changedById: user.id,
        changedByRole: managementRole(user),
        note: note || null,
      },
    });
    // DRAFT는 일반 교사에게 보이지 않으므로 확정 이후 변경만 알린다.
    if (status === 'CONFIRMED') {
      await notify(
        tx,
        [
          {
            teacherId: input.teacherId,
            type: 'ASSIGNED_BY_CHANGE' as const,
            assignmentId: a.id,
            message: `${user.name} 선생님이 ${cellLabel(a)} 감독에 배정했습니다.`,
          },
          {
            teacherId: a.teacherId,
            type: 'REMOVED_BY_CHANGE' as const,
            assignmentId: a.id,
            message: `${user.name} 선생님이 ${cellLabel(a)} 감독을 다른 교사로 변경했습니다.`,
          },
        ].filter((n) => n.teacherId !== user.id),
      );
    }
    return updated;
  });
}

// ---------------------------------------------------------------------------
// 감독 취소 — ADMIN, 해당 학년부장
// ---------------------------------------------------------------------------

type RemovableAssignment = { id: number; date: string; grade: number; teacherId: number };

/**
 * 배정 삭제 공통 처리 (감독 취소, 방과후 운영일 등록). 셀은 미배정이 되고, 배정의 변경 이력도 함께 지워진다
 * (AssignmentHistory는 배정에 매여 있다). 확정 월의 배정이면 해제된 교사에게 셀 목록을 담아 한 번 알린다.
 * 마감 월 검사는 호출하는 쪽에서 한다.
 */
export async function removeAssignmentsTx(
  tx: Prisma.TransactionClient,
  rows: RemovableAssignment[],
  actor: { id: number; name: string },
  reason: string,
) {
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);
  await tx.assignmentHistory.deleteMany({ where: { assignmentId: { in: ids } } });
  await tx.notification.updateMany({ where: { assignmentId: { in: ids } }, data: { assignmentId: null } });
  await tx.assignment.deleteMany({ where: { id: { in: ids } } });

  const confirmed = await tx.monthPlan.findMany({ where: { status: 'CONFIRMED' } });
  const confirmedKeys = new Set(confirmed.map((p) => `${p.year}-${p.month}-${p.grade}`));
  const cellsByTeacher = new Map<number, string[]>();
  for (const r of rows) {
    const [y, m] = r.date.split('-').map(Number);
    if (!confirmedKeys.has(`${y}-${m}-${r.grade}`) || r.teacherId === actor.id) continue;
    cellsByTeacher.set(r.teacherId, [...(cellsByTeacher.get(r.teacherId) ?? []), cellLabel(r)]);
  }
  await notify(
    tx,
    [...cellsByTeacher].map(([teacherId, cells]) => ({
      teacherId,
      type: 'REMOVED_BY_CHANGE' as const,
      message: `${actor.name} 선생님이 ${cells.join(', ')} 감독 배정을 취소했습니다. (${reason})`,
    })),
  );
}

/** DELETE /api/assignments/:id — 감독 취소. 셀을 미배정으로 되돌린다 (ADMIN, 해당 학년부장, 마감 월 불가). */
export async function cancelAssignment(assignmentId: number, user: AuthenticatedUser) {
  const a = await loadAssignment(assignmentId);
  assertGradeScope(user, a.grade);
  await assertNotClosed(a);
  await prisma.$transaction((tx) => removeAssignmentsTx(tx, [a], user, '감독 취소'));
  await recordAudit(user.id, 'CANCEL_ASSIGNMENT', {
    reason: '감독 취소',
    cells: [{ date: a.date, grade: a.grade, teacherId: a.teacherId, teacherName: a.teacher.name }],
  });
  return { ok: true, date: a.date, grade: a.grade };
}

// ---------------------------------------------------------------------------
// 본인 감독 교체 (F1-2) — 모든 교사
// ---------------------------------------------------------------------------

/** POST /api/assignments/:id/transfer — 넘기기. 소유자 검사는 라우트의 requireOwnAssignment가 한다. */
export async function transferAssignment(
  assignmentId: number,
  input: { toTeacherId: number; confirmWarnings?: boolean; note?: string },
  user: AuthenticatedUser,
) {
  const a = await loadAssignment(assignmentId);
  await assertSwappable(a);
  if (input.toTeacherId === a.teacherId) throw new ServiceError(400, '본인에게는 넘길 수 없습니다.');

  const e = await evaluateOne(prisma, a, [a.id], input.toTeacherId);
  if (e.blocking) throw new ServiceError(409, `${e.name} 선생님: ${e.blocking}`, { blocking: e.blocking });
  if (e.warnings.length > 0 && !input.confirmWarnings) {
    throw new ServiceError(409, '확인이 필요한 경고 사항이 있습니다.', {
      warnings: formatWarnings(e, a),
      requiresConfirmation: true,
    });
  }

  const heads = await gradeHeadIds(prisma, [a.grade]);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.assignment.update({
      where: { id: a.id },
      data: { teacherId: input.toTeacherId, isModified: input.toTeacherId !== a.originalTeacherId, modifiedAt: new Date() },
    });
    await tx.assignmentHistory.create({
      data: {
        assignmentId: a.id,
        fromTeacherId: a.teacherId,
        toTeacherId: input.toTeacherId,
        changedById: user.id,
        changedByRole: 'TEACHER',
        note: input.note || null,
      },
    });
    await notify(tx, [
      {
        teacherId: input.toTeacherId,
        type: 'ASSIGNED_BY_CHANGE',
        assignmentId: a.id,
        message: `${a.teacher.name} 선생님이 ${cellLabel(a)} 감독을 넘겼습니다.`,
      },
      ...heads
        .filter((id) => id !== input.toTeacherId && id !== a.teacherId)
        .map((teacherId) => ({
          teacherId,
          type: 'ASSIGNED_BY_CHANGE' as const,
          assignmentId: a.id,
          message: `[감독 교체] ${cellLabel(a)}: ${a.teacher.name} → ${e.name}`,
        })),
    ]);
    return updated;
  });
}

/** POST /api/assignments/swap — 맞교환. 두 배정을 하나의 트랜잭션으로 처리한다. */
export async function swapAssignments(
  input: { myAssignmentId: number; targetAssignmentId: number; confirmWarnings?: boolean; note?: string },
  user: AuthenticatedUser,
) {
  const mine = await loadAssignment(input.myAssignmentId);
  const target = await loadAssignment(input.targetAssignmentId);
  if (mine.id === target.id || target.teacherId === mine.teacherId) {
    throw new ServiceError(400, '본인 감독끼리는 맞교환할 수 없습니다.');
  }
  await assertSwappable(mine);
  await assertSwappable(target);

  const ids = [mine.id, target.id];
  const partnerOnMine = await evaluateOne(prisma, mine, ids, target.teacherId); // 상대 교사 → 내 셀
  const meOnTarget = await evaluateOne(prisma, target, ids, mine.teacherId); // 나 → 상대 셀

  const blocking = [
    partnerOnMine.blocking && `${partnerOnMine.name} 선생님: ${cellLabel(mine)} ${partnerOnMine.blocking}`,
    meOnTarget.blocking && `${meOnTarget.name} 선생님: ${cellLabel(target)} ${meOnTarget.blocking}`,
  ].filter((b): b is string => Boolean(b));
  if (blocking.length > 0) throw new ServiceError(409, blocking.join(' / '), { blocking });

  const warnings = [...formatWarnings(partnerOnMine, mine), ...formatWarnings(meOnTarget, target)];
  if (warnings.length > 0 && !input.confirmWarnings) {
    throw new ServiceError(409, '확인이 필요한 경고 사항이 있습니다.', { warnings, requiresConfirmation: true });
  }

  const heads = await gradeHeadIds(prisma, [mine.grade, target.grade]);
  const swapGroupId = randomUUID();
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    // 검증 이후 다른 요청으로 배정이 바뀌었다면 전체 취소 (둘 다 롤백)
    for (const a of [mine, target]) {
      const current = await tx.assignment.findUnique({ where: { id: a.id } });
      if (current?.teacherId !== a.teacherId) {
        throw new ServiceError(409, '그 사이 감독 배정이 변경되었습니다. 다시 시도해주세요.');
      }
    }
    const pairs = [
      { a: mine, to: target.teacherId },
      { a: target, to: mine.teacherId },
    ];
    const updated = [];
    for (const { a, to } of pairs) {
      updated.push(
        await tx.assignment.update({
          where: { id: a.id },
          data: { teacherId: to, isModified: to !== a.originalTeacherId, modifiedAt: now },
        }),
      );
      await tx.assignmentHistory.create({
        data: {
          assignmentId: a.id,
          swapGroupId,
          fromTeacherId: a.teacherId,
          toTeacherId: to,
          changedById: user.id,
          changedByRole: 'TEACHER',
          note: input.note || null,
        },
      });
    }
    const summary = `${mine.teacher.name} ${cellLabel(mine)} ↔ ${target.teacher.name} ${cellLabel(target)}`;
    await notify(tx, [
      {
        teacherId: target.teacherId,
        type: 'SWAPPED',
        assignmentId: target.id,
        message: `${mine.teacher.name} 선생님과 감독이 맞교환되었습니다. 새 감독: ${cellLabel(mine)} (기존: ${cellLabel(target)})`,
      },
      ...heads
        .filter((id) => id !== mine.teacherId && id !== target.teacherId)
        .map((teacherId) => ({ teacherId, type: 'SWAPPED' as const, message: `[맞교환] ${summary}` })),
    ]);
    return { swapGroupId, assignments: updated };
  });
}
