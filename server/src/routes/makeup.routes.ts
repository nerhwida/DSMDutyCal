import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handle } from '../lib/http.js';
import { dateStringSchema } from '../lib/validation.js';
import { requireAuth } from '../permissions/middleware.js';
import type { AuthenticatedUser } from '../auth/authService.js';

/**
 * 방과후 보강 화면 (모든 교사).
 * - records: 방과후 휴강·자습 현황 (날짜/강좌명/강좌 담당 교사명/인원/자습 장소/비고)
 * - notes: 보강 계획 시 참고 사항 (한 줄 글)
 * 로그인한 교사는 누구나 등록할 수 있고, 수정·삭제는 작성자 본인과 ADMIN·학년부장만 할 수 있다.
 */
export const makeupRouter = Router();
makeupRouter.use(requireAuth);

const canEdit = (user: AuthenticatedUser, createdById: number | null) =>
  user.gradeHeadOf.length > 0 || createdById === user.id;

const text = (label: string, max: number) =>
  z.string().trim().min(1, `${label}을(를) 입력해주세요.`).max(max, `${label}은(는) ${max}자 이내로 입력해주세요.`);

const recordSchema = z.object({
  date: dateStringSchema,
  courseName: text('강좌명', 100),
  instructorName: text('담당교사', 50),
  studentCount: z
    .number({ required_error: '인원을 입력해주세요.', invalid_type_error: '인원을 숫자로 입력해주세요.' })
    .int('인원을 올바르게 입력해주세요.')
    .min(0, '인원을 올바르게 입력해주세요.')
    .max(999, '인원을 올바르게 입력해주세요.'),
  studyRoom: text('자습 장소', 50),
  note: z
    .string()
    .trim()
    .max(200, '비고는 200자 이내로 입력해주세요.')
    .optional()
    .transform((v) => v || null),
});

const noteSchema = z.object({ content: text('내용', 500) });

const idOf = (req: Request) => Number(req.params.id);

// ---------------------------------------------------------------------------
// 방과후 휴강·자습 현황
// ---------------------------------------------------------------------------

/** GET /api/makeup/records — 전체 목록 (날짜순). */
makeupRouter.get(
  '/records',
  handle(async (req, res) => {
    const rows = await prisma.afterSchoolRecord.findMany({
      include: { createdBy: { select: { name: true } } },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    res.json(
      rows.map(({ createdBy, ...r }) => ({
        ...r,
        createdByName: createdBy?.name ?? null,
        canEdit: canEdit(req.user!, r.createdById),
      })),
    );
  }),
);

/** POST /api/makeup/records — 등록 (로그인한 교사 누구나). */
makeupRouter.post(
  '/records',
  handle(async (req, res) => {
    const parsed = recordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' });
    const created = await prisma.afterSchoolRecord.create({ data: { ...parsed.data, createdById: req.user!.id } });
    res.status(201).json(created);
  }),
);

/** PUT /api/makeup/records/:id — 수정 (작성자, ADMIN·학년부장). */
makeupRouter.put(
  '/records/:id',
  handle(async (req, res) => {
    const record = await prisma.afterSchoolRecord.findUnique({ where: { id: idOf(req) } });
    if (!record) return res.status(404).json({ error: '해당 기록을 찾을 수 없습니다.' });
    if (!canEdit(req.user!, record.createdById)) return res.status(403).json({ error: '작성자 또는 관리자·학년부장만 수정할 수 있습니다.' });
    const parsed = recordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' });
    res.json(await prisma.afterSchoolRecord.update({ where: { id: record.id }, data: parsed.data }));
  }),
);

/** DELETE /api/makeup/records/:id — 삭제 (작성자, ADMIN·학년부장). */
makeupRouter.delete(
  '/records/:id',
  handle(async (req, res) => {
    const record = await prisma.afterSchoolRecord.findUnique({ where: { id: idOf(req) } });
    if (!record) return res.status(404).json({ error: '해당 기록을 찾을 수 없습니다.' });
    if (!canEdit(req.user!, record.createdById)) return res.status(403).json({ error: '작성자 또는 관리자·학년부장만 삭제할 수 있습니다.' });
    await prisma.afterSchoolRecord.delete({ where: { id: record.id } });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// 보강 계획 시 참고 사항
// ---------------------------------------------------------------------------

/** GET /api/makeup/notes — 전체 목록 (등록순). */
makeupRouter.get(
  '/notes',
  handle(async (req, res) => {
    const rows = await prisma.makeupNote.findMany({
      include: { createdBy: { select: { name: true } } },
      orderBy: { id: 'asc' },
    });
    res.json(
      rows.map(({ createdBy, ...n }) => ({
        ...n,
        createdByName: createdBy?.name ?? null,
        canEdit: canEdit(req.user!, n.createdById),
      })),
    );
  }),
);

/** POST /api/makeup/notes — 등록 (로그인한 교사 누구나). */
makeupRouter.post(
  '/notes',
  handle(async (req, res) => {
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '내용을 입력해주세요.' });
    const created = await prisma.makeupNote.create({ data: { content: parsed.data.content, createdById: req.user!.id } });
    res.status(201).json(created);
  }),
);

/** PUT /api/makeup/notes/:id — 수정 (작성자, ADMIN·학년부장). */
makeupRouter.put(
  '/notes/:id',
  handle(async (req, res) => {
    const note = await prisma.makeupNote.findUnique({ where: { id: idOf(req) } });
    if (!note) return res.status(404).json({ error: '해당 글을 찾을 수 없습니다.' });
    if (!canEdit(req.user!, note.createdById)) return res.status(403).json({ error: '작성자 또는 관리자·학년부장만 수정할 수 있습니다.' });
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '내용을 입력해주세요.' });
    res.json(await prisma.makeupNote.update({ where: { id: note.id }, data: { content: parsed.data.content } }));
  }),
);

/** DELETE /api/makeup/notes/:id — 삭제 (작성자, ADMIN·학년부장). */
makeupRouter.delete(
  '/notes/:id',
  handle(async (req, res) => {
    const note = await prisma.makeupNote.findUnique({ where: { id: idOf(req) } });
    if (!note) return res.status(404).json({ error: '해당 글을 찾을 수 없습니다.' });
    if (!canEdit(req.user!, note.createdById)) return res.status(403).json({ error: '작성자 또는 관리자·학년부장만 삭제할 수 있습니다.' });
    await prisma.makeupNote.delete({ where: { id: note.id } });
    res.json({ ok: true });
  }),
);
