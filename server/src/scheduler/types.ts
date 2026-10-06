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
  /** 이 날 이 학년이 방과후 운영일인지. 교사의 방과후 요일은 운영일의 해당 학년 감독에만 제외로 적용된다. */
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
  /** 수동 변경·지정된 셀 (편성에서 유지). 서비스는 ↻ 표시 또는 변경 이력이 있으면 true로 넘긴다. */
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
/** 학년·그룹별 밀린 차례 (먼저 밀린 교사부터). */
export interface OwedEntry {
  grade: Grade;
  group: RotationGroup;
  teacherIds: number[];
}

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
  /**
   * 방과후 운영일 (날짜 × 학년 = 그날 자습 감독이 있는 학년). 지정한 학년 감독에서는 방과후 요일 교사를 제외하고,
   * 지정하지 않은 학년은 그날 편성하지 않는다.
   */
  afterSchoolDays: SpecialDayEntry[];
  /** 해당 월의 기존 배정 (전 학년). */
  existingAssignments: ExistingAssignment[];
  priorCounts: CountEntry[];
  startPointers: PointerEntry[];
  /** 지난달에서 이어받는 밀린 차례 (학년·그룹별, 먼저 밀린 순). 가능한 첫날 순번보다 먼저 배정한다. */
  startOwed?: OwedEntry[];
  /** 부분 재편성 범위. 지정 시 이 날짜들만 재편성하고 나머지 대상 학년 배정은 유지한다. */
  dates?: string[];
  options?: {
    /** 6.3-3: 직전 운영일에 감독한 교사를 후순위로 둔다 (기본 false). */
    avoidPreviousDay?: boolean;
    /**
     * 금요일을 먼저 편성하고, 그 달 금요일 감독 1회마다 월~목 차례를 1번 넘긴다 (기본 true, 오너 요청).
     * 넘긴 차례는 밀린 차례로 돌려주지 않는다.
     */
    fridaySkipsWeekday?: boolean;
  };
}

export interface PlannedAssignment {
  date: string;
  grade: Grade;
  teacherId: number;
  group: RotationGroup;
  /** KEPT: 기존 배정 유지 (수동 변경·범위 외), GENERATED: 이번 편성으로 생성. */
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

/**
 * 배정 근거 (자동 편성 결과 요약 표시용). 이번 편성으로 새로 배정한 칸마다 하나.
 * position = 그 학년·그룹 순환 순서에서의 번호 (교사 관리 화면의 순서와 같다, 1부터). 순서에 없으면 null.
 */
export interface AssignmentTrace {
  date: string;
  grade: Grade;
  group: RotationGroup;
  teacherId: number;
  position: number | null;
  /** 밀린 차례로 배정됨 (앞서 자기 순번에 불가해 건너뛴 교사) */
  owed: boolean;
  /** 금요일 감독으로 이번 차례를 넘긴 교사 (그 달 금요일 감독 날짜) */
  passed: { teacherId: number; position: number | null; fridays: string[] }[];
  /** 그날 감독할 수 없어 건너뛴 교사 (밀린 차례로 기억된다) */
  skipped: { teacherId: number; position: number | null; reason: string }[];
  /** 이미 밀린 차례인데 그날도 감독할 수 없어 계속 기다리는 교사 */
  waiting: { teacherId: number; position: number | null; reason: string }[];
}

export interface SchedulerResult {
  /** 대상 학년의 배정 결과 (유지분 포함). */
  assignments: PlannedAssignment[];
  warnings: SchedulerWarning[];
  fairness: FairnessStat[];
  /** 새로 배정한 칸의 배정 근거 (날짜·학년 순) */
  trace: AssignmentTrace[];
  /** 편성을 마친 뒤 남은 밀린 차례 (대상 학년, 그룹별). 다음 달 편성이 이어받는다. */
  endOwed: OwedEntry[];
}
