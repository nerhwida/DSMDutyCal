import { describe, expect, it } from 'vitest';
import { weekdayOf } from '../lib/dateUtils.js';
import type { Grade } from '../lib/enums.js';
import { generateSchedule } from './engine.js';
import { operatingDays } from './operatingDays.js';
import type { ExistingAssignment, SchedulerInput, SchedulerTeacher } from './types.js';

// 2026년 10월: 1일(목) 시작, 운영일(월~금) 22일, 금요일 5일(2·9·16·23·30).
const YEAR = 2026;
const MONTH = 10;

let nextId = 1;
function teacher(
  grades: Grade[],
  overrides: Partial<Omit<SchedulerTeacher, 'grades'>> & { canFriday?: boolean; canWeekday?: boolean } = {},
): SchedulerTeacher {
  const id = nextId++;
  const { canFriday = true, canWeekday = true, ...rest } = overrides;
  return {
    id,
    name: `교사${id}`,
    active: true,
    grades: grades.map((grade) => ({ grade, canWeekday, canFriday, weekdayOrder: id, fridayOrder: id })),
    weekdayExclusions: [],
    unavailableDates: [],
    ...rest,
  };
}

function baseInput(teachers: SchedulerTeacher[], overrides: Partial<SchedulerInput> = {}): SchedulerInput {
  return {
    year: YEAR,
    month: MONTH,
    targetGrades: [1, 2, 3],
    teachers,
    specialDays: [],
    afterSchoolDays: [],
    existingAssignments: [],
    priorCounts: [],
    startPointers: [],
    ...overrides,
  };
}

/** 전 학년 특별 일정 (날짜별 1·2·3학년 3건). */
const allGrades = (dates: string[]) => dates.flatMap((date) => [1, 2, 3].map((grade) => ({ date, grade })));

/** 학년별로 서로 겹치지 않는 교사 n명씩. */
function disjointPools(perGrade: number): SchedulerTeacher[] {
  return ([1, 2, 3] as const).flatMap((g) => Array.from({ length: perGrade }, () => teacher([g])));
}

function assertNoDoubleBooking(assignments: { date: string; teacherId: number }[]) {
  const seen = new Set<string>();
  for (const a of assignments) {
    const key = `${a.date}:${a.teacherId}`;
    expect(seen.has(key), `${a.date}에 교사 ${a.teacherId} 중복 배정`).toBe(false);
    seen.add(key);
  }
}

