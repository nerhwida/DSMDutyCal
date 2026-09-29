import { execSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

// 테스트 전용 SQLite DB (server/prisma/test.db). 개발용 dev.db와 절대 공유하지 않는다.
// 아래 상수는 vitest.config.ts의 test.env 값과 반드시 일치해야 한다.
// (globalSetup은 워커 프로세스보다 먼저/별도로 실행되어 test.env가 process.env에
//  반영되어 있음을 보장할 수 없으므로, 여기서는 하드코딩된 리터럴을 사용한다.)
const TEST_DB_PATH = path.resolve(import.meta.dirname, '../../prisma/test.db');
const DATABASE_URL = 'file:./test.db';
const ADMIN_NAME = '테스트관리자';
const ADMIN_INITIAL_PIN = '9999';

export default async function setup() {
  process.env.DATABASE_URL = DATABASE_URL;

  removeTestDb();

  // 실제 마이그레이션을 빈 DB에 적용한다. 운영 DB와 같은 구조(_prisma_migrations 포함)가 되어
  // 백업/복원 검증을 테스트할 수 있고, 마이그레이션 자체도 매번 검증된다.
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: { ...process.env, DATABASE_URL },
    stdio: 'inherit',
  });

  await seedFixtures();

  return async () => {
    removeTestDb();
  };
}

/** test.db와 WAL 보조 파일(-wal, -shm)을 함께 지운다. */
function removeTestDb() {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const file = `${TEST_DB_PATH}${suffix}`;
    if (existsSync(file)) unlinkSync(file);
  }
}

/** 통합 테스트에서 공통으로 사용하는 기본 픽스처. */
async function seedFixtures() {
  const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
  try {
    // WAL 모드(DB 파일에 영구 저장됨): 기본 journal_mode=delete는 트랜잭션마다 저널 파일을
    // 만들고 지우는데, Windows에서 백신 검사와 겹치면 쓰기 1건이 수 초씩 걸려 테스트가 타임아웃된다.
    await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL;');

    const pinHash = (pin: string) => bcrypt.hashSync(pin, 10);

    await prisma.teacher.create({
      data: {
        name: ADMIN_NAME,
        pinHash: pinHash(ADMIN_INITIAL_PIN),
        isAdmin: true,
        mustChangePin: false,
        active: true,
        sortOrder: 0,
      },
    });

    const grade1Head = await prisma.teacher.create({
      data: { name: '1학년부장', pinHash: pinHash('1111'), active: true, sortOrder: 1 },
    });
    const grade2Head = await prisma.teacher.create({
      data: { name: '2학년부장', pinHash: pinHash('2222'), active: true, sortOrder: 2 },
    });
    await prisma.teacher.create({
      data: { name: '3학년부장', pinHash: pinHash('3333'), active: true, sortOrder: 3 },
    });
    await prisma.teacher.create({
      data: { name: '평교사', pinHash: pinHash('4444'), active: true, sortOrder: 4 },
    });
    await prisma.teacher.create({
      data: { name: '비활성교사', pinHash: pinHash('5555'), active: false, sortOrder: 5 },
    });

    await prisma.gradeHead.create({ data: { grade: 1, teacherId: grade1Head.id } });
    await prisma.gradeHead.create({ data: { grade: 2, teacherId: grade2Head.id } });
  } finally {
    await prisma.$disconnect();
  }
}
