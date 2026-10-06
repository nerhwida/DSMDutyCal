import { prisma } from '../lib/prisma.js';
import { recordAudit } from '../lib/audit.js';
import { dateRange, weekdayOf } from '../lib/dateUtils.js';
import {
  rotationGroupForWeekday,
  type Grade,
  type MonthPlanStatus,
  type RotationGroup,
  type WeekdayExclusionReason,
} from '../lib/enums.js';
import type { AuthenticatedUser } from '../auth/authService.js';
import { verifyPin } from '../auth/pin.js';
import {
  excludedGradesByDate,
  generateSchedule,
  gradeExclusions,
  monthBounds,
  operatingDays,
  unassignedReasons,
} from '../scheduler/index.js';
import type {
  CountEntry,
  ExistingAssignment,
  FairnessStat,
  PointerEntry,
  SchedulerInput,
  SchedulerTeacher,
  SchedulerWarning,
} from '../scheduler/index.js';

/** 라우트에서 HTTP 상태 코드로 변환되는 서비스 오류. */
export class ServiceError extends Error {
  constructor(
    public status: number,
    message: string,
    /** 응답 본문에 함께 내려줄 추가 필드 (예: warnings, requiresConfirmation). */
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const CONFIRMED_STATUSES: MonthPlanStatus[] = ['CONFIRMED', 'CLOSED'];

export async function getPlanStatus(year: number, month: number, grade: Grade): Promise<MonthPlanStatus> {
  const plan = await prisma.monthPlan.findUnique({ where: { year_month_grade: { year, month, grade } } });
  return (plan?.status as MonthPlanStatus | undefined) ?? 'EMPTY';
}

/** 'YYYY-MM-DD' 날짜가 속한 월·학년의 편성 상태. */
export async function getPlanStatusForDate(date: string, grade: Grade): Promise<MonthPlanStatus> {
  const [year, month] = date.split('-').map(Number);
  return getPlanStatus(year, month, grade);
}

/** 엔진 규칙 평가용 교사 데이터. 감독 불가일은 [start, end] 범위만 불러온다. */
export async function loadSchedulerTeachers(
  start: string,
  end: string,
  teacherIds?: number[],
): Promise<SchedulerTeacher[]> {
  const teachers = await prisma.teacher.findMany({
    where: teacherIds ? { id: { in: teacherIds } } : undefined,
    include: {
      teacherGrades: true,
      weekdayExclusions: true,
      unavailableDates: { where: { date: { gte: start, lte: end } } },
    },
    orderBy: { sortOrder: 'asc' },
  });
  return teachers.map((t) => ({
    id: t.id,
    name: t.name,
    active: t.active,
    grades: t.teacherGrades.map((g) => ({
      grade: g.grade as Grade,
      canWeekday: g.canWeekday,
      canFriday: g.canFriday,
      weekdayOrder: g.weekdayOrder,
      fridayOrder: g.fridayOrder,
    })),
    weekdayExclusions: t.weekdayExclusions.map((e) => ({
      weekday: e.weekday,
      reason: e.reason as WeekdayExclusionReason,
    })),
    unavailableDates: t.unavailableDates.map((u) => ({ date: u.date, reason: u.reason })),
  }));
}

/**
 * DB에서 엔진 입력을 구성한다.
 * - 누계 = InitialCount + 이전 월 CONFIRMED/CLOSED 배정 수 (실제 담당 교사 기준)
 * - 순환 포인터 시작 = 학년·그룹별 이전 확정 배정 중 가장 마지막 교사
 */
export async function loadSchedulerInput(
  year: number,
  month: number,
  targetGrades: Grade[],
  dates?: string[],
): Promise<SchedulerInput> {
  const { start, end } = monthBounds(year, month);

  const [schedulerTeachers, specialDays, afterSchoolDays, existing, initialCounts, confirmedPlans, priorAssignments] = await Promise.all([
    loadSchedulerTeachers(start, end),
    prisma.specialDay.findMany({ where: { date: { gte: start, lte: end } } }),
    afterSchoolDaysBetween(start, end),
    prisma.assignment.findMany({ where: { date: { gte: start, lte: end } } }),
    prisma.initialCount.findMany(),
    prisma.monthPlan.findMany({ where: { status: { in: CONFIRMED_STATUSES } } }),
    prisma.assignment.findMany({ where: { date: { lt: start } }, orderBy: { date: 'asc' } }),
  ]);

  const confirmedKeys = new Set(confirmedPlans.map((p) => `${p.year}-${p.month}-${p.grade}`));
  const confirmedPrior = priorAssignments.filter((a) => {
    const [y, m] = a.date.split('-').map(Number);
    return confirmedKeys.has(`${y}-${m}-${a.grade}`);
  });

  const priorCounts: CountEntry[] = [
    ...initialCounts.map((c) => ({
      teacherId: c.teacherId,
      grade: c.grade as Grade,
      group: c.rotationGroup as RotationGroup,
      count: c.count,
    })),
    ...confirmedPrior.map((a) => ({
      teacherId: a.teacherId,
      grade: a.grade as Grade,
      group: a.rotationGroup as RotationGroup,
      count: 1,
    })),
  ];

  const lastByQueue = new Map<string, PointerEntry>();
  for (const a of confirmedPrior) {
    lastByQueue.set(`${a.grade}:${a.rotationGroup}`, {
      grade: a.grade as Grade,
      group: a.rotationGroup as RotationGroup,
      teacherId: a.teacherId,
    });
  }

  // 변경 이력이 있는 셀(빈 칸 수동 지정, 관리자 지정 등)은 표시(↻)가 없어도 수동 셀로 보고 편성에서 유지한다.
  const manualIds = new Set(
    (
      await prisma.assignmentHistory.findMany({
        where: { assignmentId: { in: existing.map((a) => a.id) } },
        select: { assignmentId: true },
        distinct: ['assignmentId'],
      })
    ).map((h) => h.assignmentId),
  );
  const existingAssignments: ExistingAssignment[] = existing.map((a) => ({
    date: a.date,
    grade: a.grade as Grade,
    teacherId: a.teacherId,
    isModified: a.isModified || manualIds.has(a.id),
  }));

  return {
    year,
    month,
    targetGrades,
    teachers: schedulerTeachers,
    specialDays: specialDays.map((d) => ({ date: d.date, grade: d.grade })),
    afterSchoolDays,
    existingAssignments,
    priorCounts,
    startPointers: [...lastByQueue.values()],
    dates,
  };
}

/** [start, end] 기간의 편성 제외 (날짜 × 학년) = 특별 일정 + 방과후 운영일에 지정되지 않은 학년. */
export async function gradeExclusionsBetween(start: string, end: string) {
  const [specialDays, afterSchool] = await Promise.all([
    prisma.specialDay.findMany({ where: { date: { gte: start, lte: end } } }),
    afterSchoolDaysBetween(start, end),
  ]);
  return gradeExclusions(specialDays, afterSchool);
}

/** [start, end] 기간의 방과후 운영일 (날짜 × 학년). */
export async function afterSchoolDaysBetween(start: string, end: string): Promise<{ date: string; grade: number }[]> {
  const rows = await prisma.afterSchoolDay.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: [{ date: 'asc' }, { grade: 'asc' }],
  });
  return rows.map((r) => ({ date: r.date, grade: r.grade }));
}

