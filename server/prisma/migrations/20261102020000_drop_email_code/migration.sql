-- 이메일 인증 코드 로그인을 Google 계정 로그인으로 바꿔 인증 코드 표를 없앤다.
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "EmailCode";
PRAGMA foreign_keys=on;
