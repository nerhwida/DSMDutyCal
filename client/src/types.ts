export type Grade = 1 | 2 | 3;
export type RotationGroup = 'WEEKDAY' | 'FRIDAY';
export type WeekdayExclusionReason = 'AFTER_SCHOOL' | 'OTHER';
export type SpecialDayType = 'MANDATORY_HOME' | 'HOLIDAY' | 'VACATION' | 'SCHOOL_CLOSURE' | 'EXAM' | 'EVENT' | 'OTHER';

export const SPECIAL_DAY_TYPE_LABEL: Record<SpecialDayType, string> = {
  MANDATORY_HOME: '의무귀가',
  HOLIDAY: '공휴일',
  VACATION: '방학',
  SCHOOL_CLOSURE: '재량휴업일',
  EXAM: '시험',
  EVENT: '행사',
  OTHER: '기타',
};

export const WEEKDAY_LABEL: Record<number, string> = {
  1: '월',
  2: '화',
  3: '수',
  4: '목',
  5: '금',
};

export interface TeacherGrade {
  id: number;
  teacherId: number;
  grade: Grade;
  canWeekday: boolean;
  canFriday: boolean;
  weekdayOrder: number;
  fridayOrder: number;
}

export interface TeacherWeekdayExclusion {
  id: number;
  teacherId: number;
  weekday: number;
  reason: WeekdayExclusionReason;
}

export interface TeacherUnavailableDate {
  id: number;
  teacherId: number;
  date: string;
  reason: string;
}

export interface GradeHeadRef {
  grade: Grade;
  teacherId: number;
}

export interface Teacher {
  id: number;
  name: string;
  active: boolean;
  mustChangePin: boolean;
  isAdmin: boolean;
  sortOrder: number;
  teacherGrades: TeacherGrade[];
  weekdayExclusions: TeacherWeekdayExclusion[];
  unavailableDates: TeacherUnavailableDate[];
  gradeHead: GradeHeadRef | null;
}

/** 특별 일정 1행 = (날짜, 학년). 전 학년 일정은 학년별 3행. */
export interface SpecialDay {
  id: number;
  date: string;
  grade: Grade;
  type: SpecialDayType;
  title: string;
}

export type MonthPlanStatus = 'EMPTY' | 'DRAFT' | 'CONFIRMED' | 'CLOSED';

export const PLAN_STATUS_LABEL: Record<MonthPlanStatus, string> = {
  EMPTY: '미편성',
  DRAFT: '편성 중',
  CONFIRMED: '확정',
  CLOSED: '마감',
};

export interface AssignmentView {
  id: number;
  date: string;
  grade: Grade;
  teacherId: number;
  teacherName: string;
  originalTeacherId: number;
  originalTeacherName: string;
  rotationGroup: RotationGroup;
  isModified: boolean;
  modifiedAt: string | null;
  lastChange: { changedAt: string; changedByName: string; note: string | null } | null;
}

export interface MonthView {
  year: number;
  month: number;
  grades: { grade: Grade; status: MonthPlanStatus; assignmentsVisible: boolean }[];
  /** 한 학년이라도 편성하는 날. grades = 그날 편성하는 학년 */
  operatingDays: { date: string; weekday: number; group: RotationGroup; grades: Grade[] }[];
  /** 특별 일정은 (날짜 × 학년) 단위 */
  specialDays: { date: string; grade: Grade; type: SpecialDayType; title: string }[];
  /** 방과후 운영일 (이 날에만 방과후 요일 교사가 감독에서 제외됨) */
  afterSchoolDays: string[];
  assignments: AssignmentView[];
  unassigned: { date: string; grade: Grade; reasons: string[] }[];
}

export interface FairnessStat {
  grade: Grade;
  group: RotationGroup;
  monthMax: number;
  monthMin: number;
  monthDeviation: number;
  totalMax: number;
  totalMin: number;
  totalDeviation: number;
  warning: boolean;
}

