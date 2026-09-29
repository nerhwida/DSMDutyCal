import { Router } from 'express';
import { z } from 'zod';
import { handle } from '../lib/http.js';
import { gradeSchema } from '../lib/validation.js';
import { requireAuth } from '../permissions/middleware.js';
import { listHistory } from '../services/historyService.js';

export const historyRouter = Router();

historyRouter.use(requireAuth);

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  grade: z.coerce.number().pipe(gradeSchema).optional(),
});

/** GET /api/history?year=&month=&grade= — 변경 이력 (F10). 권한 범위로 필터된다. */
historyRouter.get(
  '/',
  handle(async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: '연도·월·학년 정보가 올바르지 않습니다.' });
    res.json(await listHistory(parsed.data, req.user!));
  }),
);
