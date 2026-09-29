import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { recordAudit } from '../lib/audit.js';
import { localMigrationNames, monthlyBackupsDir, pendingRestorePath, timestampForFile } from '../lib/dbFile.js';
import { ServiceError } from './schedulerService.js';

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');
const REQUIRED_TABLES = ['Teacher', 'Assignment', 'MonthPlan', 'SpecialDay', '_prisma_migrations'];

const tempFile = (prefix: string) => path.join(os.tmpdir(), `dutycal-${prefix}-${randomUUID()}.db`);
const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * 현재 DB의 일관된 스냅샷을 만든다 (서비스 중에도 안전: SQLite VACUUM INTO).
 * 반환된 파일은 호출자가 전송 후 삭제한다.
 */
export async function createBackupFile(actorId: number): Promise<{ filePath: string; fileName: string }> {
  const filePath = tempFile('backup');
  await prisma.$executeRawUnsafe(`VACUUM INTO ${sqlString(filePath)}`);
  await recordAudit(actorId, 'BACKUP', { size: statSync(filePath).size });
  return { filePath, fileName: `dutycal-backup-${timestampForFile()}.db` };
}

// ---------------------------------------------------------------------------
// 월초 자동 백업: 매달 1일(이후 처음 확인할 때) 전월 기준 스냅샷을 backups/monthly에 남긴다.
// ---------------------------------------------------------------------------

const MONTHLY_FILE = /^monthly-(\d{4})-(\d{2})\.db$/;
const DEFAULT_KEEP = 24;

/** Asia/Seoul 기준 전월 'YYYY-MM' (백업 파일 이름에 쓰는 "대상 월"). */
export function previousMonthLabel(now = new Date()): string {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' })
    .format(now)
    .split('-')
    .map(Number);
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return `${prev.y}-${String(prev.m).padStart(2, '0')}`;
}

function keepCount(): number {
  const n = Number(process.env.AUTO_BACKUP_KEEP ?? DEFAULT_KEEP);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_KEEP;
}

/**
 * 이번 달 몫(전월 기준) 자동 백업이 없으면 만든다. 이미 있으면 null.
 * 서버가 매달 1일에 꺼져 있었더라도 켜진 뒤 처음 확인할 때 만든다.
 */
export async function ensureMonthlyBackup(now = new Date(), keep = keepCount()): Promise<string | null> {
  const dir = monthlyBackupsDir();
  const file = path.join(dir, `monthly-${previousMonthLabel(now)}.db`);
  if (existsSync(file)) return null;

  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  rmSync(tmp, { force: true });
  await prisma.$executeRawUnsafe(`VACUUM INTO ${sqlString(tmp)}`);
  renameSync(tmp, file); // 완성된 파일만 목록에 보이도록
  pruneMonthlyBackups(keep);
  return file;
}

/** 최근 keep개월분만 남기고 오래된 자동 백업을 지운다. */
export function pruneMonthlyBackups(keep = keepCount()): string[] {
  const files = listMonthlyBackups().map((b) => b.fileName); // 최신순
  const removed = files.slice(Math.max(1, keep));
  for (const name of removed) rmSync(path.join(monthlyBackupsDir(), name), { force: true });
  return removed;
}

/** 자동 백업 목록 (최신 월부터). */
export function listMonthlyBackups() {
  const dir = monthlyBackupsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => MONTHLY_FILE.test(name))
    .sort()
    .reverse()
    .map((fileName) => {
      const stat = statSync(path.join(dir, fileName));
      return { fileName, month: fileName.slice('monthly-'.length, -'.db'.length), size: stat.size, createdAt: stat.mtime.toISOString() };
    });
}

/** 다운로드할 자동 백업 파일 경로 (파일 이름 형식 검증으로 경로 조작 차단). */
export function monthlyBackupPath(fileName: string): string {
  if (!MONTHLY_FILE.test(fileName)) throw new ServiceError(400, '자동 백업 파일 이름이 올바르지 않습니다.');
  const file = path.join(monthlyBackupsDir(), fileName);
  if (!existsSync(file)) throw new ServiceError(404, '해당 자동 백업이 없습니다.');
  return file;
}

