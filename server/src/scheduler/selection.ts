import type { SchedulerTeacher } from './types.js';

export interface SelectionInput {
  candidates: SchedulerTeacher[];
  /** 해당 학년·그룹의 순환 순서 (teacherId 배열, 앞이 먼저). */
  rotationOrder: number[];
  /** 순환 포인터 = 직전에 선택된 교사 id (없으면 null → 순번 첫 교사부터). */
  pointer: number | null;
  /** teacherId → 해당 학년·그룹 누계. */
  countOf: (teacherId: number) => number;
  /** 후순위로 둘 교사 (6.3-3 옵션: 직전 운영일 감독자). */
  deprioritized?: Set<number>;
}

/**
 * 6.3 Soft 기준으로 후보 1명을 선택한다.
 * 1) 누계가 가장 적은 교사
 * 2) (옵션) 직전 운영일 감독자는 후순위
 * 3) 순환 포인터 다음 순번에 가장 가까운 교사
 * 3번은 전순서이므로 옵션을 "3번 다음"에 두면 의미가 없어, 옵션은 누계 바로 다음에 적용한다.
 */
export function selectTeacher(input: SelectionInput): SchedulerTeacher | null {
  const { candidates, rotationOrder, pointer, countOf, deprioritized } = input;
  if (candidates.length === 0) return null;

  const n = rotationOrder.length;
  const pointerIdx = pointer === null ? -1 : rotationOrder.indexOf(pointer);
  const distance = (teacherId: number) => {
    const idx = rotationOrder.indexOf(teacherId);
    if (idx < 0) return Number.MAX_SAFE_INTEGER; // 순번에 없는 교사는 맨 뒤
    return (idx - pointerIdx - 1 + n) % n;
  };

  const keyed = candidates.map((t) => ({
    teacher: t,
    count: countOf(t.id),
    penalty: deprioritized?.has(t.id) ? 1 : 0,
    distance: distance(t.id),
  }));
  keyed.sort(
    (a, b) =>
      a.count - b.count || a.penalty - b.penalty || a.distance - b.distance || a.teacher.id - b.teacher.id,
  );
  return keyed[0].teacher;
}
