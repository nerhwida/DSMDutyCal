import { dateRange, weekdayOf } from '../lib/dateUtils.js';
import type { SpecialDayEntry } from './types.js';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 해당 월의 첫날·마지막 날 ('YYYY-MM-DD'). */
export function monthBounds(year: number, month: number): { start: string; end: string } {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(lastDay)}` };
}

/** 해당 월의 월~금 날짜. */
export function weekdaysOfMonth(year: number, month: number): string[] {
  const { start, end } = monthBounds(year, month);
  return dateRange(start, end).filter((date) => {
    const w = weekdayOf(date);
    return w >= 1 && w <= 5;
  });
}

/**
 * 방과후 운영일에서 파생되는 편성 제외 (날짜 × 학년). 방과후 운영일에는 지정한 학년만 자습 감독이 있고,
 * 지정하지 않은 학년은 그날 자습이 없어 편성하지 않는다. 예: 월요일 1학년 지정 → 그날 2·3학년 제외.
 */
export function afterSchoolExclusions(afterSchoolDays: Iterable<SpecialDayEntry>): SpecialDayEntry[] {
  const designated = new Map<string, Set<number>>();
  for (const d of afterSchoolDays) {
    if (!designated.has(d.date)) designated.set(d.date, new Set());
    designated.get(d.date)!.add(d.grade);
  }
  return [...designated].flatMap(([date, grades]) => [1, 2, 3].filter((g) => !grades.has(g)).map((grade) => ({ date, grade })));
}

/** 편성 제외 전체 = 특별 일정 + 방과후 운영일에 지정되지 않은 학년. */
export function gradeExclusions(
  specialDays: Iterable<SpecialDayEntry>,
  afterSchoolDays: Iterable<SpecialDayEntry>,
): SpecialDayEntry[] {
  return [...[...specialDays].map((d) => ({ date: d.date, grade: d.grade })), ...afterSchoolExclusions(afterSchoolDays)];
}

/** 날짜 → 특별 일정으로 편성이 제외된 학년 집합. */
export function excludedGradesByDate(specialDays: Iterable<SpecialDayEntry>): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const s of specialDays) {
    if (!map.has(s.date)) map.set(s.date, new Set());
    map.get(s.date)!.add(s.grade);
  }
  return map;
}

/**
 * 운영일 목록 (6.4-1: 월~금 − 특별 일정).
 * 특별 일정은 학년 단위이므로:
 * - grade를 주면 그 학년의 운영일
 * - 생략하면 한 학년이라도 운영하는 날
 */
export function operatingDays(
  year: number,
  month: number,
  specialDays: Iterable<SpecialDayEntry>,
  grade?: number,
): string[] {
  const excluded = excludedGradesByDate(specialDays);
  return weekdaysOfMonth(year, month).filter((date) => {
    const ex = excluded.get(date);
    if (!ex) return true;
    return grade === undefined ? ex.size < 3 : !ex.has(grade);
  });
}
