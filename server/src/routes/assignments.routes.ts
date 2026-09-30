import { Router } from 'express';
import { z } from 'zod';
import { handle } from '../lib/http.js';
import { dateStringSchema, gradeSchema } from '../lib/validation.js';
import { requireAuth, requireOwnAssignment } from '../permissions/middleware.js';
import {
  changeAssignment,
  fillAssignment,
  getCandidates,
  getCellCandidates,
  swapAssignments,
  transferAssignment,
  transferPreview,
} from '../services/assignmentService.js';

export const assignmentsRouter = Router();

assignmentsRouter.use(requireAuth);

const noteSchema = z.string().max(200).optional();

const swapSchema = z.object({
  myAssignmentId: z.number().int(),
  targetAssignmentId: z.number().int(),
  confirmWarnings: z.boolean().optional(),
  note: noteSchema,
});

/** POST /api/assignments/swap — 맞교환 (myAssignment 소유자). */
assignmentsRouter.post(
  '/swap',
  requireOwnAssignment((req) => swapSchema.safeParse(req.body).data?.myAssignmentId),
  handle(async (req, res) => {
    const parsed = swapSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: '입력값이 올바르지 않습니다.' });
    res.json(await swapAssignments(parsed.data, req.user!));
  }),
);

/** GET /api/assignments/candidates?date=&grade= — 미배정 칸 채우기용 교사 목록 (ADMIN, 해당 학년부장). */
assignmentsRouter.get(
  '/candidates',
  handle(async (req, res) => {
    const parsed = z.object({ date: dateStringSchema, grade: z.coerce.number().pipe(gradeSchema) }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: '날짜·학년 정보가 올바르지 않습니다.' });
    res.json(await getCellCandidates(parsed.data.date, parsed.data.grade, req.user!));
  }),
);

const fillSchema = z.object({
  date: dateStringSchema,
  grade: gradeSchema,
  teacherId: z.number().int(),
  force: z.boolean().optional(),
  note: noteSchema,
});

/** POST /api/assignments — 미배정 칸 직접 지정 (ADMIN, 해당 학년부장). */
assignmentsRouter.post(
  '/',
  handle(async (req, res) => {
    const parsed = fillSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: '입력값이 올바르지 않습니다.' });
    res.status(201).json(await fillAssignment(parsed.data, req.user!));
  }),
);

/** GET /api/assignments/:id/candidates — 변경 가능 교사 + 불가 사유 (수정 권한자·본인). */
assignmentsRouter.get(
  '/:id/candidates',
  handle(async (req, res) => {
    res.json(await getCandidates(Number(req.params.id), req.user!));
  }),
);

const changeSchema = z.object({
  teacherId: z.number().int(),
  note: noteSchema,
  force: z.boolean().optional(),
});

/** PUT /api/assignments/:id — 관리 목적 감독 변경 (ADMIN, 해당 학년부장). 학년 권한은 서비스에서 배정의 학년으로 검사. */
assignmentsRouter.put(
  '/:id',
  handle(async (req, res) => {
    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: '입력값이 올바르지 않습니다.' });
    res.json(await changeAssignment(Number(req.params.id), parsed.data, req.user!));
  }),
);

/** GET /api/assignments/:id/transfer-preview?toTeacherId= — 넘기기 경고 사항 (본인). */
assignmentsRouter.get(
  '/:id/transfer-preview',
  requireOwnAssignment((req) => Number(req.params.id)),
  handle(async (req, res) => {
    const toTeacherId = Number(req.query.toTeacherId);
    if (!Number.isInteger(toTeacherId)) return res.status(400).json({ error: '대상 교사를 선택해주세요.' });
    res.json(await transferPreview(Number(req.params.id), toTeacherId));
  }),
);

const transferSchema = z.object({
  toTeacherId: z.number().int(),
  confirmWarnings: z.boolean().optional(),
  note: noteSchema,
});

/** POST /api/assignments/:id/transfer — 넘기기 (본인). */
assignmentsRouter.post(
  '/:id/transfer',
  requireOwnAssignment((req) => Number(req.params.id)),
  handle(async (req, res) => {
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: '입력값이 올바르지 않습니다.' });
    res.json(await transferAssignment(Number(req.params.id), parsed.data, req.user!));
  }),
);
