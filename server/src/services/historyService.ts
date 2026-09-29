import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { AuthenticatedUser } from '../auth/authService.js';
import { monthBounds } from '../scheduler/index.js';

/**
 * 변경 이력 (F10). 권한별 조회 범위 (F1-1):
 * - ADMIN: 전체
 * - 학년부장: 담당 학년 전체 + 본인 관련
 * - 일반 교사: 본인 관련 (넘긴·넘겨받은·맞교환·본인이 변경한 이력)
 */
export async function listHistory(
  params: { year: number; month: number; grade?: number },
  user: AuthenticatedUser,
) {
  const { start, end } = monthBounds(params.year, params.month);
  const mine: Prisma.AssignmentHistoryWhereInput[] = [
    { fromTeacherId: user.id },
    { toTeacherId: user.id },
    { changedById: user.id },
  ];
  const scope: Prisma.AssignmentHistoryWhereInput = user.isAdmin
    ? {}
    : { OR: [...mine, ...(user.gradeHeadOf.length > 0 ? [{ assignment: { grade: { in: user.gradeHeadOf } } }] : [])] };

  const rows = await prisma.assignmentHistory.findMany({
    where: {
      AND: [
        { assignment: { date: { gte: start, lte: end }, ...(params.grade ? { grade: params.grade } : {}) } },
        scope,
      ],
    },
    include: {
      assignment: { select: { date: true, grade: true } },
      fromTeacher: { select: { name: true } },
      toTeacher: { select: { name: true } },
      changedBy: { select: { name: true } },
    },
    orderBy: { changedAt: 'desc' },
  });

  return rows.map((h) => ({
    id: h.id,
    changedAt: h.changedAt,
    date: h.assignment.date,
    grade: h.assignment.grade,
    fromTeacherName: h.fromTeacher?.name ?? null, // null = 미배정 칸을 채운 경우
    toTeacherName: h.toTeacher.name,
    changedByName: h.changedBy.name,
    changedByRole: h.changedByRole,
    note: h.note,
    swapGroupId: h.swapGroupId,
  }));
}
