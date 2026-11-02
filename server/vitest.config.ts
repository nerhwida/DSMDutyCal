import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    globalSetup: ['./src/test/globalSetup.ts'],
    // 모든 테스트 파일이 동일한 SQLite 테스트 DB(test.db) 파일을 공유하므로,
    // 파일 간 병렬 실행 시 "database is locked" 타임아웃이 발생한다. 순차 실행으로 고정한다.
    fileParallelism: false,
    env: {
      DATABASE_URL: 'file:./test.db',
      SESSION_SECRET: 'test-session-secret',
      SESSION_HOURS: '8',
      LOGIN_MAX_ATTEMPTS: '5',
      LOGIN_LOCKOUT_MINUTES: '5',
      ADMIN_NAME: '테스트관리자',
      ADMIN_INITIAL_PIN: '9999',
      CLIENT_ORIGIN: 'http://localhost:5173',
      // 대부분의 테스트는 이메일 미등록 교사로 PIN 로그인한다. 동의 필수 동작은 emailAuth.routes.test.ts에서 켜고 확인한다.
      EMAIL_CONSENT_REQUIRED: 'false',
    },
  },
});
