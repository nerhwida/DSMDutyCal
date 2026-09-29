import { rmSync } from 'node:fs';
import express, { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { handle } from '../lib/http.js';
import { verifyPin } from '../auth/pin.js';
import { requireAdmin, requireAuth } from '../permissions/middleware.js';
import { cancelRestore, createBackupFile, restoreStatus, stageRestore } from '../services/backupService.js';

/** DB 백업/복원 (F11, ADMIN 전용). */
export const backupRouter = Router();
backupRouter.use(requireAuth, requireAdmin);

const MAX_UPLOAD = '200mb';

/** GET /api/backup — 현재 DB 스냅샷 다운로드. */
backupRouter.get(
  '/',
  handle(async (req, res) => {
    const { filePath, fileName } = await createBackupFile(req.user!.id);
    res.download(filePath, fileName, () => rmSync(filePath, { force: true }));
  }),
);

/** GET /api/backup/restore — 복원 대기 상태. */
backupRouter.get('/restore', (_req, res) => {
  res.json(restoreStatus());
});

/**
 * POST /api/backup/restore — 백업 파일 업로드(본문 = DB 파일, application/octet-stream).
 * 헤더 X-Admin-Pin으로 본인 PIN을 다시 확인한다. 검증 후 복원 대기 상태가 되고, 서버 재시작 시 적용된다.
 * RESTART_ON_RESTORE=true(Docker)이면 응답 후 서버가 스스로 종료하고, 재시작 정책으로 다시 올라오며 적용된다.
 */
backupRouter.post(
  '/restore',
  express.raw({ type: 'application/octet-stream', limit: MAX_UPLOAD }),
  handle(async (req, res) => {
    const pin = req.header('x-admin-pin');
    const actor = await prisma.teacher.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!pin || !(await verifyPin(pin, actor.pinHash))) {
      return res.status(401).json({ error: 'PIN이 올바르지 않습니다.' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: '백업 파일을 선택해주세요.' });
    }

    const summary = await stageRestore(req.body, req.user!.id);
    const autoRestart = process.env.RESTART_ON_RESTORE === 'true';
    res.json({ ok: true, ...summary, autoRestart });

    if (autoRestart) {
      res.on('finish', () => {
        // eslint-disable-next-line no-console
        console.log('[restore] 복원 파일이 준비되어 서버를 재시작합니다.');
        setTimeout(() => process.exit(0), 500);
      });
    }
  }),
);

/** DELETE /api/backup/restore — 대기 중인 복원 취소. */
backupRouter.delete(
  '/restore',
  handle(async (req, res) => {
    await cancelRestore(req.user!.id);
    res.json({ ok: true });
  }),
);
