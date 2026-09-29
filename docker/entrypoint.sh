#!/bin/sh
# DutyCal 컨테이너 시작 순서
#  1) 대기 중인 복원 파일이 있으면 적용 (현재 DB는 /data/backups 에 자동 보관)
#  2) DB 스키마를 최신으로 (신규 설치·업데이트·오래된 백업 복원 모두 처리)
#  3) 서버 실행
set -e
cd /app

node server/dist/scripts/prestart.js
npx --no-install prisma migrate deploy --schema server/prisma/schema.prisma
exec node server/dist/index.js
