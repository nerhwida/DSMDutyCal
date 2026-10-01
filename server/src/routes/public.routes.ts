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

/** 학년별 자습 층 (연동처 요청 형식: 3학년 2층, 2학년 3층, 1학년 4층). */
const FLOOR_BY_GRADE: Record<string, number> = { '1': 4, '2': 3, '3': 2 };

/**
 * GET /api/public/duty/:year/:month/:day — 그날의 층별 감독 교사 (확정·마감 학년만 공개).
 * 응답: { date, teacher: [{ floor, teacher }] } — 감독이 있는 학년만, 층 오름차순. 감독이 없는 날은 빈 배열.
 */
publicRouter.get(
  '/duty/:year/:month/:day',
  requireApiClientOrSession,
  handle(async (req, res) => {
    const parsed = paramsSchema.extend({ day: z.coerce.number().int().min(1).max(31) }).safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: '날짜 정보가 올바르지 않습니다.' });
    const { year, month, day } = parsed.data;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const feed = await getDutyFeed(year, month);
    const found = feed.days.find((d) => d.date === date);
    if (!found) return res.status(400).json({ error: '날짜 정보가 올바르지 않습니다.' }); // 예: 2월 30일
    const duty = 'duty' in found ? found.duty : undefined;
    const teacher = Object.entries(duty ?? {})
      .filter((entry): entry is [string, { name: string }] => entry[1] !== null)
      .map(([grade, t]) => ({ floor: FLOOR_BY_GRADE[grade], teacher: t.name }))
      .sort((a, b) => a.floor - b.floor);
    res.set('Cache-Control', 'no-store');
    res.json({ date, teacher });
  }),
);
