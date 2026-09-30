import type { NextFunction, Request, Response } from 'express';
import { loadAuthenticatedUser } from '../auth/authService.js';
import { prisma } from '../lib/prisma.js';
import { authenticateApiKey } from '../services/apiClientService.js';

/**
 * 세션에 로그인한 교사가 있는지 확인하고, req.user에 권한 판단에 필요한
 * 정보(관리자 여부, 담당 학년 목록 등)를 채워 넣는다.
 * 이 미들웨어를 통과하지 못하면 이후의 모든 권한 검사는 의미가 없으므로
 * 보호된 라우터에는 반드시 가장 먼저 적용한다.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const teacherId = req.session.teacherId;
  if (!teacherId) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const user = await loadAuthenticatedUser(teacherId);
  if (!user || !user.active) {
    req.session.teacherId = undefined;
    return res.status(401).json({ error: '세션이 유효하지 않습니다. 다시 로그인해주세요.' });
  }

  req.user = user;
  next();
}

/**
 * API 연동 계정 키(헤더 X-API-Key) 또는 로그인 세션 중 하나를 요구한다.
 * 키는 ADMIN이 발급한 활성 연동 계정(ApiClient)의 키여야 한다.
 */
export async function requireApiClientOrSession(req: Request, res: Response, next: NextFunction) {
  const key = req.header('x-api-key');
  if (key === undefined) return requireAuth(req, res, next);

  const client = await authenticateApiKey(key);
  if (!client) {
    return res.status(401).json({ error: 'API 키가 올바르지 않거나 비활성화된 연동 계정입니다.' });
  }
  req.apiClient = client;
  next();
}

/**
 * 연동 계정 키는 배포 API(/api/public/*)에서만 쓸 수 있다. 그 밖의 API에 키를 보내면
 * 세션 유무와 관계없이 403으로 막아, 연동 계정이 "조회 전용"임을 명확히 한다.
 */
export function restrictApiKeyToPublic(req: Request, res: Response, next: NextFunction) {
  if (req.header('x-api-key') !== undefined && !req.path.startsWith('/api/public/')) {
    return res.status(403).json({ error: 'API 연동 계정은 감독표 배포 API만 호출할 수 있습니다.' });
  }
  next();
}

/**
 * 일정 관리(특별 일정·방과후 운영일): ADMIN 또는 학년부장(담당 학년과 무관하게 모든 학년).
 * ADMIN은 gradeHeadOf=[1,2,3]이므로 "학년부장 권한이 하나라도 있으면" 허용과 같다.
 */
export function requireScheduleManager(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.gradeHeadOf.length === 0) {
    return res.status(403).json({ error: '관리자 또는 학년부장만 일정을 관리할 수 있습니다.' });
  }
  next();
}

/** 시스템 관리자(ADMIN) 전용 기능. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: '관리자만 사용할 수 있는 기능입니다.' });
  }
  next();
}

/**
 * 특정 학년에 대한 학년부장(또는 ADMIN) 권한 검사.
 * gradeGetter는 요청에서 대상 학년(1|2|3)을 추출하는 함수다.
 */
export function requireGradeScope(gradeGetter: (req: Request) => number | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    const grade = gradeGetter(req);
    if (grade === undefined || Number.isNaN(grade)) {
      return res.status(400).json({ error: '학년 정보가 올바르지 않습니다.' });
    }
    if (!req.user?.gradeHeadOf.includes(grade)) {
      return res.status(403).json({ error: `${grade}학년 담당 학년부장 또는 관리자만 사용할 수 있는 기능입니다.` });
    }
    next();
  };
}

/**
 * 본인이거나 ADMIN인 경우에만 허용 (예: 감독 불가일·방과후 요일 등록은 본인/ADMIN만 가능).
 * teacherIdGetter는 요청에서 대상 교사 id를 추출하는 함수다.
 */
export function requireSelfOrAdmin(teacherIdGetter: (req: Request) => number | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    const targetTeacherId = teacherIdGetter(req);
    if (targetTeacherId === undefined || Number.isNaN(targetTeacherId)) {
      return res.status(400).json({ error: '교사 정보가 올바르지 않습니다.' });
    }
    if (!req.user?.isAdmin && req.user?.id !== targetTeacherId) {
      return res.status(403).json({ error: '본인 또는 관리자만 사용할 수 있는 기능입니다.' });
    }
    next();
  };
}

/**
 * 본인 감독(Assignment)에 대해서만 허용되는 기능 (F1-2 교체 등).
 * assignmentIdGetter는 요청에서 assignment id를 추출하는 함수다.
 */
export function requireOwnAssignment(assignmentIdGetter: (req: Request) => number | undefined) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const assignmentId = assignmentIdGetter(req);
    if (assignmentId === undefined || Number.isNaN(assignmentId)) {
      return res.status(400).json({ error: '배정 정보가 올바르지 않습니다.' });
    }

    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) {
      return res.status(404).json({ error: '해당 감독 배정을 찾을 수 없습니다.' });
    }
    if (assignment.teacherId !== req.user?.id) {
      return res.status(403).json({ error: '본인의 감독만 교체할 수 있습니다.' });
    }
    next();
  };
}