export interface GenerateResult {
  year: number;
  month: number;
  grade: Grade;
  status: MonthPlanStatus;
  generatedCount: number;
  keptCount: number;
  warnings: SchedulerWarning[];
  fairness: FairnessStat[];
}

/**
 * 자동 편성 미리보기 (F4). 미편성·DRAFT 월만 가능하며, DRAFT는 덮어쓴다(다시 편성).
 * 수동 변경 셀은 유지된다.
 */
export async function generateMonthPlan(
  year: number,
  month: number,
  grade: Grade,
  actorId: number,
): Promise<GenerateResult> {
  const status = await getPlanStatus(year, month, grade);
  if (status === 'CONFIRMED') {
    throw new ServiceError(409, `${month}월 ${grade}학년은 이미 확정되었습니다. 부분 재편성을 이용해주세요.`);
  }
  if (status === 'CLOSED') {
    throw new ServiceError(409, `${month}월 ${grade}학년은 마감되어 재편성할 수 없습니다.`);
  }

  const input = await loadSchedulerInput(year, month, [grade]);
  const result = generateSchedule(input);
  const { start, end } = monthBounds(year, month);

  const keptDates = result.assignments.filter((a) => a.source === 'KEPT').map((a) => a.date);
  const generated = result.assignments.filter((a) => a.source === 'GENERATED');

  await prisma.$transaction(async (tx) => {
    const toDelete = await tx.assignment.findMany({
      where: { grade, date: { gte: start, lte: end, notIn: keptDates } },
      select: { id: true },
    });
    const ids = toDelete.map((a) => a.id);
    if (ids.length > 0) {
      await tx.assignmentHistory.deleteMany({ where: { assignmentId: { in: ids } } });
      await tx.notification.updateMany({ where: { assignmentId: { in: ids } }, data: { assignmentId: null } });
      await tx.assignment.deleteMany({ where: { id: { in: ids } } });
    }

    await tx.assignment.createMany({
      data: generated.map((a) => ({
        date: a.date,
        grade: a.grade,
        teacherId: a.teacherId,
        originalTeacherId: a.teacherId,
        rotationGroup: a.group,
      })),
    });

    await tx.monthPlan.upsert({
      where: { year_month_grade: { year, month, grade } },
      update: { status: 'DRAFT' },
      create: { year, month, grade, status: 'DRAFT' },
    });
  });

  await recordAudit(actorId, 'GENERATE', {
    year,
    month,
    grade,
    generated: generated.length,
    kept: keptDates.length,
    unassigned: result.warnings.length,
  });

  return {
    year,
    month,
    grade,
    status: 'DRAFT',
    generatedCount: generated.length,
    keptCount: keptDates.length,
    warnings: result.warnings,
    fairness: result.fairness,
  };
}

