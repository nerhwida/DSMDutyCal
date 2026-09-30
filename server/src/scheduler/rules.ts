import type { HardRule, RuleResult, ScheduleContext, SchedulerTeacher } from './types.js';

const OK: RuleResult = { ok: true };

/** 비활성 교사 제외. */
export const activeOnly: HardRule = {
  id: 'ActiveOnly',
  check: (teacher) => (teacher.active ? OK : { ok: false, reason: '비활성 교사' }),
};

/** 해당 학년 감독 가능 교사만. */
export const gradeEligibility: HardRule = {
  id: 'GradeEligibility',
  check: (teacher, ctx) =>
    teacher.grades.some((g) => g.grade === ctx.grade) ? OK : { ok: false, reason: '해당 학년 미지정' },
};

/** 금요일은 canFriday, 월~목은 canWeekday. */
export const fridayEligibility: HardRule = {
  id: 'FridayEligibility',
  check: (teacher, ctx) => {
    const tg = teacher.grades.find((g) => g.grade === ctx.grade);
    if (!tg) return OK; // 학년 미지정은 GradeEligibility가 판단한다.
    if (ctx.group === 'FRIDAY') {
      return tg.canFriday ? OK : { ok: false, reason: '금요일 감독 제외' };
    }
    return tg.canWeekday ? OK : { ok: false, reason: '월~목 감독 제외' };
  },
};

/**
 * 요일 제외.
 * - 방과후 수업(AFTER_SCHOOL): 그 요일이면서 **방과후 운영일**인 날에만 제외 (시험 기간 등 운영하지 않는 날은 감독 가능)
 * - 기타(OTHER): 그 요일이면 항상 제외
 */
export const weekdayExclusion: HardRule = {
  id: 'WeekdayExclusion',
  check: (teacher, ctx) => {
    const ex = teacher.weekdayExclusions.find((e) => e.weekday === ctx.weekday);
    if (!ex) return OK;
    if (ex.reason === 'AFTER_SCHOOL') return ctx.afterSchoolDay ? { ok: false, reason: '방과후 수업' } : OK;
    return { ok: false, reason: '요일 제외' };
  },
};

/** 감독 불가일. */
export const unavailableDate: HardRule = {
  id: 'UnavailableDate',
  check: (teacher, ctx) => {
    const u = teacher.unavailableDates.find((d) => d.date === ctx.date);
    return u ? { ok: false, reason: `감독 불가일(${u.reason})` } : OK;
  },
};

/** 같은 날 다른 학년에 이미 배정된 교사 제외. */
export const onePerDay: HardRule = {
  id: 'OnePerDay',
  check: (teacher, ctx) => {
    for (const [grade, teacherId] of ctx.dayAssignments) {
      if (grade !== ctx.grade && teacherId === teacher.id) {
        return { ok: false, reason: `같은 날 ${grade}학년 감독 중` };
      }
    }
    return OK;
  },
};

/** 기본 Hard Rule 목록. 새 제약은 여기에 규칙을 추가하는 것으로 확장한다. */
export const DEFAULT_HARD_RULES: HardRule[] = [
  activeOnly,
  gradeEligibility,
  fridayEligibility,
  weekdayExclusion,
  unavailableDate,
  onePerDay,
];

/** 걸리는 모든 규칙을 반환한다 (교체 경고·관리 변경 팝오버용). */
export function allViolations(
  teacher: SchedulerTeacher,
  ctx: ScheduleContext,
  rules: HardRule[] = DEFAULT_HARD_RULES,
): { ruleId: string; reason: string }[] {
  const violations: { ruleId: string; reason: string }[] = [];
  for (const rule of rules) {
    const result = rule.check(teacher, ctx);
    if (!result.ok) violations.push({ ruleId: rule.id, reason: result.reason });
  }
  return violations;
}

/**
 * F1-2: 본인 감독 교체에서 차단하는 규칙. 나머지 규칙(방과후·불가일·학년 미지정 등)은 경고만 한다.
 * (비활성 교사는 "전체 활성 교사" 대상 조건에 따라 차단)
 */
export const BLOCKING_RULE_IDS = new Set([onePerDay.id, activeOnly.id]);

/** 첫 번째로 걸리는 규칙의 사유를 반환한다. 모두 통과하면 null. */
export function firstViolation(
  teacher: SchedulerTeacher,
  ctx: ScheduleContext,
  rules: HardRule[] = DEFAULT_HARD_RULES,
): string | null {
  for (const rule of rules) {
    const result = rule.check(teacher, ctx);
    if (!result.ok) return result.reason;
  }
  return null;
}
