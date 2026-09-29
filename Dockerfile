# DutyCal 단일 컨테이너 이미지: Express API + 빌드된 React 화면 + SQLite(/data 볼륨)
# 빌드: docker compose build   (자세한 사용법은 README.md "배포" 참고)

FROM node:22-bookworm-slim AS base
# Prisma 엔진에 openssl 필요
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# 학교·사내망이 TLS를 가로채 npm/Prisma 다운로드가 실패하면, 해당 루트 인증서(.crt)를
# docker/certs/ 에 넣고 다시 빌드한다. (없으면 아무 영향 없음)
COPY docker/certs/ /usr/local/share/ca-certificates/dutycal/
RUN update-ca-certificates
ENV NODE_OPTIONS=--use-system-ca
WORKDIR /app

# ---- 빌드 단계: 의존성 설치 → Prisma 클라이언트 생성 → 서버·클라이언트 빌드
FROM base AS build
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY client client
COPY server server
RUN npx prisma generate --schema server/prisma/schema.prisma \
 && npm run build -w server \
 && npm run build -w client

# ---- 실행 단계: 서버 운영 의존성 + 빌드 결과물만
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
COPY server/prisma/schema.prisma server/prisma/schema.prisma
COPY server/prisma/migrations server/prisma/migrations
COPY docker/entrypoint.sh /usr/local/bin/dutycal-entrypoint
RUN chmod +x /usr/local/bin/dutycal-entrypoint \
 && mkdir -p /data \
 && chown -R node:node /data /app

# 컨테이너 기본값 (docker-compose.yml에서도 같은 값을 준다)
ENV DATABASE_URL=file:/data/dutycal.db \
    PORT=4000 \
    CLIENT_DIST=/app/client/dist \
    RESTART_ON_RESTORE=true

USER node
EXPOSE 4000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["dutycal-entrypoint"]