describe('Scheduler Engine (6.5)', () => {
  it('특별 일정일에는 배정이 생성되지 않는다', () => {
    const dates = ['2026-10-05', '2026-10-09', '2026-10-20'];
    const specialDays = allGrades(dates);
    const result = generateSchedule(baseInput(disjointPools(4), { specialDays }));

    const assigned = new Set(result.assignments.map((a) => a.date));
    for (const d of dates) expect(assigned.has(d)).toBe(false);
    // 운영일은 모두 3학년 전부 채워진다.
    expect(result.assignments).toHaveLength(operatingDays(YEAR, MONTH, specialDays).length * 3);
    expect(result.warnings).toHaveLength(0);
  });

  it('학년 단위 특별 일정: 해당 학년만 편성에서 빠지고 다른 학년은 그날도 편성된다', () => {
    // 10/14: 2학년 수학여행(2학년만 제외), 10/15: 1·3학년만 편성(2학년 제외) + 10/16: 1학년만 편성
    const specialDays = [
      { date: '2026-10-14', grade: 2 },
      { date: '2026-10-15', grade: 2 },
      { date: '2026-10-16', grade: 2 },
      { date: '2026-10-16', grade: 3 },
    ];
    const result = generateSchedule(baseInput(disjointPools(4), { specialDays }));
    const gradesOn = (date: string) => result.assignments.filter((a) => a.date === date).map((a) => a.grade).sort();

    expect(gradesOn('2026-10-14')).toEqual([1, 3]);
    expect(gradesOn('2026-10-15')).toEqual([1, 3]);
    expect(gradesOn('2026-10-16')).toEqual([1]);
    expect(gradesOn('2026-10-13')).toEqual([1, 2, 3]);
    expect(result.warnings).toHaveLength(0); // 제외된 학년은 미배정 경고도 없다
    expect(operatingDays(YEAR, MONTH, specialDays, 2)).not.toContain('2026-10-14');
    expect(operatingDays(YEAR, MONTH, specialDays, 1)).toContain('2026-10-16');
  });

  it('학년 단위 특별 일정일의 기존 배정은 유지·편성 대상에서 제외된다', () => {
    const teachers = disjointPools(3);
    const t2 = teachers.find((t) => t.grades[0].grade === 2)!;
    const existing: ExistingAssignment[] = [
      { date: '2026-10-14', grade: 2, teacherId: t2.id, isModified: true },
    ];
    const result = generateSchedule(
      baseInput(teachers, { specialDays: [{ date: '2026-10-14', grade: 2 }], existingAssignments: existing }),
    );
    expect(result.assignments.some((a) => a.date === '2026-10-14' && a.grade === 2)).toBe(false);
  });

  it('방과후 요일에 해당 교사가 배정되지 않는다 (방과후 운영일)', () => {
    const teachers = disjointPools(4);
    const target = teachers[0]; // 1학년
    target.weekdayExclusions = [
      { weekday: 1, reason: 'AFTER_SCHOOL' },
      { weekday: 3, reason: 'AFTER_SCHOOL' },
    ];
    // 한 달 내내 방과후 운영
    const result = generateSchedule(baseInput(teachers, { afterSchoolDays: allGrades(operatingDays(YEAR, MONTH, [])) }));

    const mine = result.assignments.filter((a) => a.teacherId === target.id);
    expect(mine.length).toBeGreaterThan(0);
    for (const a of mine) expect([1, 3]).not.toContain(weekdayOf(a.date));
  });

  it('방과후 운영일이 아닌 날에는 방과후 요일 교사도 감독에 배정될 수 있다', () => {
    // 1학년 교사 2명: A는 매주 월요일 방과후. 10월 운영일은 12일(월)까지만 (이후 시험 기간 등으로 미운영)
    const a = teacher([1], { weekdayExclusions: [{ weekday: 1, reason: 'AFTER_SCHOOL' }] });
    const b = teacher([1], { unavailableDates: ['2026-10-19', '2026-10-26'].map((date) => ({ date, reason: '출장' })) });
    const afterSchoolDays = allGrades(operatingDays(YEAR, MONTH, []).filter((d) => d <= '2026-10-12'));
    const result = generateSchedule(baseInput([a, b], { targetGrades: [1], afterSchoolDays }));
    const on = (date: string) => result.assignments.find((x) => x.date === date)?.teacherId;

    expect(on('2026-10-05')).toBe(b.id); // 운영일 월요일 → A 제외
    expect(on('2026-10-12')).toBe(b.id);
    expect(on('2026-10-19')).toBe(a.id); // 미운영 월요일 → A 배정 가능 (B는 출장)
    expect(on('2026-10-26')).toBe(a.id);
  });

  it('방과후 운영일에는 지정한 학년만 편성하고, 그 감독은 방과후 수업이 없는 교사가 맡는다', () => {
    // A: 1·2학년, 매주 월요일 방과후 / B: 1학년, 방과후 없음 / C: 2학년, 방과후 없음. 10월 월요일은 1학년만 자습(방과후 운영일)
    const a = teacher([1, 2], { weekdayExclusions: [{ weekday: 1, reason: 'AFTER_SCHOOL' }] });
    const b = teacher([1]);
    const c = teacher([2]);
    const mondays = operatingDays(YEAR, MONTH, []).filter((d) => weekdayOf(d) === 1);
    const result = generateSchedule(
      baseInput([a, b, c], { targetGrades: [1, 2], afterSchoolDays: mondays.map((date) => ({ date, grade: 1 })) }),
    );
    for (const d of mondays) {
      // 1학년은 방과후 수업이 없는 B가 감독
      expect(result.assignments.find((x) => x.date === d && x.grade === 1)?.teacherId).toBe(b.id);
      // 2학년은 그날 자습이 없어 편성하지 않고, 미배정 경고도 없다
      expect(result.assignments.some((x) => x.date === d && x.grade === 2)).toBe(false);
      expect(result.warnings.some((w) => w.date === d && w.grade === 2)).toBe(false);
    }
    // 월요일이 아닌 날은 2학년도 편성된다
    expect(result.assignments.some((x) => x.grade === 2 && weekdayOf(x.date) !== 1)).toBe(true);
  });

  it('방과후가 아닌 요일 제외(기타)는 운영일과 관계없이 항상 제외된다', () => {
    const a = teacher([1], { weekdayExclusions: [{ weekday: 2, reason: 'OTHER' }] });
    const b = teacher([1]);
    const result = generateSchedule(baseInput([a, b], { targetGrades: [1] })); // 방과후 운영일 없음
    for (const x of result.assignments.filter((x) => x.teacherId === a.id)) expect(weekdayOf(x.date)).not.toBe(2);
  });

  it('같은 날 한 교사가 두 학년에 배정되지 않는다', () => {
    // 모든 교사가 전 학년 감독 가능 → 중복 배정 위험이 가장 큰 구성
    const teachers = Array.from({ length: 6 }, () => teacher([1, 2, 3]));
    const result = generateSchedule(baseInput(teachers));

    expect(result.warnings).toHaveLength(0);
    assertNoDoubleBooking(result.assignments);
  });

  it('금요일과 월~목 순번이 서로 영향을 주지 않는다', () => {
    // 1학년 교사 4명. 금요일 순서만 역순으로 지정.
    const teachers = Array.from({ length: 4 }, () => teacher([1]));
    teachers.forEach((t, i) => {
      t.grades[0].weekdayOrder = i + 1;
      t.grades[0].fridayOrder = 4 - i;
    });
    const withFridays = generateSchedule(baseInput(teachers, { targetGrades: [1] }));

    // 금요일을 모두 특별 일정으로 막아도 월~목 배정은 동일해야 한다.
    const fridays = operatingDays(YEAR, MONTH, []).filter((d) => weekdayOf(d) === 5);
    const withoutFridays = generateSchedule(baseInput(teachers, { targetGrades: [1], specialDays: allGrades(fridays) }));

    const weekdayOnly = (r: typeof withFridays) =>
      r.assignments.filter((a) => a.group === 'WEEKDAY').map((a) => `${a.date}:${a.teacherId}`);
    expect(weekdayOnly(withFridays)).toEqual(weekdayOnly(withoutFridays));

    // 금요일은 fridayOrder(역순)대로 순환한다.
    const fridayTeachers = withFridays.assignments.filter((a) => a.group === 'FRIDAY').map((a) => a.teacherId);
    const reversed = [...teachers].reverse().map((t) => t.id);
    expect(fridayTeachers.slice(0, 4)).toEqual(reversed);
  });

  it('제약이 없을 때 한 달 편성 결과의 학년·그룹별 편차가 1 이하이다', () => {
    for (const teachers of [disjointPools(5), Array.from({ length: 12 }, () => teacher([1, 2, 3]))]) {
      const result = generateSchedule(baseInput(teachers));
      expect(result.fairness).toHaveLength(6);
      for (const stat of result.fairness) {
        expect(stat.monthDeviation, `${stat.grade}학년 ${stat.group}`).toBeLessThanOrEqual(1);
        expect(stat.warning).toBe(false);
      }
    }
  });

  it('초기 누계가 적은 교사가 우선 배정된다', () => {
    const teachers = Array.from({ length: 4 }, () => teacher([1]));
    const [a, b, c, d] = teachers;
    const result = generateSchedule(
      baseInput(teachers, {
        targetGrades: [1],
        // d가 누계가 가장 적고, 순번은 가장 뒤
        priorCounts: [
          { teacherId: a.id, grade: 1, group: 'WEEKDAY', count: 5 },
          { teacherId: b.id, grade: 1, group: 'WEEKDAY', count: 5 },
          { teacherId: c.id, grade: 1, group: 'WEEKDAY', count: 5 },
          { teacherId: d.id, grade: 1, group: 'WEEKDAY', count: 2 },
        ],
      }),
    );

    const weekday = result.assignments.filter((x) => x.group === 'WEEKDAY').map((x) => x.teacherId);
    // 누계 차이(3)만큼 d가 먼저 연속 배정된다.
    expect(weekday.slice(0, 3)).toEqual([d.id, d.id, d.id]);
    // 이후 누계 합계가 균등해진다.
    const stat = result.fairness.find((s) => s.grade === 1 && s.group === 'WEEKDAY')!;
    expect(stat.totalDeviation).toBeLessThanOrEqual(1);
  });

  it('수동 변경 셀은 재편성 후에도 유지된다', () => {
    const teachers = disjointPools(4);
    const first = generateSchedule(baseInput(teachers));

    // 1학년 10/14 셀을 다른 교사로 바꿈 (수동 변경)
    const original = first.assignments.find((a) => a.date === '2026-10-14' && a.grade === 1)!;
    const other = teachers.find((t) => t.grades[0].grade === 1 && t.id !== original.teacherId)!;
    const existing: ExistingAssignment[] = first.assignments.map((a) => ({
      date: a.date,
      grade: a.grade,
      teacherId: a === original ? other.id : a.teacherId,
      isModified: a === original,
    }));

    const second = generateSchedule(baseInput(teachers, { existingAssignments: existing }));
    const cell = second.assignments.find((a) => a.date === '2026-10-14' && a.grade === 1)!;
    expect(cell.teacherId).toBe(other.id);
    expect(cell.source).toBe('KEPT');
    // 같은 날 다른 학년 셀은 새로 편성된다.
    expect(second.assignments.filter((a) => a.date === '2026-10-14' && a.source === 'GENERATED')).toHaveLength(2);
  });

  it('후보가 없는 경우 미배정 + 사유가 반환된다', () => {
    const t1 = teacher([1], { unavailableDates: [{ date: '2026-10-13', reason: '출장' }] });
    const t2 = teacher([1], { weekdayExclusions: [{ weekday: 2, reason: 'AFTER_SCHOOL' }] }); // 10/13은 화요일
    const result = generateSchedule(baseInput([t1, t2], { targetGrades: [1], afterSchoolDays: [{ date: '2026-10-13', grade: 1 }] }));

    expect(result.assignments.some((a) => a.date === '2026-10-13')).toBe(false);
    const warning = result.warnings.find((w) => w.date === '2026-10-13' && w.grade === 1);
    expect(warning).toBeDefined();
    expect(warning!.reasons).toEqual([`${t1.name}: 감독 불가일(출장)`, `${t2.name}: 방과후 수업`]);
  });

  it('부분 재편성 시 지정 범위 외 셀은 변경되지 않는다', () => {
    const teachers = disjointPools(4);
    const first = generateSchedule(baseInput(teachers));
    const existing: ExistingAssignment[] = first.assignments.map((a) => ({
      date: a.date,
      grade: a.grade,
      teacherId: a.teacherId,
      isModified: false,
    }));

    // 1학년 교사 한 명이 10/20~21에 불가일이 생겨 해당 범위만 재편성
    const range = ['2026-10-20', '2026-10-21'];
    const busy = first.assignments.find((a) => a.date === '2026-10-20' && a.grade === 1)!.teacherId;
    const changedTeachers = teachers.map((t) =>
      t.id === busy ? { ...t, unavailableDates: range.map((date) => ({ date, reason: '연수' })) } : t,
    );
    const second = generateSchedule(baseInput(changedTeachers, { existingAssignments: existing, dates: range }));

    const key = (a: { date: string; grade: number; teacherId: number }) => `${a.date}:${a.grade}:${a.teacherId}`;
    const outside = (a: { date: string }) => !range.includes(a.date);
    expect(second.assignments.filter(outside).map(key)).toEqual(first.assignments.filter(outside).map(key));
    expect(second.assignments.filter(outside).every((a) => a.source === 'KEPT')).toBe(true);
    const newCell = second.assignments.find((a) => a.date === '2026-10-20' && a.grade === 1)!;
    expect(newCell.teacherId).not.toBe(busy);
  });

  it('한 학년만 편성할 때 다른 학년 배정은 변경되지 않는다', () => {
    const teachers = Array.from({ length: 8 }, () => teacher([1, 2]));
    const grade2 = generateSchedule(baseInput(teachers, { targetGrades: [2] }));
    const existing: ExistingAssignment[] = grade2.assignments.map((a) => ({
      date: a.date,
      grade: a.grade,
      teacherId: a.teacherId,
      isModified: false,
    }));

    const grade1 = generateSchedule(baseInput(teachers, { targetGrades: [1], existingAssignments: existing }));
    // 결과에는 대상 학년만 포함된다 (다른 학년은 입력값 그대로 고정).
    expect(grade1.assignments.every((a) => a.grade === 1)).toBe(true);
    expect(grade1.fairness.every((s) => s.grade === 1)).toBe(true);
  });

  it('다른 학년에 이미 배정된 교사는 같은 날 편성 대상 학년 후보에서 제외된다', () => {
    // 2학년 부장이 먼저 편성 → 1학년 편성 순서 (Phase 3 완료 기준)
    const teachers = Array.from({ length: 3 }, () => teacher([1, 2]));
    const grade2 = generateSchedule(baseInput(teachers, { targetGrades: [2] }));
    const existing: ExistingAssignment[] = grade2.assignments.map((a) => ({
      date: a.date,
      grade: a.grade,
      teacherId: a.teacherId,
      isModified: false,
    }));

    const grade1 = generateSchedule(baseInput(teachers, { targetGrades: [1], existingAssignments: existing }));
    expect(grade1.warnings).toHaveLength(0);
    assertNoDoubleBooking([...grade2.assignments, ...grade1.assignments]);

    // 후보가 1명뿐인 경우: 그 교사가 다른 학년 감독 중이면 미배정 + 사유
    const solo = teacher([1, 2]);
    const soloGrade2: ExistingAssignment = { date: '2026-10-01', grade: 2, teacherId: solo.id, isModified: false };
    const soloResult = generateSchedule(
      baseInput([solo], { targetGrades: [1], existingAssignments: [soloGrade2] }),
    );
    const w = soloResult.warnings.find((x) => x.date === '2026-10-01')!;
    expect(w.reasons).toEqual([`${solo.name}: 같은 날 2학년 감독 중`]);
  });
});

