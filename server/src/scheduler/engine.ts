import { weekdayOf } from '../lib/dateUtils.js';
import { rotationGroupForWeekday, type Grade, type RotationGroup } from '../lib/enums.js';
import { computeFairness } from './fairness.js';
import { excludedGradesByDate, gradeExclusions, operatingDays } from './operatingDays.js';
import { DEFAULT_HARD_RULES, firstViolation, gradeEligibility } from './rules.js';
import { selectTeacher } from './selection.js';
import type {
  HardRule,
  PlannedAssignment,
  ScheduleContext,
  SchedulerInput,
  SchedulerResult,
  SchedulerTeacher,
  SchedulerWarning,
} from './types.js';

const countKey = (teacherId: number, grade: Grade, group: RotationGroup) => `${teacherId}:${grade}:${group}`;
const queueKey = (grade: Grade, group: RotationGroup) => `${grade}:${group}`;

/** 학년·그룹별 순환 순서 (weekdayOrder/fridayOrder 오름차순, 동률은 id순). */
function buildRotationOrders(teachers: SchedulerTeacher[]): Map<string, number[]> {
  const orders = new Map<string, number[]>();
  for (const grade of [1, 2, 3] as const) {
    for (const group of ['WEEKDAY', 'FRIDAY'] as const) {
      const rows = teachers
        .flatMap((t) => t.grades.filter((g) => g.grade === grade).map((g) => ({ id: t.id, g })))
        .map(({ id, g }) => ({ id, order: group === 'FRIDAY' ? g.fridayOrder : g.weekdayOrder }))
        .sort((a, b) => a.order - b.order || a.id - b.id);
      orders.set(queueKey(grade, group), rows.map((r) => r.id));
    }
  }
  return orders;
}

/**
 * 자동 편성 (6장). 순수 함수: 입력 → 배정 결과 + 경고 + 공정성 요약.
 * - 대상이 아닌 학년의 기존 배정은 고정값으로 OnePerDay에 반영한다 (6.4-0).
 * - 대상 학년 중 수동 변경·부분 재편성 범위 밖의 셀은 유지하고 누계에 포함한다 (6.4-3).
 */
