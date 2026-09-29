/**
 * 컨테이너 시작 시 서버보다 먼저 실행된다 (docker/entrypoint.sh).
 * 대기 중인 복원 파일이 있으면 DB를 교체한다. 이어서 entrypoint가 `prisma migrate deploy`로
 * 스키마를 최신으로 올리므로, 오래된 버전의 백업도 복원할 수 있다.
 */
import 'dotenv/config';
import { applyPendingRestore, databaseFilePath } from '../lib/dbFile.js';

const result = applyPendingRestore();
// eslint-disable-next-line no-console
console.log(
  result.applied
    ? `[prestart] 백업을 복원했습니다 → ${databaseFilePath()} (이전 DB 보관: ${result.previousBackup ?? '없음'})`
    : `[prestart] 대기 중인 복원 없음 (DB: ${databaseFilePath()})`,
);
