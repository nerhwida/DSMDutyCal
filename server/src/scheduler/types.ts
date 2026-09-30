import type { Grade, RotationGroup, WeekdayExclusionReason } from '../lib/enums.js';

/** 엔진이 보는 교사 정보. DB 모델과 분리된 순수 데이터 (6.1: DB 접근 금지). */
export interface SchedulerTeacher {
  id: number;
  name: string;
  active: boolean;
  grades: {
    grade: Grade;
    canWeekday: boolean;
    canFriday: boolean;
    weekdayOrder: number;
    fridayOrder: number;
  }[];
  weekdayExclusions: { weekday: number; reason: WeekdayExclusionReason }[];
  unavailableDates: { date: string; reason: string }[];
}

export interface ScheduleContext {
  date: string; // 'YYYY-MM-DD'
  weekday: number; // 1~5
  grade: Grade;
  group: RotationGroup;
  dayAssignments: Map<number, number>; // grade → teacherId (당일 이미 배정)
  /** 방과후 운영일인지. 교사의 방과후 요일은 운영일에만 감독 제외로 적용된다. */
  afterSchoolDay: boolean;
}

export type RuleResult = { ok: true } | { ok: false; reason: string };

/** 후보 제외 규칙. reason은 F6 팝오버의 "선택 불가 사유"로 그대로 재사용한다. */
export interface HardRule {
  id: string;
  check(teacher: SchedulerTeacher, ctx: ScheduleContext): RuleResult;
}

/** 특별 일정 1건 = (날짜, 학년). 전 학년 일정은 학년별로 3건. */
export interface SpecialDayEntry {
  date: string;
  grade: number;
}

/** 해당 월에 이미 존재하는 배정 (DRAFT 포함). */
export interface ExistingAssignment {
  date: string;
  grade: Grade;
  teacherId: number;
  isLocked: boolean;
  isModified: boolean;
}

/** 학년·그룹별 누계 (InitialCount + 이전 월 확정분). */
export interface CountEntry {
  teacherId: number;
  grade: Grade;
  group: RotationGroup;
  count: number;
}

/** 학년·그룹별 순환 포인터 시작 위치 = 직전에 배정된 교사. */
export interface PointerEntry {
  grade: Grade;
  group: RotationGroup;
  teacherId: number;
}

export interface SchedulerInput {
  year: number;
  month: number; // 1~12
  /** 편성 대상 학년 (학년부장: 1개, ADMIN: 1~3개). 대상이 아닌 학년의 배정은 고정값으로 취급한다. */
  targetGrades: Grade[];
  teachers: SchedulerTeacher[];
  /** 특별 일정 (날짜 × 학년). 해당 날짜의 해당 학년은 편성하지 않는다. */
  specialDays: SpecialDayEntry[];
  /** 방과후 운영일 ('YYYY-MM-DD'). 이 날에만 방과후 요일 교사를 제외한다. */
  afterSchoolDays: string[];
  /** 해당 월의 기존 배정 (전 학년). */
  existingAssignments: ExistingAssignment[];
  priorCounts: CountEntry[];
  startPointers: PointerEntry[];
  /** 부분 재편성 범위. 지정 시 이 날짜들만 재편성하고 나머지 대상 학년 배정은 유지한다. */
  dates?: string[];
  options?: {
    /** 6.3-3: 직전 운영일에 감독한 교사를 후순위로 둔다 (기본 false). */
    avoidPreviousDay?: boolean;
  };
}

export interface PlannedAssignment {
  date: string;
  grade: Grade;
  teacherId: number;
  group: RotationGroup;
  /** KEPT: 기존 배정 유지 (고정·수동 변경·범위 외), GENERATED: 이번 편성으로 생성. */
  source: 'KEPT' | 'GENERATED';
}

export interface SchedulerWarning {
  date: string;
  grade: Grade;
  reasons: string[];
}

export interface FairnessStat {
  grade: Grade;
  group: RotationGroup;
  /** 이번 달 배정 횟수 기준 */
  monthMax: number;
  monthMin: number;
  monthDeviation: number;
  /** 누계(초기 누계 + 이전 확정 + 이번 달) 기준 */
  totalMax: number;
  totalMin: number;
  totalDeviation: number;
  /** 누계 편차 2 이상이면 true (F4 공정성 경고) */
  warning: boolean;
}

export interface SchedulerResult {
  /** 대상 학년의 배정 결과 (유지분 포함). */
  assignments: PlannedAssignment[];
  warnings: SchedulerWarning[];
  fairness: FairnessStat[];
}
