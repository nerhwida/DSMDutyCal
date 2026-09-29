import type { Grade, RotationGroup } from '../lib/enums.js';
import type { FairnessStat, PlannedAssignment, SchedulerTeacher } from './types.js';

/** 누계 편차가 이 값 이상이면 경고 (F4). */
export const FAIRNESS_WARNING_THRESHOLD = 2;

/**
 * 학년·그룹별 공정성 요약. 대상은 해당 학년·그룹 감독이 가능한 활성 교사.
 * (해당 그룹 감독 대상이 아닌 교사는 0회여도 편차 계산에서 제외한다.)
 */
export function computeFairness(
  grades: Grade[],
  teachers: SchedulerTeacher[],
  assignments: PlannedAssignment[],
  priorCountOf: (teacherId: number, grade: Grade, group: RotationGroup) => number,
): FairnessStat[] {
  const stats: FairnessStat[] = [];
  for (const grade of grades) {
    for (const group of ['WEEKDAY', 'FRIDAY'] as const) {
      const pool = teachers.filter((t) => {
        if (!t.active) return false;
        const tg = t.grades.find((g) => g.grade === grade);
        return tg !== undefined && (group === 'FRIDAY' ? tg.canFriday : tg.canWeekday);
      });
      if (pool.length === 0) continue;

      const monthCounts = pool.map(
        (t) => assignments.filter((a) => a.grade === grade && a.group === group && a.teacherId === t.id).length,
      );
      const totalCounts = pool.map((t, i) => monthCounts[i] + priorCountOf(t.id, grade, group));

      const monthMax = Math.max(...monthCounts);
      const monthMin = Math.min(...monthCounts);
      const totalMax = Math.max(...totalCounts);
      const totalMin = Math.min(...totalCounts);
      stats.push({
        grade,
        group,
        monthMax,
        monthMin,
        monthDeviation: monthMax - monthMin,
        totalMax,
        totalMin,
        totalDeviation: totalMax - totalMin,
        warning: totalMax - totalMin >= FAIRNESS_WARNING_THRESHOLD,
      });
    }
  }
  return stats;
}
