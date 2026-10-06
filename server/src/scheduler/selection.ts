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
  /** 밀린 차례: 자기 순번에 감독할 수 없어 건너뛴 교사 (건너뛴 순서). 가능해지면 순번보다 먼저 배정한다. */
  owed?: number[];
}

/**
 * 후보 1명을 선택한다. **순번 우선** (프로젝트 오너 결정, 2026-09-30):
 * 교사 관리에서 드래그로 정한 순환 순서를 그대로 따르고, 자동 편성은 그 순서를 채워 주는 편의 기능이다.
 * 1) (옵션) 직전 운영일 감독자는 후순위
 * 2) 밀린 차례가 있는 교사 (먼저 밀린 교사부터) — 예: 박→이→전→정에서 이가 방과후로 빠져 전이 맡았으면 다음은 이
 * 3) 순환 포인터 다음 순번에 가장 가까운 교사 (불가 교사는 후보에서 이미 빠져 있으므로 건너뛴다)
 * 4) 누계가 적은 교사 (순번에 없는 교사끼리 비교할 때만 의미가 있다)
 * 3번은 전순서이므로 옵션을 "3번 다음"에 두면 의미가 없어, 옵션은 순번보다 앞에 적용한다.
 */
export function selectTeacher(input: SelectionInput): SchedulerTeacher | null {
  const { candidates, rotationOrder, pointer, countOf, deprioritized, owed = [] } = input;
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
    owedRank: owed.includes(t.id) ? owed.indexOf(t.id) : Number.MAX_SAFE_INTEGER,
    distance: distance(t.id),
  }));
  keyed.sort(
    (a, b) =>
      a.penalty - b.penalty ||
      a.owedRank - b.owedRank ||
      a.distance - b.distance ||
      a.count - b.count ||
      a.teacher.id - b.teacher.id,
  );
  return keyed[0].teacher;
}

/**
 * 선택 후 순환 상태 갱신.
 * - 밀린 차례로 배정된 교사는 목록에서 빼고 포인터는 그대로 둔다.
 * - 순번대로 배정됐으면 포인터와 선택 교사 사이에서 건너뛴 교사를 밀린 차례에 추가하고 포인터를 옮긴다.
 */
export function advanceRotation(
  state: { pointer: number | null; owed: number[] },
  rotationOrder: number[],
  selectedId: number,
): { pointer: number | null; owed: number[] } {
  if (state.owed.includes(selectedId)) {
    return { pointer: state.pointer, owed: state.owed.filter((id) => id !== selectedId) };
  }
  const n = rotationOrder.length;
  const to = rotationOrder.indexOf(selectedId);
  if (to < 0) return state; // 순번에 없는 교사 (다른 학년 담당 등): 순환에 영향 없음
  const from = state.pointer === null ? -1 : rotationOrder.indexOf(state.pointer);
  const skipped: number[] = [];
  const steps = (to - from - 1 + n) % n;
  for (let k = 0; k < steps; k++) skipped.push(rotationOrder[(from + 1 + k + n) % n]);
  return { pointer: selectedId, owed: [...state.owed, ...skipped.filter((id) => !state.owed.includes(id))] };
}