export interface RegenerateResult extends Omit<GenerateResult, 'generatedCount' | 'keptCount'> {
  from: string;
  to: string;
  /** 교사가 바뀐 셀 수 */
  changedCount: number;
  /** 미배정이던 셀을 새로 채운 수 */
  filledCount: number;
  /** 다시 편성했지만 같은 교사가 선택된 셀 수 */
  unchangedCount: number;
  /** 후보가 없어 비워진 셀 수 (DRAFT만. CONFIRMED는 기존 배정을 유지한다) */
  removedCount: number;
}

/**
 * 부분 재편성 (F4). 지정한 기간[from, to]의 해당 학년 셀만 다시 편성한다.
 * - 수동 변경 셀은 includeModified=true일 때만 다시 편성.
 * - DRAFT 월: 새 결과로 교체 (자동 편성과 동일한 의미).
 * - CONFIRMED 월 (프로젝트 오너 결정 "B안"): originalTeacherId는 확정 시점 교사로 유지하므로
 *   교사가 바뀐 셀은 노란색(↻)으로 표시되고 변경 이력이 남는다. 알림은 보내지 않는다.
 *   후보가 없으면 기존 배정을 비우지 않고 유지한 채 경고만 반환한다.
 */
export async function regenerateMonthPlan(
  year: number,
  month: number,
  grade: Grade,
  options: { from: string; to: string; includeModified: boolean },
  user: AuthenticatedUser,
): Promise<RegenerateResult> {
  const status = await getPlanStatus(year, month, grade);
  if (status === 'EMPTY') throw new ServiceError(409, `${month}월 ${grade}학년은 아직 편성되지 않았습니다. 자동 편성을 먼저 실행해주세요.`);
  if (status === 'CLOSED') throw new ServiceError(409, `${month}월 ${grade}학년은 마감되어 재편성할 수 없습니다.`);

  const { start, end } = monthBounds(year, month);
  const { from, to } = options;
  if (from < start || to > end || from > to) {
    throw new ServiceError(400, `재편성 기간은 ${start} ~ ${end} 범위에서 시작일 ≤ 종료일로 지정해주세요.`);
  }
  const dates = dateRange(from, to);
  const inScope = new Set(dates);

  const input = await loadSchedulerInput(year, month, [grade], dates);
  if (options.includeModified) {
    input.existingAssignments = input.existingAssignments.map((a) =>
      a.grade === grade && inScope.has(a.date) ? { ...a, isModified: false } : a,
    );
  }
  const result = generateSchedule(input);

  const existing = await prisma.assignment.findMany({ where: { grade, date: { in: dates } } });
  const existingByDate = new Map(existing.map((a) => [a.date, a]));
  const generated = result.assignments.filter((a) => a.source === 'GENERATED');
  const counts = { changedCount: 0, filledCount: 0, unchangedCount: 0, removedCount: 0 };
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const g of generated) {
      const current = existingByDate.get(g.date);
      if (!current) {
        const created = await tx.assignment.create({
          data: { date: g.date, grade, teacherId: g.teacherId, originalTeacherId: g.teacherId, rotationGroup: g.group },
        });
        if (status === 'CONFIRMED') {
          await tx.assignmentHistory.create({
            data: {
              assignmentId: created.id,
              fromTeacherId: null, // 미배정 → 교사
              toTeacherId: g.teacherId,
              changedById: user.id,
              changedByRole: user.isAdmin ? 'ADMIN' : 'GRADE_HEAD',
              note: '부분 재편성',
            },
          });
        }
        counts.filledCount++;
      } else if (current.teacherId === g.teacherId) {
        counts.unchangedCount++;
      } else if (status === 'DRAFT') {
        await tx.assignment.update({
          where: { id: current.id },
          data: { teacherId: g.teacherId, originalTeacherId: g.teacherId, isModified: false, modifiedAt: null },
        });
        counts.changedCount++;
      } else {
        await tx.assignment.update({
          where: { id: current.id },
          data: { teacherId: g.teacherId, isModified: g.teacherId !== current.originalTeacherId, modifiedAt: now },
        });
        await tx.assignmentHistory.create({
          data: {
            assignmentId: current.id,
            fromTeacherId: current.teacherId,
            toTeacherId: g.teacherId,
            changedById: user.id,
            changedByRole: user.isAdmin ? 'ADMIN' : 'GRADE_HEAD',
            note: '부분 재편성',
          },
        });
        counts.changedCount++;
      }
    }

    // 후보가 없는 셀: DRAFT는 비우고(미배정), CONFIRMED는 기존 배정을 유지한다.
    if (status === 'DRAFT') {
      const emptied = result.warnings.map((w) => existingByDate.get(w.date)).filter((a) => a !== undefined);
      const ids = emptied.map((a) => a.id);
      if (ids.length > 0) {
        await tx.assignmentHistory.deleteMany({ where: { assignmentId: { in: ids } } });
        await tx.notification.updateMany({ where: { assignmentId: { in: ids } }, data: { assignmentId: null } });
        await tx.assignment.deleteMany({ where: { id: { in: ids } } });
        counts.removedCount = ids.length;
      }
    }
  });

  await recordAudit(user.id, 'REGENERATE', {
    year,
    month,
    grade,
    from,
    to,
    includeModified: options.includeModified,
    ...counts,
    unassigned: result.warnings.length,
  });

  return {
    year,
    month,
    grade,
    from,
    to,
    status,
    ...counts,
    warnings: result.warnings.map((w) =>
      status === 'CONFIRMED' && existingByDate.has(w.date)
        ? { ...w, reasons: [...w.reasons, '→ 후보가 없어 기존 배정을 유지했습니다.'] }
        : w,
    ),
    fairness: result.fairness,
  };
}

