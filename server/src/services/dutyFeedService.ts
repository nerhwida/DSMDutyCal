import { prisma } from '../lib/prisma.js';
import { dateRange, weekdayOf } from '../lib/dateUtils.js';
import type { MonthPlanStatus } from '../lib/enums.js';
import { monthBounds } from '../scheduler/index.js';
import { afterSchoolDaysBetween } from './schedulerService.js';

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** 공개 대상 상태: 확정·마감만. DRAFT(미리보기)는 호출자와 무관하게 내보내지 않는다. */
const PUBLISHED: MonthPlanStatus[] = ['CONFIRMED', 'CLOSED'];

/** 외부에는 교사 이름만 내보낸다 (내부 id는 공개하지 않음). */
type DutyTeacher = { name: string } | null;

/**
 * 월별 감독표 배포용 JSON (외부 시스템 연동).
 * 해당 월의 모든 날짜를 포함하고, 운영일에만 학년별 감독 교사를 채운다.
 * - type: WEEKEND(주말) | SPECIAL(전 학년 특별 일정) | OPERATING(한 학년 이상 운영)
 * - specialDays: 그 날의 학년별 특별 일정 목록 (있을 때만). OPERATING 날의 제외 학년은 duty가 null.
 * - afterSchoolGrades: 방과후 운영일이면 그날 자습 감독이 있는 학년 (있을 때만). 나머지 학년은 duty가 null.
 */
export async function getDutyFeed(year: number, month: number) {
  const { start, end } = monthBounds(year, month);
  const [plans, specialDays, afterSchool, assignments] = await Promise.all([
    prisma.monthPlan.findMany({ where: { year, month } }),
    prisma.specialDay.findMany({ where: { date: { gte: start, lte: end } } }),
    afterSchoolDaysBetween(start, end),
    prisma.assignment.findMany({
      where: { date: { gte: start, lte: end } },
      include: { teacher: { select: { name: true } } },
    }),
  ]);

  const grades = ([1, 2, 3] as const).map((grade) => {
    const status = (plans.find((p) => p.grade === grade)?.status as MonthPlanStatus | undefined) ?? 'EMPTY';
    return { grade, status, published: PUBLISHED.includes(status) };
  });
  const published = new Set(grades.filter((g) => g.published).map((g) => g.grade as number));
  // 특별 일정은 학년 단위 (날짜 → [{grade, type, title}])
  const specialsByDate = new Map<string, { grade: number; type: string; title: string }[]>();
  for (const s of [...specialDays].sort((a, b) => a.grade - b.grade)) {
    if (!specialsByDate.has(s.date)) specialsByDate.set(s.date, []);
    specialsByDate.get(s.date)!.push({ grade: s.grade, type: s.type, title: s.title });
  }
  const afterSchoolByDate = new Map<string, number[]>();
  for (const d of afterSchool) afterSchoolByDate.set(d.date, [...(afterSchoolByDate.get(d.date) ?? []), d.grade]);
  const dutyByKey = new Map(
    assignments
      .filter((a) => published.has(a.grade))
      .map((a) => [`${a.date}:${a.grade}`, { name: a.teacher.name }]),
  );

  const days = dateRange(start, end).map((date) => {
    const w = weekdayOf(date);
    const specials = specialsByDate.get(date) ?? [];
    const afterSchoolGrades = afterSchoolByDate.get(date);
    const base = {
      date,
      weekday: WEEKDAY_KO[w],
      ...(specials.length > 0 && { specialDays: specials }),
      ...(afterSchoolGrades && w >= 1 && w <= 5 && { afterSchoolGrades }),
    };
    if (w === 0 || w === 6) return { ...base, type: 'WEEKEND' as const };
    // 전 학년이 특별 일정이면 SPECIAL, 일부 학년만이면 OPERATING이고 해당 학년 duty는 null
    const excluded = new Set(specials.map((s) => s.grade));
    if (excluded.size === 3) return { ...base, type: 'SPECIAL' as const };
    // 방과후 운영일에 지정되지 않은 학년은 그날 자습이 없다
    const noStudy = (g: number) => excluded.has(g) || (afterSchoolGrades !== undefined && !afterSchoolGrades.includes(g));
    const dutyOf = (g: number): DutyTeacher => (noStudy(g) ? null : (dutyByKey.get(`${date}:${g}`) ?? null));
    const duty: Record<'1' | '2' | '3', DutyTeacher> = { '1': dutyOf(1), '2': dutyOf(2), '3': dutyOf(3) };
    return { ...base, type: 'OPERATING' as const, duty };
  });

  // 학년별 공개 상태·생성 시각은 내보내지 않는다 (미공개 학년은 duty가 null인 것으로 충분)
  return { year, month, days };
}
