import { Router } from 'express';
import { z } from 'zod';
import { handle } from '../lib/http.js';
import { requireApiClientOrSession } from '../permissions/middleware.js';
import { getDutyFeed } from '../services/dutyFeedService.js';

/**
 * 외부 배포용 API. 가정 8("비로그인 공개 모드 없음")의 예외로, 로그인 세션 대신
 * ADMIN이 발급한 API 연동 계정 키를 헤더 X-API-Key로 보내 호출할 수 있다 (프로젝트 오너 결정).
 */
export const publicRouter = Router();

const paramsSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

/** GET /api/public/duty/:year/:month — 날짜별 1·2·3학년 감독 교사 (확정·마감 학년만). */
publicRouter.get(
  '/duty/:year/:month',
  requireApiClientOrSession,
  handle(async (req, res) => {
    const parsed = paramsSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: '연도·월 정보가 올바르지 않습니다.' });
    res.set('Cache-Control', 'no-store');
    res.json(await getDutyFeed(parsed.data.year, parsed.data.month));
  }),
);