/**
 * 편성 확정 (F4). DRAFT만 가능. originalTeacherId를 현재 교사로 기록하고
 * 해당 학년 배정 교사들에게 MONTH_CONFIRMED 알림을 보낸다.
 */
export async function confirmMonthPlan(year: number, month: number, grade: Grade, actorId: number) {
  const status = await getPlanStatus(year, month, grade);
  if (status !== 'DRAFT') {
    const label = status === 'EMPTY' ? '편성되지 않았습니다' : '이미 확정 또는 마감되었습니다';
    throw new ServiceError(409, `${month}월 ${grade}학년은 ${label}.`);
  }

  const { start, end } = monthBounds(year, month);
  const assignments = await prisma.assignment.findMany({ where: { grade, date: { gte: start, lte: end } } });

  const perTeacher = new Map<number, number>();
  for (const a of assignments) perTeacher.set(a.teacherId, (perTeacher.get(a.teacherId) ?? 0) + 1);

  await prisma.$transaction(async (tx) => {
    for (const a of assignments) {
      await tx.assignment.update({
        where: { id: a.id },
        data: { originalTeacherId: a.teacherId, isModified: false },
      });
    }
    await tx.monthPlan.update({
      where: { year_month_grade: { year, month, grade } },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: actorId },
    });
    await tx.notification.createMany({
      data: [...perTeacher].map(([teacherId, count]) => ({
        teacherId,
        type: 'MONTH_CONFIRMED',
        message: `${year}년 ${month}월 ${grade}학년 감독 편성이 확정되었습니다. (감독 ${count}회)`,
      })),
    });
  });

  await recordAudit(actorId, 'CONFIRM', { year, month, grade, assignments: assignments.length });
  return { year, month, grade, status: 'CONFIRMED' as const, assignmentCount: assignments.length };
}

