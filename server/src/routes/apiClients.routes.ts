import { Router } from 'express';
import { z } from 'zod';
import { handle } from '../lib/http.js';
import { requireAdmin, requireAuth } from '../permissions/middleware.js';
import {
  createApiClient,
  deleteApiClient,
  listApiClients,
  regenerateApiKey,
  updateApiClient,
} from '../services/apiClientService.js';

/** API 연동 계정 관리 (ADMIN 전용). */
export const apiClientsRouter = Router();
apiClientsRouter.use(requireAuth, requireAdmin);

const nameSchema = z.string().trim().min(1, '연동 계정 이름을 입력해주세요.').max(50);

/** GET /api/api-clients — 연동 계정 목록 (키 원문·해시는 내려주지 않음). */
apiClientsRouter.get(
  '/',
  handle(async (_req, res) => {
    res.json(await listApiClients());
  }),
);

/** POST /api/api-clients — 연동 계정 생성. 응답의 key는 이때 한 번만 확인할 수 있다. */
apiClientsRouter.post(
  '/',
  handle(async (req, res) => {
    const parsed = z.object({ name: nameSchema }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' });
    res.status(201).json(await createApiClient(parsed.data.name, req.user!.id));
  }),
);

/** POST /api/api-clients/:id/regenerate — 키 재발급 (기존 키 즉시 무효). */
apiClientsRouter.post(
  '/:id/regenerate',
  handle(async (req, res) => {
    res.json(await regenerateApiKey(Number(req.params.id), req.user!.id));
  }),
);

/** PUT /api/api-clients/:id — 이름 변경·활성/비활성. */
apiClientsRouter.put(
  '/:id',
  handle(async (req, res) => {
    const parsed = z.object({ name: nameSchema.optional(), active: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: '입력값이 올바르지 않습니다.' });
    res.json(await updateApiClient(Number(req.params.id), parsed.data, req.user!.id));
  }),
);

/** DELETE /api/api-clients/:id — 연동 계정 삭제. */
apiClientsRouter.delete(
  '/:id',
  handle(async (req, res) => {
    await deleteApiClient(Number(req.params.id), req.user!.id);
    res.json({ ok: true });
  }),
);
