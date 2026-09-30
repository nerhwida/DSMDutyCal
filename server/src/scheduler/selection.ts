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
 * 후보 1명을 선택한다. **순번 우선** (프로젝트 오너 결정, 2026-09-30):
 * 교사 관리에서 드래그로 정한 순환 순서를 그대로 따르고, 자동 편성은 그 순서를 채워 주는 편의 기능이다.
 * 1) (옵션) 직전 운영일 감독자는 후순위
 * 2) 순환 포인터 다음 순번에 가장 가까운 교사 (불가 교사는 후보에서 이미 빠져 있으므로 건너뛴다)
 * 3) 누계가 적은 교사 (순번에 없는 교사끼리 비교할 때만 의미가 있다)
 * 2번은 전순서이므로 옵션을 "2번 다음"에 두면 의미가 없어, 옵션은 순번보다 앞에 적용한다.
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
      a.penalty - b.penalty || a.distance - b.distance || a.count - b.count || a.teacher.id - b.teacher.id,
  );
  return keyed[0].teacher;
}