/**
 * 감독 초기화 (학년 단위). 해당 월·학년의 배정을 모두 지우고 미편성(EMPTY)으로 되돌린다.
 * DRAFT·CONFIRMED만 가능하고 마감 월은 막는다. 배정 이력도 함께 지워지며(생성 편성과 동일),
 * 확정 월이면 배정되어 있던 교사들에게 알린다.
 */
export async function resetMonthPlan(year: number, month: number, grade: Grade, actorId: number) {
  const status = await getPlanStatus(year, month, grade);
  if (status === 'EMPTY') throw new ServiceError(409, `${month}월 ${grade}학년은 편성된 감독이 없습니다.`);
  if (status === 'CLOSED') throw new ServiceError(409, `${month}월 ${grade}학년은 마감되어 초기화할 수 없습니다.`);

  const { start, end } = monthBounds(year, month);
  const assignments = await prisma.assignment.findMany({
    where: { grade, date: { gte: start, lte: end } },
    select: { id: true, teacherId: true },
  });
  const ids = assignments.map((a) => a.id);
  const teacherIds = [...new Set(assignments.map((a) => a.teacherId))].filter((id) => id !== actorId);

  await prisma.$transaction(async (tx) => {
    if (ids.length > 0) {
      await tx.assignmentHistory.deleteMany({ where: { assignmentId: { in: ids } } });
      await tx.notification.updateMany({ where: { assignmentId: { in: ids } }, data: { assignmentId: null } });
      await tx.assignment.deleteMany({ where: { id: { in: ids } } });
    }
    await tx.monthPlan.update({
      where: { year_month_grade: { year, month, grade } },
      data: { status: 'EMPTY', confirmedAt: null, confirmedById: null },
    });
    if (status === 'CONFIRMED' && teacherIds.length > 0) {
      await tx.notification.createMany({
        data: teacherIds.map((teacherId) => ({
          teacherId,
          type: 'MONTH_RESET',
          message: `${year}년 ${month}월 ${grade}학년 감독 편성이 초기화되었습니다. 다시 편성·확정되면 알려드립니다.`,
        })),
      });
    }
  });

  await recordAudit(actorId, 'RESET', { year, month, grade, previousStatus: status, removed: ids.length });
  return { year, month, grade, status: 'EMPTY' as const, removedCount: ids.length };
}

/**
 * 마감 해제 (F8). ADMIN 전용이며 본인 PIN을 다시 확인한다. CONFIRMED로 되돌린다.
 * 월 마감 기능은 오너 결정으로 없앴다. 예전에 마감된 월을 되돌릴 수 있도록 해제만 남긴다.
 */
export async function reopenMonthPlan(year: number, month: number, grade: Grade, actorId: number, pin: string) {
  const actor = await prisma.teacher.findUniqueOrThrow({ where: { id: actorId } });
  if (!(await verifyPin(pin, actor.pinHash))) {
    throw new ServiceError(401, 'PIN이 올바르지 않습니다.');
  }
  const status = await getPlanStatus(year, month, grade);
  if (status !== 'CLOSED') throw new ServiceError(409, `${month}월 ${grade}학년은 마감 상태가 아닙니다.`);

  await prisma.monthPlan.update({
    where: { year_month_grade: { year, month, grade } },
    data: { status: 'CONFIRMED', closedAt: null, closedById: null },
  });
  await recordAudit(actorId, 'REOPEN', { year, month, grade });
  return { year, month, grade, status: 'CONFIRMED' as const };
}

/**
 * 달력 데이터 (GET /api/months/:year/:month).
 * DRAFT 학년의 배정은 해당 학년부장·ADMIN에게만 내려주고, 그 외에는 "편성 중" 상태만 알려준다.
 */