export interface GenerateResult {
  year: number;
  month: number;
  grade: Grade;
  status: MonthPlanStatus;
  generatedCount: number;
  keptCount: number;
  warnings: { date: string; grade: Grade; reasons: string[] }[];
  fairness: FairnessStat[];
}

export interface Candidate {
  teacherId: number;
  name: string;
  blocking: string | null;
  warnings: string[];
  isCurrent: boolean;
  isOriginal: boolean;
  monthCount: number;
}

export interface CellCandidatesResponse {
  cell: { date: string; grade: Grade; rotationGroup: RotationGroup; status: MonthPlanStatus };
  candidates: Candidate[];
}

export interface CandidatesResponse {
  assignment: {
    id: number;
    date: string;
    grade: Grade;
    rotationGroup: RotationGroup;
    teacherId: number;
    teacherName: string;
    originalTeacherId: number;
    status: MonthPlanStatus;
  };
  candidates: Candidate[];
}

export interface TeacherAssignment {
  id: number;
  date: string;
  grade: Grade;
  rotationGroup: RotationGroup;
  isModified: boolean;
  status: MonthPlanStatus;
}

export type NotificationType = 'ASSIGNED_BY_CHANGE' | 'REMOVED_BY_CHANGE' | 'SWAPPED' | 'MONTH_CONFIRMED' | 'MONTH_RESET';

export interface AppNotification {
  id: number;
  type: NotificationType;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface HistoryEntry {
  id: number;
  kind: 'GAVE' | 'RECEIVED' | 'SWAP' | 'ASSIGNED';
  date: string;
  grade: Grade;
  /** null = 미배정 칸을 채운 경우 */
  fromTeacherName: string | null;
  toTeacherName: string;
  changedByName: string;
  changedAt: string;
  note: string | null;
}

export interface StatsRow {
  teacherId: number;
  name: string;
  active: boolean;
  month: Record<Grade, number>;
  monthTotal: number;
  weekdayTotal: number;
  fridayTotal: number;
  total: number;
  /** key: '1:WEEKDAY' 형식 */
  byGradeGroup: Record<string, number>;
}

export interface MonthStats {
  year: number;
  month: number;
  rows: StatsRow[];
  fairness: { grade: Grade; group: RotationGroup; max: number; min: number; deviation: number; warning: boolean }[];
}

export const GROUP_LABEL: Record<RotationGroup, string> = { WEEKDAY: '월~목', FRIDAY: '금' };

export interface RegenerateResult {
  year: number;
  month: number;
  grade: Grade;
  from: string;
  to: string;
  status: MonthPlanStatus;
  changedCount: number;
  filledCount: number;
  unchangedCount: number;
  removedCount: number;
  warnings: { date: string; grade: Grade; reasons: string[] }[];
  fairness: FairnessStat[];
}

export interface HistoryRow {
  id: number;
  changedAt: string;
  date: string;
  grade: Grade;
  /** null = 미배정 칸을 채운 경우 */
  fromTeacherName: string | null;
  toTeacherName: string;
  changedByName: string;
  changedByRole: 'ADMIN' | 'GRADE_HEAD' | 'TEACHER';
  note: string | null;
  swapGroupId: string | null;
}

interface Deviation {
  max: number;
  min: number;
  deviation: number;
  warning: boolean;
}

export interface RangeStats {
  from: string;
  to: string;
  rows: {
    teacherId: number;
    name: string;
    active: boolean;
    /** key: '1:WEEKDAY' 형식 */
    period: Record<string, number>;
    periodTotal: number;
    periodWeekday: number;
    periodFriday: number;
    total: Record<string, number>;
    weekdayTotal: number;
    fridayTotal: number;
    grandTotal: number;
  }[];
  fairness: { grade: Grade; group: RotationGroup; period: Deviation; total: Deviation }[];
}

export interface InitialCount {
  id: number;
  teacherId: number;
  grade: Grade;
  rotationGroup: RotationGroup;
  count: number;
  teacher?: { id: number; name: string };
}
