import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../app.js';
import { findTeacherId } from '../test/helpers.js';
import { applyPendingRestore, backupsDir, pendingRestorePath } from '../lib/dbFile.js';

const app = createApp();
const ADMIN_PIN = process.env.ADMIN_INITIAL_PIN!;

async function adminAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ teacherId: await findTeacherId(process.env.ADMIN_NAME!), pin: ADMIN_PIN });
  return agent;
}

/** supertest가 바이너리 응답을 Buffer로 받도록 한다. */
function binaryParser(res: unknown, cb: (err: Error | null, body: Buffer) => void) {
  const stream = res as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (c: Buffer) => chunks.push(c));
  stream.on('end', () => cb(null, Buffer.concat(chunks)));
}

async function downloadBackup(agent: ReturnType<typeof request.agent>): Promise<Buffer> {
  const res = await agent.get('/api/backup').buffer(true).parse(binaryParser);
  expect(res.status).toBe(200);
  return res.body as Buffer;
}

afterEach(() => {
  // 테스트가 만든 복원 대기 파일은 반드시 정리 (test.db와 같은 디렉터리)
  rmSync(pendingRestorePath(), { force: true });
});

describe('로그인 세션 DB 저장', () => {
  it('서버를 새로 만들어도(재시작) 같은 쿠키로 로그인이 유지되고, 로그아웃하면 끊긴다', async () => {
    const login = await request(createApp())
      .post('/api/auth/login')
      .send({ teacherId: await findTeacherId('평교사'), pin: '4444' });
    expect(login.status).toBe(200);
    const setCookie = login.headers['set-cookie'] as unknown as string[];
    const sid = setCookie[0].split(';')[0]; // 'dutycal.sid=...'

    // 메모리 저장소였다면 새 앱(=재시작)에서는 세션이 없어 401
    const restarted = createApp();
    const me = await request(restarted).get('/api/auth/me').set('Cookie', sid);
    expect(me.status).toBe(200);
    expect(me.body.name).toBe('평교사');

    await request(restarted).post('/api/auth/logout').set('Cookie', sid);
    expect((await request(restarted).get('/api/auth/me').set('Cookie', sid)).status).toBe(401);
  });
});

describe('DB 백업/복원 (F11)', () => {
  it('ADMIN은 현재 DB를 SQLite 파일로 내려받을 수 있고, 일반 교사는 403', async () => {
    const admin = await adminAgent();
    const res = await admin.get('/api/backup').buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="dutycal-backup-\d{8}-\d{6}\.db"/);
    expect((res.body as Buffer).subarray(0, 15).toString('latin1')).toBe('SQLite format 3');

    const teacher = request.agent(app);
    await teacher.post('/api/auth/login').send({ teacherId: await findTeacherId('평교사'), pin: '4444' });
    expect((await teacher.get('/api/backup')).status).toBe(403);
  });

  it('복원: PIN 재확인 후 검증된 백업만 대기 상태가 되고, 취소할 수 있다', async () => {
    const admin = await adminAgent();
    const backup = await downloadBackup(admin);
    const upload = (body: Buffer, pin?: string) => {
      const req = admin.post('/api/backup/restore').set('Content-Type', 'application/octet-stream');
      if (pin) req.set('X-Admin-Pin', pin);
      return req.send(body);
    };

    expect((await upload(backup)).status).toBe(401);
    expect((await upload(backup, '0000')).status).toBe(401);
    expect((await upload(Buffer.from('this is not a database file at all, just some text'.repeat(5)), ADMIN_PIN)).status).toBe(400);
    expect(existsSync(pendingRestorePath())).toBe(false);

    const ok = await upload(backup, ADMIN_PIN);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, autoRestart: false, pendingMigrations: 0 });
    expect(ok.body.teachers).toBeGreaterThan(0);
    expect(existsSync(pendingRestorePath())).toBe(true);
    expect((await admin.get('/api/backup/restore')).body.pendingRestore).toBe(true);

    // 백업 안의 로그인 세션은 제거되어 복원 후 모두 다시 로그인해야 한다 (현재 세션은 백업에 들어 있었음)
    const staged = new PrismaClient({ datasourceUrl: `file:${pendingRestorePath()}` });
    const sessions = await staged.$queryRawUnsafe<{ n: bigint }[]>('SELECT COUNT(*) AS n FROM Session');
    await staged.$disconnect();
    expect(Number(sessions[0].n)).toBe(0);

    expect((await admin.delete('/api/backup/restore')).status).toBe(200);
    expect(existsSync(pendingRestorePath())).toBe(false);
    expect((await admin.get('/api/backup/restore')).body.pendingRestore).toBe(false);
  });

  it('더 최신 버전(모르는 마이그레이션)에서 만든 백업은 거부한다', async () => {
    const admin = await adminAgent();
    const backup = await downloadBackup(admin);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dutycal-test-'));
    const file = path.join(dir, 'future.db');
    writeFileSync(file, backup);
    const client = new PrismaClient({ datasourceUrl: `file:${file}` });
    await client.$executeRawUnsafe(
      "INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ('x', 'x', '29990101000000_future', 0, 0, 1)",
    );
    await client.$disconnect();

    const res = await admin
      .post('/api/backup/restore')
      .set('Content-Type', 'application/octet-stream')
      .set('X-Admin-Pin', ADMIN_PIN)
      .send(readFileSync(file));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('최신 버전');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('복원 적용 (서버 시작 시)', () => {
  it('대기 파일이 있으면 현재 DB(+WAL)를 backups에 보관하고 교체한다', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dutycal-apply-'));
    const db = path.join(dir, 'dutycal.db');
    writeFileSync(db, 'CURRENT');
    writeFileSync(`${db}-wal`, 'CURRENT-WAL');
    expect(applyPendingRestore(db)).toEqual({ applied: false });

    writeFileSync(pendingRestorePath(db), 'RESTORED');
    const result = applyPendingRestore(db);
    expect(result.applied).toBe(true);
    if (!result.applied) return;

    expect(readFileSync(db, 'utf8')).toBe('RESTORED');
    expect(existsSync(`${db}-wal`)).toBe(false);
    expect(existsSync(pendingRestorePath(db))).toBe(false);
    expect(result.previousBackup).toMatch(/before-restore-\d{8}-\d{6}\.db$/);
    expect(path.dirname(result.previousBackup!)).toBe(backupsDir(db));
    expect(readFileSync(result.previousBackup!, 'utf8')).toBe('CURRENT');
    expect(readFileSync(`${result.previousBackup}-wal`, 'utf8')).toBe('CURRENT-WAL');
    rmSync(dir, { recursive: true, force: true });
  });
});
