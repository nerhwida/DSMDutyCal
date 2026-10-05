import { prisma } from '../lib/prisma.js';
import type { Grade, MonthPlanStatus, RotationGroup } from '../lib/enums.js';
import type { AuthenticatedUser } from '../auth/authService.js';
import { monthBounds } from '../scheduler/index.js';

const GRADES = [1, 2, 3] as const;
const GROUPS = ['WEEKDAY', 'FRIDAY'] as const;
const key = (grade: number, group: string) => `${grade}:${group}`;

type Counter = Map<number, Map<string, number>>; // teacherId → '학년:그룹' → 횟수

function add(counter: Counter, teacherId: number, grade: number, group: string, n = 1) {
  if (!counter.has(teacherId)) counter.set(teacherId, new Map());
  const m = counter.get(teacherId)!;
  m.set(key(grade, group), (m.get(key(grade, group)) ?? 0) + n);
}
const get = (counter: Counter, teacherId: number, grade: number, group: string) =>
  counter.get(teacherId)?.get(key(grade, group)) ?? 0;

/**
 * 기간 집계 공통 로직.
 * - period: [start, end] 기간의 배정 수. CONFIRMED/CLOSED만 세고, includeVisibleDraft면 조회 권한이 있는
 *   DRAFT 학년도 포함한다 (달력 현황 패널용).
 * - totals(누계): InitialCount + end까지의 CONFIRMED/CLOSED 배정 수.
 * 모두 **실제 배정**(현재 teacherId, 해당 셀의 학년·그룹) 기준이다.
 */