describe('Scheduler Engine 부가 동작', () => {
  it('후보 수가 적은 학년부터 배정해 미배정을 줄인다', () => {
    // A는 1·2학년 가능, B는 2학년만 가능. 1학년을 먼저 배정하면 A가 1학년으로 가서 문제 없음.
    // 후보 수: 1학년 1명(A), 2학년 2명(A,B) → 1학년부터 배정해야 둘 다 채워진다.
    const a = teacher([1, 2]);
    const b = teacher([2]);
    // B의 누계를 높여 2학년 단독 기준이라면 A가 선택되도록 한다.
    const result = generateSchedule(
      baseInput([a, b], {
        targetGrades: [1, 2],
        priorCounts: [{ teacherId: b.id, grade: 2, group: 'WEEKDAY', count: 100 }],
      }),
    );
    expect(result.warnings).toHaveLength(0);
  });

  it('월 경계: 순환 포인터 시작 위치를 이어받는다', () => {
    const teachers = Array.from({ length: 4 }, () => teacher([1]));
    const result = generateSchedule(
      baseInput(teachers, {
        targetGrades: [1],
        startPointers: [{ grade: 1, group: 'WEEKDAY', teacherId: teachers[1].id }],
      }),
    );
    const firstWeekday = result.assignments.find((a) => a.group === 'WEEKDAY')!;
    expect(firstWeekday.teacherId).toBe(teachers[2].id);
  });

  it('옵션: 직전 운영일에 감독한 교사는 후순위', () => {
    // 전 학년 가능 교사 4명 → 매일 3명 배정. 옵션이 켜지면 전날 감독자는 누계 동률일 때 뒤로.
    const teachers = Array.from({ length: 5 }, () => teacher([1, 2, 3]));
    const consecutive = (avoidPreviousDay: boolean) => {
      const result = generateSchedule(baseInput(teachers, { options: { avoidPreviousDay } }));
      expect(result.warnings).toHaveLength(0);
      assertNoDoubleBooking(result.assignments);
      const days = [...new Set(result.assignments.map((a) => a.date))];
      let repeats = 0;
      for (let i = 1; i < days.length; i++) {
        const prev = new Set(result.assignments.filter((a) => a.date === days[i - 1]).map((a) => a.teacherId));
        repeats += result.assignments.filter((a) => a.date === days[i] && prev.has(a.teacherId)).length;
      }
      return repeats;
    };
    expect(consecutive(true)).toBeLessThan(consecutive(false));
  });

  it('교사 30명 기준 한 달 편성이 1초 이내 (8장)', () => {
    const teachers = Array.from({ length: 30 }, (_, i) =>
      teacher([((i % 3) + 1) as Grade, (((i + 1) % 3) + 1) as Grade], {
        weekdayExclusions: [{ weekday: (i % 5) + 1, reason: 'AFTER_SCHOOL' }],
      }),
    );
    const started = performance.now();
    const result = generateSchedule(baseInput(teachers));
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(1000);
    expect(result.warnings).toHaveLength(0);
    assertNoDoubleBooking(result.assignments);
  });
});