export function generateSchedule(input: SchedulerInput, rules: HardRule[] = DEFAULT_HARD_RULES): SchedulerResult {
  const targets = new Set<Grade>(input.targetGrades);
  const scope = input.dates ? new Set(input.dates) : null;
  // 특별 일정은 학년 단위: days는 한 학년이라도 운영하는 날, 학년별 제외는 isOperating으로 판단한다.
  // 편성 제외 = 특별 일정 + 방과후 운영일에 지정되지 않은 학년 (그날 자습 없음)
  const exclusions = gradeExclusions(input.specialDays, input.afterSchoolDays);
  const days = operatingDays(input.year, input.month, exclusions);
  const excluded = excludedGradesByDate(exclusions);
  const operating = new Set(days);
  const isOperating = (date: string, grade: number) => operating.has(date) && !excluded.get(date)?.has(grade);
  const afterSchoolCells = new Set(input.afterSchoolDays.map((d) => `${d.date}:${d.grade}`));
  const rotationOrders = buildRotationOrders(input.teachers);

  const counts = new Map<string, number>();
  for (const c of input.priorCounts) {
    const key = countKey(c.teacherId, c.grade, c.group);
    counts.set(key, (counts.get(key) ?? 0) + c.count);
  }
  const priorCountOf = (teacherId: number, grade: Grade, group: RotationGroup) =>
    input.priorCounts
      .filter((c) => c.teacherId === teacherId && c.grade === grade && c.group === group)
      .reduce((sum, c) => sum + c.count, 0);

  const pointers = new Map<string, number>();
  for (const p of input.startPointers) pointers.set(queueKey(p.grade, p.group), p.teacherId);

  // 날짜별 고정 배정 (대상 외 학년 + 대상 학년 중 유지 셀)
  const fixedByDate = new Map<string, Map<Grade, number>>();
  const kept: PlannedAssignment[] = [];
  for (const a of input.existingAssignments) {
    if (!isOperating(a.date, a.grade)) continue;
    const isTarget = targets.has(a.grade);
    const keep = !isTarget || a.isModified || (scope !== null && !scope.has(a.date));
    if (!keep) continue;

    if (!fixedByDate.has(a.date)) fixedByDate.set(a.date, new Map());
    fixedByDate.get(a.date)!.set(a.grade, a.teacherId);

    if (isTarget) {
      const group = rotationGroupForWeekday(weekdayOf(a.date));
      kept.push({ date: a.date, grade: a.grade, teacherId: a.teacherId, group, source: 'KEPT' });
      const key = countKey(a.teacherId, a.grade, group);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const assignments: PlannedAssignment[] = [...kept];
  const warnings: SchedulerWarning[] = [];
  let previousDayTeachers = new Set<number>();

  for (const date of days) {
    const weekday = weekdayOf(date);
    const group = rotationGroupForWeekday(weekday);
    const dayAssignments = new Map<number, number>(fixedByDate.get(date) ?? []);

    const inScope = scope === null || scope.has(date);
    const remaining = new Set<Grade>(
      inScope ? input.targetGrades.filter((g) => isOperating(date, g) && !dayAssignments.has(g)) : [],
    );

    while (remaining.size > 0) {
      // 후보 수가 적은 학년부터 (6.4-2). 배정할 때마다 다시 계산한다.
      let chosen: { grade: Grade; ctx: ScheduleContext; candidates: SchedulerTeacher[] } | null = null;
      for (const grade of [...remaining].sort((a, b) => a - b)) {
        const afterSchoolDay = afterSchoolCells.has(`${date}:${grade}`);
        const ctx: ScheduleContext = { date, weekday, grade, group, dayAssignments, afterSchoolDay };
        const candidates = input.teachers.filter((t) => firstViolation(t, ctx, rules) === null);
        if (chosen === null || candidates.length < chosen.candidates.length) {
          chosen = { grade, ctx, candidates };
        }
      }
      const { grade, ctx, candidates } = chosen!;
      remaining.delete(grade);

      const qKey = queueKey(grade, group);
      const selected = selectTeacher({
        candidates,
        rotationOrder: rotationOrders.get(qKey) ?? [],
        pointer: pointers.get(qKey) ?? null,
        countOf: (teacherId) => counts.get(countKey(teacherId, grade, group)) ?? 0,
        deprioritized: input.options?.avoidPreviousDay ? previousDayTeachers : undefined,
      });

      if (!selected) {
        warnings.push({ date, grade, reasons: unassignedReasons(input.teachers, ctx, rules) });
        continue;
      }

      assignments.push({ date, grade, teacherId: selected.id, group, source: 'GENERATED' });
      dayAssignments.set(grade, selected.id);
      const cKey = countKey(selected.id, grade, group);
      counts.set(cKey, (counts.get(cKey) ?? 0) + 1);
      pointers.set(qKey, selected.id);
    }

    previousDayTeachers = new Set(dayAssignments.values());
  }

  assignments.sort((a, b) => a.date.localeCompare(b.date) || a.grade - b.grade);
  const fairness = computeFairness(input.targetGrades, input.teachers, assignments, priorCountOf);
  return { assignments, warnings, fairness };
}

/** 미배정 사유: 해당 학년에 등록된 활성 교사별 제외 사유. */
export function unassignedReasons(
  teachers: SchedulerTeacher[],
  ctx: ScheduleContext,
  rules: HardRule[] = DEFAULT_HARD_RULES,
): string[] {
  const registered = teachers.filter((t) => t.active && gradeEligibility.check(t, ctx).ok);
  if (registered.length === 0) return [`${ctx.grade}학년 감독 가능 교사가 없습니다.`];
  return registered.map((t) => `${t.name}: ${firstViolation(t, ctx, rules) ?? '알 수 없음'}`);
}
