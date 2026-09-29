import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * SQLite DB 파일 위치·백업 파일 관리 (F11).
 * Prisma는 DATABASE_URL의 상대 경로(file:./dev.db)를 schema.prisma가 있는 디렉터리 기준으로 해석한다.
 * 이 파일은 src/lib 또는 dist/lib에 있으므로 두 경우 모두 ../../prisma = server/prisma 이다.
 */
export const PRISMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../prisma');
export const MIGRATIONS_DIR = path.join(PRISMA_DIR, 'migrations');

/** DATABASE_URL('file:...')이 가리키는 SQLite 파일의 절대 경로. */
export function databaseFilePath(databaseUrl = process.env.DATABASE_URL): string {
  if (!databaseUrl?.startsWith('file:')) {
    throw new Error('DATABASE_URL은 file: 로 시작하는 SQLite 경로여야 합니다.');
  }
  const raw = databaseUrl.slice('file:'.length).split('?')[0];
  return path.isAbsolute(raw) ? raw : path.resolve(PRISMA_DIR, raw);
}

/** 복원 대기 파일: 업로드한 백업을 여기에 두고, 다음 시작 때 적용한다. */
export function pendingRestorePath(dbPath = databaseFilePath()): string {
  return path.join(path.dirname(dbPath), 'restore-pending.db');
}

/** 복원 직전 자동 백업을 보관하는 디렉터리. */
export function backupsDir(dbPath = databaseFilePath()): string {
  return path.join(path.dirname(dbPath), 'backups');
}

/** 로컬에 있는 마이그레이션 이름 목록 (백업이 더 최신 버전의 것인지 판단용). */
export function localMigrationNames(): string[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** 'YYYYMMDD-HHmmss' (Asia/Seoul) — 백업 파일 이름용. */
export function timestampForFile(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`;
}

const SIDECARS = ['', '-wal', '-shm', '-journal'];

export type RestoreOutcome = { applied: false } | { applied: true; previousBackup: string | null };

/**
 * 대기 중인 복원 파일이 있으면 적용한다. **DB 연결 전(서버 시작 시)** 에만 호출해야 한다.
 * 1) 현재 DB(+WAL 등 보조 파일)를 backups/before-restore-<시각>.db 로 보관
 * 2) 현재 DB 파일을 지우고 복원 파일로 교체
 * 이후 `prisma migrate deploy`가 오래된 백업을 최신 스키마로 올린다.
 */
export function applyPendingRestore(dbPath = databaseFilePath()): RestoreOutcome {
  const pending = pendingRestorePath(dbPath);
  if (!existsSync(pending)) return { applied: false };

  let previousBackup: string | null = null;
  if (existsSync(dbPath)) {
    const dir = backupsDir(dbPath);
    mkdirSync(dir, { recursive: true });
    previousBackup = path.join(dir, `before-restore-${timestampForFile()}.db`);
    for (const suffix of SIDECARS) {
      if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, previousBackup + suffix);
    }
  }
  for (const suffix of SIDECARS) rmSync(dbPath + suffix, { force: true });
  renameSync(pending, dbPath);
  return { applied: true, previousBackup };
}
