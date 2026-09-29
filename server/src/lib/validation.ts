import { z } from 'zod';

export const gradeSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const weekdaySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export const rotationGroupSchema = z.enum(['WEEKDAY', 'FRIDAY']);
export const weekdayExclusionReasonSchema = z.enum(['AFTER_SCHOOL', 'OTHER']);
export const specialDayTypeSchema = z.enum(['MANDATORY_HOME', 'HOLIDAY', 'EXAM', 'EVENT', 'OTHER']);

/** 'YYYY-MM-DD' 형식 문자열만 허용 (Asia/Seoul 기준, Date 객체 타임존 오류 방지). */
export const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식이어야 합니다.');

/** 조회 기간 쿼리 (?from=&to=). */
export const dateRangeQuerySchema = z.object({ from: dateStringSchema, to: dateStringSchema });

export const pinSchema = z
  .string()
  .regex(/^\d{4,6}$/, 'PIN은 숫자 4~6자리로 입력해주세요.');
