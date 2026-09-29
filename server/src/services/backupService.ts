import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { recordAudit } from '../lib/audit.js';
import { localMigrationNames, pendingRestorePath, timestampForFile } from '../lib/dbFile.js';
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
