import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Grade } from '../lib/enums.js';
import { handle } from '../lib/http.js';
import { dateStringSchema, gradeSchema } from '../lib/validation.js';
import { requireAdmin, requireAuth, requireGradeScope } from '../permissions/middleware.js';
import {
  closeMonthPlan,
  confirmMonthPlan,
  resetMonthPlan,
  generateMonthPlan,
  getMonthView,
  regenerateMonthPlan,
  reopenMonthPlan,
} from '../services/schedulerService.js';

export const monthsRouter = Router();

monthsRouter.use(requireAuth);

const yearMonthSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

function parseYearMonth(req: Request) {
  return yearMonthSchema.safeParse(req.params);
}

/** :year/:month/grades/:grade 형식 검증. 권한 검사(requireGradeScope)보다 먼저 400을 돌려준다. */
function validateGradeParams(req: Request, res: Response, next: NextFunction) {
  if (!parseYearMonth(req).success || !gradeSchema.safeParse(Number(req.params.grade)).success) {
    return res.status(400).json({ error: '연도·월·학년 정보가 올바르지 않습니다.' });
  }
  next();
}

/** GET /api/months/:year/:month — 달력 데이터 (DRAFT는 권한자만 포함). */
monthsRouter.get(
  '/:year/:month',
  handle(async (req, res) => {
    const parsed = parseYearMonth(req);
    if (!parsed.success) {
      return res.status(400).json({ error: '연도·월 정보가 올바르지 않습니다.' });
    }
    res.json(await getMonthView(parsed.data.year, parsed.data.month, req.user!));
  }),
);

/** POST /api/months/:year/:month/grades/:grade/generate — 자동 편성 미리보기 (ADMIN, 해당 학년부장). */
monthsRouter.post(
  '/:year/:month/grades/:grade/generate',
  validateGradeParams,
  requireGradeScope((req) => Number(req.params.grade)),
  handle(async (req, res) => {
    const { year, month } = parseYearMonth(req).data!;
    res.json(await generateMonthPlan(year, month, Number(req.params.grade) as Grade, req.user!.id));
  }),
);

const regenerateSchema = z.object({
  from: dateStringSchema,
  to: dateStringSchema,
  includeModified: z.boolean().optional(),
});

/** POST /api/months/:year/:month/grades/:grade/regenerate — 부분 재편성 (ADMIN, 해당 학년부장). */
monthsRouter.post(
  '/:year/:month/grades/:grade/regenerate',
  validateGradeParams,
  requireGradeScope((req) => Number(req.params.grade)),
  handle(async (req, res) => {
    const { year, month } = parseYearMonth(req).data!;
    const parsed = regenerateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: '재편성 기간(from, to)을 YYYY-MM-DD 형식으로 입력해주세요.' });
    res.json(
      await regenerateMonthPlan(
        year,
        month,
        Number(req.params.grade) as Grade,
        { from: parsed.data.from, to: parsed.data.to, includeModified: parsed.data.includeModified ?? false },
        req.user!,
      ),
    );
  }),
);

/** POST /api/months/:year/:month/grades/:grade/close — 월 마감 (ADMIN, 해당 학년부장). */
monthsRouter.post(
  '/:year/:month/grades/:grade/close',
  validateGradeParams,
  requireGradeScope((req) => Number(req.params.grade)),
  handle(async (req, res) => {
    const { year, month } = parseYearMonth(req).data!;
    res.json(await closeMonthPlan(year, month, Number(req.params.grade) as Grade, req.user!.id));
  }),
);

/** POST /api/months/:year/:month/grades/:grade/reopen — 마감 해제 (ADMIN 전용, PIN 재확인). */
monthsRouter.post(
  '/:year/:month/grades/:grade/reopen',
  validateGradeParams,
  requireAdmin,
  handle(async (req, res) => {
    const { year, month } = parseYearMonth(req).data!;
    const parsed = z.object({ pin: z.string().min(4).max(6) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: '마감 해제를 위해 PIN을 입력해주세요.' });
    res.json(await reopenMonthPlan(year, month, Number(req.params.grade) as Grade, req.user!.id, parsed.data.pin));
  }),
);

/** POST /api/months/:year/:month/grades/:grade/reset — 감독 초기화: 해당 학년 배정 전체 해제 (ADMIN, 해당 학년부장). */
monthsRouter.post(
  '/:year/:month/grades/:grade/reset',
  validateGradeParams,
  requireGradeScope((req) => Number(req.params.grade)),
  handle(async (req, res) => {
    const { year, month } = parseYearMonth(req).data!;
    res.json(await resetMonthPlan(year, month, Number(req.params.grade) as Grade, req.user!.id));
  }),
);

/** POST /api/months/:year/:month/grades/:grade/confirm — 편성 확정 (ADMIN, 해당 학년부장). */
monthsRouter.post(
  '/:year/:month/grades/:grade/confirm',
  validateGradeParams,
  requireGradeScope((req) => Number(req.params.grade)),
  handle(async (req, res) => {
    const { year, month } = parseYearMonth(req).data!;
    res.json(await confirmMonthPlan(year, month, Number(req.params.grade) as Grade, req.user!.id));
  }),
);