export async function getMonthView(year: number, month: number, user: AuthenticatedUser) {
  const { start, end } = monthBounds(year, month);
  const [plans, specialDays, assignments] = await Promise.all([
    prisma.monthPlan.findMany({ where: { year, month } }),
    prisma.specialDay.findMany({ where: { date: { gte: start, lte: end } }, orderBy: { date: 'asc' } }),
    prisma.assignment.findMany({
      where: { date: { gte: start, lte: end } },
      include: { teacher: { select: { name: true } }, originalTeacher: { select: { name: true } } },
      orderBy: [{ date: 'asc' }, { grade: 'asc' }],
    }),
  ]);

  const grades = ([1, 2, 3] as const).map((grade) => {
    const status = (plans.find((p) => p.grade === grade)?.status as MonthPlanStatus | undefined) ?? 'EMPTY';
    const assignmentsVisible = status !== 'DRAFT' || user.gradeHeadOf.includes(grade);
    return { grade, status, assignmentsVisible };
  });
  const visibleGrades = new Set(grades.filter((g) => g.assignmentsVisible).map((g) => g.grade));

  const visible = assignments.filter((a) => visibleGrades.has(a.grade as Grade));
  // 특별 일정은 학년 단위: days는 한 학년이라도 운영하는 날, 학년별 운영일은 따로 계산한다.
  const afterSchoolRows = await afterSchoolDaysBetween(start, end);
  // 편성 제외 = 특별 일정 + 방과후 운영일에 지정되지 않은 학년
  const exclusions = gradeExclusions(specialDays, afterSchoolRows);
  const days = operatingDays(year, month, exclusions);
  const excluded = excludedGradesByDate(exclusions);
  const operatingGradesOf = (date: string) => [1, 2, 3].filter((g) => !excluded.get(date)?.has(g));

  // 편성된(미편성 아님) 학년에서 그 학년의 운영일인데 배정이 없는 셀 = 미배정. 사유는 규칙을 다시 평가해 구한다.
  const assigned = new Set(visible.map((a) => `${a.date}:${a.grade}`));
  const unassignedCells = grades
    .filter((g) => g.status !== 'EMPTY' && g.assignmentsVisible)
    .flatMap((g) =>
      operatingDays(year, month, exclusions, g.grade)
        .filter((d) => !assigned.has(`${d}:${g.grade}`))
        .map((date) => ({ date, grade: g.grade })),
    );
  const teachersForReasons = unassignedCells.length > 0 ? await loadSchedulerTeachers(start, end) : [];
  const afterSchool = new Set(afterSchoolRows.map((d) => `${d.date}:${d.grade}`));
  const afterSchoolGrades = new Map<string, number[]>();
  for (const d of afterSchoolRows) afterSchoolGrades.set(d.date, [...(afterSchoolGrades.get(d.date) ?? []), d.grade]);
  const unassigned = unassignedCells.map(({ date, grade }) => {
    const weekday = weekdayOf(date);
    const dayAssignments = new Map(
      assignments.filter((a) => a.date === date).map((a) => [a.grade, a.teacherId] as [number, number]),
    );
    const ctx = {
      date,
      weekday,
      grade,
      group: rotationGroupForWeekday(weekday),
      dayAssignments,
      afterSchoolDay: afterSchool.has(`${date}:${grade}`),
    };
    return { date, grade, reasons: unassignedReasons(teachersForReasons, ctx) };
  });

  // 변경 툴팁용: 배정별 최종 변경 이력
  const histories = await prisma.assignmentHistory.findMany({
    where: { assignmentId: { in: visible.map((a) => a.id) } },
    include: { changedBy: { select: { name: true } } },
    orderBy: { changedAt: 'asc' },
  });
  const lastChangeOf = new Map(
    histories.map((h) => [h.assignmentId, { changedAt: h.changedAt, changedByName: h.changedBy.name, note: h.note }]),
  );

  return {
    year,
    month,
    grades,
    operatingDays: days.map((date) => ({
      date,
      weekday: weekdayOf(date),
      group: rotationGroupForWeekday(weekdayOf(date)),
      /** 이 날 편성하는 학년 (특별 일정으로 제외된 학년 빠짐) */
      grades: operatingGradesOf(date),
    })),
    specialDays: specialDays.map((d) => ({ date: d.date, grade: d.grade, type: d.type, title: d.title })),
    /** 방과후 운영일 (달력 표시용): 날짜별 적용 학년 */
    afterSchoolDays: [...afterSchoolGrades].map(([date, grades]) => ({ date, grades })),
    assignments: visible.map((a) => ({
      id: a.id,
      date: a.date,
      grade: a.grade,
      teacherId: a.teacherId,
      teacherName: a.teacher.name,
      originalTeacherId: a.originalTeacherId,
      originalTeacherName: a.originalTeacher.name,
      rotationGroup: a.rotationGroup,
      isModified: a.isModified,
      modifiedAt: a.modifiedAt,
      lastChange: lastChangeOf.get(a.id) ?? null,
    })),
    unassigned,
  };
}

