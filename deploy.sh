#!/usr/bin/env bash

set -Eeuo pipefail

APP_DIR="/opt/dutycal"
BRANCH="main"
HEALTH_URL="http://127.0.0.1:8080/api/health"
MAX_RETRIES=30
RETRY_INTERVAL=2

cd "$APP_DIR"

echo "========================================"
echo " DutyCal Deployment"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

# --------------------------------------------------
# 1. 현재 상태 확인
# --------------------------------------------------

echo
echo "[1/7] 현재 Git 상태 확인"

if [[ -n "$(git status --porcelain)" ]]; then
    echo "ERROR: 서버 저장소에 커밋되지 않은 변경사항이 있습니다."
    git status --short
    echo
    echo "배포를 중단합니다."
    exit 1
fi

CURRENT_COMMIT=$(git rev-parse --short HEAD)

echo "현재 브랜치 : $(git branch --show-current)"
echo "현재 Commit : $CURRENT_COMMIT"

# --------------------------------------------------
# 2. DB 백업
# --------------------------------------------------

echo
echo "[2/7] SQLite DB 백업"

BACKUP_DIR="$APP_DIR/deploy-backups"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')

mkdir -p "$BACKUP_DIR"

if sudo docker compose ps --status running | grep -q dutycal; then

    if sudo docker compose exec -T dutycal \
        test -f /data/dutycal.db; then

        sudo docker compose exec -T dutycal \
            cp /data/dutycal.db "/data/deploy-${TIMESTAMP}.db"

        sudo docker compose cp \
            "dutycal:/data/deploy-${TIMESTAMP}.db" \
            "$BACKUP_DIR/dutycal-${TIMESTAMP}.db"

        sudo docker compose exec -T dutycal \
            rm -f "/data/deploy-${TIMESTAMP}.db"

        echo "백업 완료:"
        echo "$BACKUP_DIR/dutycal-${TIMESTAMP}.db"

    else
        echo "WARNING: dutycal.db가 없습니다."
    fi

else
    echo "WARNING: DutyCal 컨테이너가 실행 중이 아닙니다."
fi

# --------------------------------------------------
# 3. GitHub 업데이트
# --------------------------------------------------

echo
echo "[3/7] GitHub 업데이트"

git fetch origin "$BRANCH"

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [[ "$LOCAL" == "$REMOTE" ]]; then
    echo "이미 최신 버전입니다."
else
    git pull --ff-only origin "$BRANCH"
fi

NEW_COMMIT=$(git rev-parse --short HEAD)

echo "기존 Commit : $CURRENT_COMMIT"
echo "신규 Commit : $NEW_COMMIT"

# --------------------------------------------------
# 4. Docker Image Build
# --------------------------------------------------

echo
echo "[4/7] Docker 이미지 빌드"

sudo docker compose build

# --------------------------------------------------
# 5. 배포
# --------------------------------------------------

echo
echo "[5/7] DutyCal 컨테이너 배포"

sudo docker compose up -d

# --------------------------------------------------
# 6. Health Check
# --------------------------------------------------

echo
echo "[6/7] Health Check"

HEALTH_OK=false

for ((i=1; i<=MAX_RETRIES; i++)); do

    if curl --fail --silent "$HEALTH_URL" | grep -q '"ok":true'; then
        HEALTH_OK=true
        echo
        echo "Health Check 성공"
        break
    fi

    printf "."

    sleep "$RETRY_INTERVAL"

done

echo

if [[ "$HEALTH_OK" != "true" ]]; then

    echo "ERROR: Health Check 실패"
    echo
    echo "최근 Docker 로그:"
    sudo docker compose logs --tail=100 dutycal

    exit 1

fi

# --------------------------------------------------
# 7. 최종 상태
# --------------------------------------------------

echo
echo "[7/7] 배포 상태"

sudo docker compose ps

echo
echo "최근 로그:"
sudo docker compose logs --tail=20 dutycal

echo
echo "========================================"
echo " DutyCal Deployment Complete"
echo " Commit : $NEW_COMMIT"
echo " URL    : https://dutycal.dsmhs.kr"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"