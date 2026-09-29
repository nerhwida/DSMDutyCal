import 'dotenv/config';
import { createApp } from './app.js';
import { ensureBootstrapAdmin } from './auth/authService.js';
import { applyPendingRestore } from './lib/dbFile.js';
import { prisma } from './lib/prisma.js';
import { startMonthlyBackupScheduler } from './services/backupService.js';

const PORT = Number(process.env.PORT ?? '4000');

async function main() {
  // F11: 대기 중인 복원 파일은 DB에 연결하기 전에 적용한다.
  // (Docker에서는 entrypoint의 prestart가 먼저 적용하고 마이그레이션까지 실행하므로 여기서는 보통 할 일이 없다.)
  const restore = applyPendingRestore();
  if (restore.applied) {
    // eslint-disable-next-line no-console
    console.log(
      `[restore] 백업을 복원했습니다. 이전 DB: ${restore.previousBackup ?? '(없음)'}\n` +
        '[restore] 개발 환경이라면 server/에서 npx prisma migrate deploy 를 실행해 스키마를 최신으로 맞추세요.',
    );
  }

  // WAL 모드: 읽기와 쓰기가 서로 막지 않고, Windows에서 쓰기 지연이 크게 줄어든다 (DB 파일에 영구 저장).
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL;');
  await ensureBootstrapAdmin();

  // F11: 월초 자동 백업 (시작 시 1회 + 매시간 확인, 이번 달 몫이 없으면 전월 기준으로 생성)
  startMonthlyBackupScheduler();

  const app = createApp();
  const server = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] DutyCal API listening on http://localhost:${PORT}`);
  });

  // docker stop 등 종료 신호: 연결을 닫아 WAL 내용을 DB 파일에 반영하고 종료한다.
  const shutdown = (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`[server] ${signal} 수신, 종료합니다.`);
    server.close(() => {
      prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[server] 서버 시작 실패:', err);
  process.exit(1);
});