/**
 * 서버 시작 시 1회 + 매시간 확인한다. 실패해도 서버는 계속 동작한다 (로그만 남김).
 */
export function startMonthlyBackupScheduler(intervalMs = 60 * 60 * 1000) {
  const run = async () => {
    try {
      const file = await ensureMonthlyBackup();
      if (file) {
        // eslint-disable-next-line no-console
        console.log(`[auto-backup] 월간 백업 생성: ${file}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[auto-backup] 월간 백업 실패:', err);
    }
  };
  void run();
  return setInterval(run, intervalMs).unref();
}

/**
 * 업로드된 백업 파일을 검증하고 복원 대기 파일로 둔다. 실제 교체는 다음 서버 시작 때 이뤄진다
 * (applyPendingRestore → prisma migrate deploy). 사용 중인 DB 파일을 실행 중에 바꾸지 않기 위해서다.
 */
export async function stageRestore(buffer: Buffer, actorId: number) {
  if (buffer.length < 100 || !buffer.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
    throw new ServiceError(400, 'DutyCal 백업 파일(SQLite DB)이 아닙니다.');
  }

  const candidate = tempFile('restore');
  writeFileSync(candidate, buffer);
  const client = new PrismaClient({ datasourceUrl: `file:${candidate}` });
  try {
    let tables: string[];
    let migrations: string[];
    try {
      tables = (await client.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type='table'")).map(
        (r) => r.name,
      );
      const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
      if (missing.length > 0) throw new ServiceError(400, `DutyCal 백업 파일이 아닙니다. (없는 테이블: ${missing.join(', ')})`);
      migrations = (
        await client.$queryRawUnsafe<{ migration_name: string }[]>(
          'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
        )
      ).map((r) => r.migration_name);
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError(400, '백업 파일을 읽을 수 없습니다. 손상되었거나 DutyCal 백업이 아닙니다.');
    }

    const known = new Set(localMigrationNames());
    const unknown = migrations.filter((m) => !known.has(m));
    if (unknown.length > 0) {
      throw new ServiceError(400, `현재 프로그램보다 최신 버전에서 만든 백업이라 복원할 수 없습니다. 프로그램을 먼저 업데이트해주세요. (${unknown.join(', ')})`);
    }

    const counts = await client.$queryRawUnsafe<{ teachers: bigint; assignments: bigint }[]>(
      'SELECT (SELECT COUNT(*) FROM Teacher) AS teachers, (SELECT COUNT(*) FROM Assignment) AS assignments',
    );
    // 백업에 들어 있는 로그인 세션은 지운다. 오래된 백업을 복원했을 때 이미 로그아웃한 세션이
    // 되살아나지 않도록, 복원 후에는 모두 다시 로그인하게 한다.
    if (tables.includes('Session')) await client.$executeRawUnsafe('DELETE FROM Session');
    await client.$disconnect();

    copyFileSync(candidate, pendingRestorePath());
    await recordAudit(actorId, 'RESTORE_STAGED', { size: buffer.length, migrations: migrations.length });
    return {
      teachers: Number(counts[0].teachers),
      assignments: Number(counts[0].assignments),
      migrations: migrations.length,
      pendingMigrations: localMigrationNames().length - migrations.length,
    };
  } finally {
    await client.$disconnect().catch(() => undefined);
    rmSync(candidate, { force: true });
  }
}

export function restoreStatus() {
  const pending = pendingRestorePath();
  if (!existsSync(pending)) return { pendingRestore: false as const };
  const stat = statSync(pending);
  return { pendingRestore: true as const, stagedAt: stat.mtime.toISOString(), size: stat.size };
}

export async function cancelRestore(actorId: number) {
  const pending = pendingRestorePath();
  if (!existsSync(pending)) throw new ServiceError(404, '대기 중인 복원이 없습니다.');
  rmSync(pending, { force: true });
  await recordAudit(actorId, 'RESTORE_CANCELLED', {});
}
