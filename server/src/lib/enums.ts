// SQLite 커넥터는 Prisma 네이티브 enum을 지원하지 않으므로,
// 여기서 애플리케이션 레벨의 enum 값과 타입을 정의하고 zod로 검증한다.

export const ROLES = ['ADMIN', 'GRADE_HEAD', 'TEACHER'] as const;
export type Role = (typeof ROLES)[number];

export const GRADES = [1, 2, 3] as const;
export type Grade = (typeof GRADES)[number];

export const ROTATION_GROUPS = ['WEEKDAY', 'FRIDAY'] as const;
export type RotationGroup = (typeof ROTATION_GROUPS)[number];

export const WEEKDAY_EXCLUSION_REASONS = ['AFTER_SCHOOL', 'OTHER'] as const;
export type WeekdayExclusionReason = (typeof WEEKDAY_EXCLUSION_REASONS)[number];

export const SPECIAL_DAY_TYPES = ['MANDATORY_HOME', 'HOLIDAY', 'VACATION', 'SCHOOL_CLOSURE', 'EXAM', 'EVENT', 'OTHER'] as const;
export type SpecialDayType = (typeof SPECIAL_DAY_TYPES)[number];

export const MONTH_PLAN_STATUSES = ['EMPTY', 'DRAFT', 'CONFIRMED', 'CLOSED'] as const;
export type MonthPlanStatus = (typeof MONTH_PLAN_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'ASSIGNED_BY_CHANGE',
  'REMOVED_BY_CHANGE',
  'SWAPPED',
  'MONTH_CONFIRMED',
  'MONTH_RESET',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const AUDIT_ACTIONS = [
  'GENERATE',
  'REGENERATE',
  'CONFIRM',
  'CLOSE',
  'REOPEN',
  'RESET',
  'SET_GRADE_HEAD',
  'RESET_PIN',
  'CREATE_TEACHER',
  'UPDATE_TEACHER',
  'DELETE_TEACHER',
  'CREATE_API_CLIENT',
  'REGENERATE_API_KEY',
  'UPDATE_API_CLIENT',
  'DELETE_API_CLIENT',
  'BACKUP',
  'RESTORE_STAGED',
  'RESTORE_CANCELLED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** 자율학습 운영 요일: 월(1) ~ 금(5). */
export function isFriday(weekday: number): boolean {
  return weekday === 5;
}

export function rotationGroupForWeekday(weekday: number): RotationGroup {
  return isFriday(weekday) ? 'FRIDAY' : 'WEEKDAY';
}