export interface RotationStatus {
  grade: Grade;
  group: RotationGroup;
  /** 현재 순환 순서 (그 그룹을 맡을 수 있는 활성 교사만, 순번 순) */
  order: { teacherId: number; name: string }[];
  /** 마지막 확정·마감 감독 (순환 포인터). 없으면 null → 순번 첫 교사부터 */
  last: { teacherId: number; name: string; date: string } | null;
  /** 다음 자동 편성이 시작할 교사 (그날 불가하면 엔진이 다음 교사로 넘어간다) */
  next: { teacherId: number; name: string } | null;
}

/**
 * 학년·그룹별 순환 현황 (교사 관리 화면 표시용). 다음 시작 교사는 엔진과 같은 규칙으로 계산한다:
 * 마지막 확정·마감 배정 교사(포인터)의 다음 순번부터, 그 그룹을 맡을 수 있는 활성 교사.
 * 포인터 교사가 순서에 없으면 순번 첫 교사부터.
 */
export async function getRotationStatus(): Promise<RotationStatus[]> {
  const [teachers, confirmedPlans] = await Promise.all([
    prisma.teacher.findMany({ include: { teacherGrades: true } }),
    prisma.monthPlan.findMany({ where: { status: { in: CONFIRMED_STATUSES } } }),
  ]);
  const confirmedKeys = new Set(confirmedPlans.map((p) => `${p.year}-${p.month}-${p.grade}`));
  const nameOf = new Map(teachers.map((t) => [t.id, t.name]));

  const result: RotationStatus[] = [];
  for (const grade of [1, 2, 3] as const) {
    for (const group of ['WEEKDAY', 'FRIDAY'] as const) {
      // 엔진의 순환 순서: 그 학년 행이 있는 모든 교사, 순번 → id 순
      const full = teachers
        .flatMap((t) => t.teacherGrades.filter((g) => g.grade === grade).map((g) => ({ t, g })))
        .sort(
          (a, b) =>
            (group === 'FRIDAY' ? a.g.fridayOrder - b.g.fridayOrder : a.g.weekdayOrder - b.g.weekdayOrder) || a.t.id - b.t.id,
        );
      const eligible = (x: (typeof full)[number]) => x.t.active && (group === 'FRIDAY' ? x.g.canFriday : x.g.canWeekday);

      // 마지막 확정·마감 배정 (해당 학년·그룹)
      const rows = await prisma.assignment.findMany({
        where: { grade, rotationGroup: group },
        orderBy: { date: 'desc' },
        select: { date: true, teacherId: true },
      });
      const lastRow = rows.find((a) => {
        const [y, m] = a.date.split('-').map(Number);
        return confirmedKeys.has(`${y}-${m}-${grade}`);
      });

      const pointerIdx = lastRow ? full.findIndex((x) => x.t.id === lastRow.teacherId) : -1;
      let next: RotationStatus['next'] = null;
      for (let k = 1; k <= full.length; k++) {
        const x = full[(pointerIdx + k + full.length) % full.length];
        if (eligible(x)) {
          next = { teacherId: x.t.id, name: x.t.name };
          break;
        }
      }

      result.push({
        grade,
        group,
        order: full.filter(eligible).map((x) => ({ teacherId: x.t.id, name: x.t.name })),
        last: lastRow ? { teacherId: lastRow.teacherId, name: nameOf.get(lastRow.teacherId) ?? '?', date: lastRow.date } : null,
        next,
      });
    }
  }
  return result;
}
