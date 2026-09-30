import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { createSessionMiddleware } from './auth/session.js';
import { authRouter } from './routes/auth.routes.js';
import { teachersRouter, gradeOrderRouter } from './routes/teachers.routes.js';
import { gradeHeadsRouter } from './routes/gradeHeads.routes.js';
import { specialDaysRouter } from './routes/specialDays.routes.js';
import { afterSchoolRouter } from './routes/afterSchool.routes.js';
import { initialCountsRouter } from './routes/initialCounts.routes.js';
import { monthsRouter } from './routes/months.routes.js';
import { assignmentsRouter } from './routes/assignments.routes.js';
import { meRouter } from './routes/me.routes.js';
import { statsRouter } from './routes/stats.routes.js';
import { publicRouter } from './routes/public.routes.js';
import { apiClientsRouter } from './routes/apiClients.routes.js';
import { historyRouter } from './routes/history.routes.js';
import { backupRouter } from './routes/backup.routes.js';
import { restrictApiKeyToPublic } from './permissions/middleware.js';

export function createApp() {
  const app = express();

  // 리버스 프록시(nginx 등) 뒤에서 HTTPS로 서비스할 때: TRUST_PROXY=1 (secure 쿠키·클라이언트 IP 판단)
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

  // 헬스 체크 (Docker HEALTHCHECK용, 세션 불필요)
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(restrictApiKeyToPublic);
  app.use(createSessionMiddleware());

  app.use('/api/auth', authRouter);
  app.use('/api/teachers', teachersRouter);
  app.use('/api/grades', gradeOrderRouter);
  app.use('/api/grade-heads', gradeHeadsRouter);
  app.use('/api/special-days', specialDaysRouter);
  app.use('/api/after-school-days', afterSchoolRouter);
  app.use('/api/initial-counts', initialCountsRouter);
  app.use('/api/months', monthsRouter);
  app.use('/api/assignments', assignmentsRouter);
  app.use('/api/me', meRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/history', historyRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/api-clients', apiClientsRouter);
  app.use('/api/backup', backupRouter);

  // 알 수 없는 /api/* 경로
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: '요청하신 API를 찾을 수 없습니다.' });
  });

  // 운영(단일 컨테이너): 빌드된 클라이언트(client/dist)를 같은 서버에서 제공한다.
  // 개발 중에는 Vite 개발 서버(:5173)가 화면을 제공하므로 CLIENT_DIST를 설정하지 않는다.
  if (process.env.CLIENT_DIST) {
    const dist = path.resolve(process.env.CLIENT_DIST);
    const indexHtml = path.join(dist, 'index.html');
    if (!existsSync(indexHtml)) {
      throw new Error(`CLIENT_DIST에 index.html이 없습니다: ${dist} (클라이언트를 먼저 빌드하세요)`);
    }
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // 라우터 없는 SPA: API가 아닌 모든 경로는 index.html
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  return app;
}
