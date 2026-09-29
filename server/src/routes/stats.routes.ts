import { Router } from 'express';
import { z } from 'zod';
import { handle } from '../lib/http.js';
import { requireAuth } from '../permissions/middleware.js';
import { getMonthStats, getRangeStats } from '../services/statsService.js';

export const statsRouter = Router();

statsRouter.use(requireAuth);

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

/** GET /api/stats?year=&month= — 교사별 이번 달·누계 현황 + 공정성 지표 (로그인). */
statsRouter.get(
  '/',
  handle(async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: '연도·월 정보가 올바르지 않습니다.' });
    res.json(await getMonthStats(parsed.data.year, parsed.data.month, req.user!));
  }),
);

const ymSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .transform((s) => ({ year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) }));
const MAX_MONTHS = 24;

/** GET /api/stats/range?from=YYYY-MM&to=YYYY-MM — 기간 통계 (F7, 로그인). 확정·마감 배정만 집계. */
statsRouter.get(
  '/range',
  handle(async (req, res) => {
    const parsed = z.object({ from: ymSchema, to: ymSchema }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: '기간(from, to)을 YYYY-MM 형식으로 입력해주세요.' });
    const { from, to } = parsed.data;
    const span = (to.year - from.year) * 12 + (to.month - from.month);
    if (span < 0) return res.status(400).json({ error: '시작 월이 끝 월보다 늦을 수 없습니다.' });
    if (span >= MAX_MONTHS) return res.status(400).json({ error: `기간은 최대 ${MAX_MONTHS}개월까지 조회할 수 있습니다.` });
    res.json(await getRangeStats(from, to, req.user!));
  }),
);
