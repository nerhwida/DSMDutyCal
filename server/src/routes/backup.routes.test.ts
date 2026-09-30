import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../app.js';
import { findTeacherId, loginBody } from '../test/helpers.js';
import { prisma } from '../lib/prisma.js';
import { applyPendingRestore, backupsDir, monthlyBackupsDir, pendingRestorePath } from '../lib/dbFile.js';
import {
  ensureMonthlyBackup,
  listMonthlyBackups,
  previousMonthLabel,
  pruneMonthlyBackups,
} from '../services/backupService.js';

const app = createApp();
const ADMIN_PIN = process.env.ADMIN_INITIAL_PIN!;

async function adminAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send(await loginBody(await findTeacherId(process.env.ADMIN_NAME!), ADMIN_PIN));
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
      .send(await loginBody(await findTeacherId('평교사'), '4444'));
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
    await teacher.post('/api/auth/login').send(await loginBody(await findTeacherId('평교사'), '4444'));
    expect((await teacher.get('/api/backup')).status).toBe(403);
  });

  it('백업 파일에는 로그인 세션이 없다 (행은 물론 파일 바이트에도 세션 ID가 남지 않는다)', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send(await loginBody(await findTeacherId(process.env.ADMIN_NAME!), ADMIN_PIN));
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    // 서명 쿠키 'dutycal.sid=s:<sid>.<서명>' 에서 sid만 꺼낸다
    const signed = decodeURIComponent(cookie.slice('dutycal.sid='.length));
    const sid = signed.slice(2, signed.lastIndexOf('.'));
    expect(await prisma.session.count({ where: { sid } })).toBe(1); // 운영 DB에는 세션이 있다

    const res = await request(app).get('/api/backup').set('Cookie', cookie).buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    const backup = res.body as Buffer;
    expect(backup.includes(Buffer.from(sid))).toBe(false);

    const dir = mkdtempSync(path.join(os.tmpdir(), 'dutycal-test-'));
    const file = path.join(dir, 'backup.db');
    writeFileSync(file, backup);
    const client = new PrismaClient({ datasourceUrl: `file:${file}` });
    const rows = await client.$queryRawUnsafe<{ n: bigint }[]>('SELECT COUNT(*) AS n FROM Session');
    await client.$disconnect();
    expect(Number(rows[0].n)).toBe(0);
    rmSync(dir, { recursive: true, force: true });
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

describe('월초 자동 백업', () => {
  // test.db와 dev.db가 같은 server/prisma 폴더를 쓰므로 backups/monthly도 공유된다.
  // 개발 중 생긴 실제 자동 백업을 건드리지 않도록 먼 미래·과거 월만 쓰고, 만든 파일만 지운다.
  const created: string[] = [];
  afterEach(() => {
    for (const name of created.splice(0)) rmSync(path.join(monthlyBackupsDir(), name), { force: true });
  });

  it('전월 라벨은 Asia/Seoul 기준이다', () => {
    expect(previousMonthLabel(new Date('2026-10-01T00:30:00+09:00'))).toBe('2026-09');
    expect(previousMonthLabel(new Date('2026-09-30T16:00:00Z'))).toBe('2026-09'); // 한국 10/1 01:00
    expect(previousMonthLabel(new Date('2027-01-05T12:00:00+09:00'))).toBe('2026-12');
  });

  it('이번 달 몫이 없으면 전월 기준 백업을 만들고, 이미 있으면 다시 만들지 않는다', async () => {
    const now = new Date('2099-03-01T09:00:00+09:00');
    const file = await ensureMonthlyBackup(now, 1000);
    created.push('monthly-2099-02.db');
    expect(file).toMatch(/monthly-2099-02\.db$/);
    expect(readFileSync(file!).subarray(0, 15).toString('latin1')).toBe('SQLite format 3');
    expect(existsSync(`${file}.tmp`)).toBe(false);
    const client = new PrismaClient({ datasourceUrl: `file:${file}` });
    const rows = await client.$queryRawUnsafe<{ n: bigint }[]>('SELECT COUNT(*) AS n FROM Session');
    await client.$disconnect();
    expect(Number(rows[0].n)).toBe(0); // 자동 백업에도 세션 없음

    expect(await ensureMonthlyBackup(new Date('2099-03-20T09:00:00+09:00'), 1000)).toBeNull();
  });

  it('보관 개수를 넘으면 오래된 월부터 지운다', () => {
    const dir = monthlyBackupsDir();
    mkdirSync(dir, { recursive: true });
    const fakes = ['2001-01', '2001-02', '2001-03'].map((m) => `monthly-${m}.db`);
    for (const name of fakes) {
      writeFileSync(path.join(dir, name), 'x');
      created.push(name);
    }
    const total = listMonthlyBackups().length;
    const removed = pruneMonthlyBackups(total - 2);
    expect(removed.sort()).toEqual(['monthly-2001-01.db', 'monthly-2001-02.db']);
    expect(existsSync(path.join(dir, 'monthly-2001-03.db'))).toBe(true);
  });

  it('ADMIN은 목록을 보고 내려받을 수 있고, 잘못된 파일 이름은 거부된다', async () => {
    await ensureMonthlyBackup(new Date('2098-07-01T09:00:00+09:00'), 1000);
    created.push('monthly-2098-06.db');
    const admin = await adminAgent();

    const list = await admin.get('/api/backup/monthly');
    expect(list.status).toBe(200);
    const item = list.body.find((b: { fileName: string }) => b.fileName === 'monthly-2098-06.db');
    expect(item).toMatchObject({ month: '2098-06' });
    expect(item.size).toBeGreaterThan(0);

    const dl = await admin.get('/api/backup/monthly/monthly-2098-06.db').buffer(true).parse(binaryParser);
    expect(dl.status).toBe(200);
    expect((dl.body as Buffer).subarray(0, 15).toString('latin1')).toBe('SQLite format 3');

    expect((await admin.get('/api/backup/monthly/..%2F..%2Fdev.db')).status).toBe(400);
    expect((await admin.get('/api/backup/monthly/monthly-1999-01.db')).status).toBe(404);

    const teacher = request.agent(app);
    await teacher.post('/api/auth/login').send(await loginBody(await findTeacherId('평교사'), '4444'));
    expect((await teacher.get('/api/backup/monthly')).status).toBe(403);
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