async function aggregate(start: string, end: string, user: AuthenticatedUser, includeVisibleDraft: boolean) {
  const [teachers, plans, initialCounts, upToEnd, exclusions] = await Promise.all([
    prisma.teacher.findMany({ include: { teacherGrades: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.monthPlan.findMany(),
    prisma.initialCount.findMany(),
    prisma.assignment.findMany({ where: { date: { lte: end } } }),
    prisma.teacherStatsExclusion.findMany(),
  ]);

  // 통계 제외 월: 교사 → 'YYYY-MM' 집합 (기간 안의 것만)
  const excludedMonths = new Map<number, Set<string>>();
  for (const e of exclusions) {
    const ym = monthKey(e.year, e.month);
    if (ym < start.slice(0, 7) || ym > end.slice(0, 7)) continue;
    if (!excludedMonths.has(e.teacherId)) excludedMonths.set(e.teacherId, new Set());
    excludedMonths.get(e.teacherId)!.add(ym);
  }

  const statusOf = new Map(plans.map((p) => [`${p.year}-${p.month}-${p.grade}`, p.status as MonthPlanStatus]));
  const planStatus = (date: string, grade: number) => {
    const [y, m] = date.split('-').map(Number);
    return statusOf.get(`${y}-${m}-${grade}`) ?? 'EMPTY';
  };

  const period: Counter = new Map();
  const totals: Counter = new Map();
  const initial: Counter = new Map();
  // 월별 확정·마감 배정 수 ('YYYY-MM' → Counter). 현황 패널의 총횟수 마우스 오버용.
  const monthly = new Map<string, Counter>();
  for (const c of initialCounts) {
    add(totals, c.teacherId, c.grade, c.rotationGroup, c.count);
    add(initial, c.teacherId, c.grade, c.rotationGroup, c.count);
  }
  for (const a of upToEnd) {
    const status = planStatus(a.date, a.grade);
    const confirmed = status === 'CONFIRMED' || status === 'CLOSED';
    if (confirmed) {
      add(totals, a.teacherId, a.grade, a.rotationGroup);
      const ym = a.date.slice(0, 7);
      if (!monthly.has(ym)) monthly.set(ym, new Map());
      add(monthly.get(ym)!, a.teacherId, a.grade, a.rotationGroup);
    }
    const countable = confirmed || (includeVisibleDraft && status === 'DRAFT' && user.gradeHeadOf.includes(a.grade));
    if (a.date >= start && countable) add(period, a.teacherId, a.grade, a.rotationGroup);
  }

  const eligible = (grade: number, group: RotationGroup) =>
    teachers.filter(
      (t) =>
        t.active && t.teacherGrades.some((g) => g.grade === grade && (group === 'FRIDAY' ? g.canFriday : g.canWeekday)),
    );

  return { teachers, period, totals, initial, monthly, eligible, excludedMonths };
}

const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

/** [start, end] 기간의 'YYYY-MM' 목록. */
function monthsBetween(start: string, end: string): string[] {
  const months: string[] = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(monthKey(y, m));
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return months;
}

function gradeGroupRecord(counter: Counter, teacherId: number) {
  const record: Record<string, number> = {};
  for (const grade of GRADES) for (const group of GROUPS) record[key(grade, group)] = get(counter, teacherId, grade, group);
  return record;
}

function sumBy(counter: Counter, teacherId: number, filter: (grade: number, group: string) => boolean) {
  let n = 0;
  for (const grade of GRADES) for (const group of GROUPS) if (filter(grade, group)) n += get(counter, teacherId, grade, group);
  return n;
}

function deviation(counts: number[]) {
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  return { max, min, deviation: max - min, warning: max - min >= 2 };
}

/**
 * 현황 패널 (F7 요약, 월 단위). 달력에서 보이는 것과 같도록 DRAFT는 조회 권한자에게만 이번 달 수에 포함한다.
 */
export async function getMonthStats(year: number, month: number, user: AuthenticatedUser) {
  const { start, end } = monthBounds(year, month);
  const { teachers, period, totals, initial, monthly, eligible, excludedMonths } = await aggregate(start, end, user, true);
  const months = [...monthly.keys()].sort();
  // 이 달 통계 제외 교사는 목록·공정성 지표에서 뺀다
  const excluded = (teacherId: number) => excludedMonths.has(teacherId);

  const rows = teachers
    .filter((t) => (t.active || period.has(t.id)) && !excluded(t.id))
    .map((t) => {
      const month = { 1: 0, 2: 0, 3: 0 } as Record<Grade, number>;
      for (const g of GRADES) month[g] = sumBy(period, t.id, (grade) => grade === g);
      const weekdayTotal = sumBy(totals, t.id, (_g, group) => group === 'WEEKDAY');
      const fridayTotal = sumBy(totals, t.id, (_g, group) => group === 'FRIDAY');
      return {
        teacherId: t.id,
        name: t.name,
        active: t.active,
        /** 감독 가능 학년 (현황 패널에서 학년별로 묶을 때 사용) */
        grades: t.teacherGrades
          .filter((g) => g.canWeekday || g.canFriday)
          .map((g) => g.grade)
          .sort((a, b) => a - b),
        month,
        monthTotal: month[1] + month[2] + month[3],
        weekdayTotal,
        fridayTotal,
        total: weekdayTotal + fridayTotal,
        byGradeGroup: gradeGroupRecord(totals, t.id),
        /** 이번 달 학년·그룹별 횟수 (이번달 금요일 횟수 표시용) */
        monthByGradeGroup: gradeGroupRecord(period, t.id),
        /** 초기 누계 (학년·그룹별) */
        initialByGradeGroup: gradeGroupRecord(initial, t.id),
        /** 월별 확정·마감 횟수 (배정이 있는 달만, 오래된 순) — 총횟수 마우스 오버용 */
        monthly: months
          .filter((ym) => monthly.get(ym)!.has(t.id))
          .map((ym) => ({ month: ym, byGradeGroup: gradeGroupRecord(monthly.get(ym)!, t.id) })),
      };
    });

  const fairness = GRADES.flatMap((grade) =>
    GROUPS.map((group: RotationGroup) => {
      const pool = eligible(grade, group).filter((t) => !excluded(t.id));
      if (pool.length === 0) return null;
      return { grade: grade as Grade, group, ...deviation(pool.map((t) => get(totals, t.id, grade, group))) };
    }),
  ).filter((f) => f !== null);

  return { year, month, rows, fairness };
}

/**
 * 기간 통계 (F7). [fromYm, toYm] 월 범위의 확정·마감 배정만 집계한다 (DRAFT 제외).
 * 누계는 기간 끝(toYm 말일)까지의 InitialCount + 확정·마감 배정 수.
 */
export async function getRangeStats(
  fromYm: { year: number; month: number },
  toYm: { year: number; month: number },
  user: AuthenticatedUser,
) {
  const start = monthBounds(fromYm.year, fromYm.month).start;
  const end = monthBounds(toYm.year, toYm.month).end;
  const { teachers, period, totals, eligible, excludedMonths } = await aggregate(start, end, user, false);
  // 통계 제외: 기간의 모든 달이 제외면 목록에서 숨기고, 한 달이라도 제외면 공정성 지표에서 뺀다
  const monthCount = monthsBetween(start, end).length;
  const excludedAll = (teacherId: number) => (excludedMonths.get(teacherId)?.size ?? 0) >= monthCount;
  const excludedAny = (teacherId: number) => excludedMonths.has(teacherId);

  const rows = teachers
    .filter((t) => (t.active || period.has(t.id)) && !excludedAll(t.id))
    .map((t) => {
      const periodWeekday = sumBy(period, t.id, (_g, group) => group === 'WEEKDAY');
      const periodFriday = sumBy(period, t.id, (_g, group) => group === 'FRIDAY');
      const weekdayTotal = sumBy(totals, t.id, (_g, group) => group === 'WEEKDAY');
      const fridayTotal = sumBy(totals, t.id, (_g, group) => group === 'FRIDAY');
      return {
        teacherId: t.id,
        name: t.name,
        active: t.active,
        period: gradeGroupRecord(period, t.id),
        periodTotal: periodWeekday + periodFriday,
        periodWeekday,
        periodFriday,
        total: gradeGroupRecord(totals, t.id),
        weekdayTotal,
        fridayTotal,
        grandTotal: weekdayTotal + fridayTotal,
        /** 기간 중 통계 제외 월 ('YYYY-MM') */
        excludedMonths: [...(excludedMonths.get(t.id) ?? [])].sort(),
      };
    });

  const fairness = GRADES.flatMap((grade) =>
    GROUPS.map((group: RotationGroup) => {
      const pool = eligible(grade, group).filter((t) => !excludedAny(t.id));
      if (pool.length === 0) return null;
      return {
        grade: grade as Grade,
        group,
        period: deviation(pool.map((t) => get(period, t.id, grade, group))),
        total: deviation(pool.map((t) => get(totals, t.id, grade, group))),
      };
    }),
  ).filter((f) => f !== null);

  return { from: start, to: end, rows, fairness };
}
