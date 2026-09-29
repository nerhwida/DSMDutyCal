import cors from 'cors';
import express from 'express';
import { createSessionMiddleware } from './auth/session.js';
import { authRouter } from './routes/auth.routes.js';
import { teachersRouter, gradeOrderRouter } from './routes/teachers.routes.js';
import { gradeHeadsRouter } from './routes/gradeHeads.routes.js';
import { specialDaysRouter } from './routes/specialDays.routes.js';
import { initialCountsRouter } from './routes/initialCounts.routes.js';
import { monthsRouter } from './routes/months.routes.js';
import { assignmentsRouter } from './routes/assignments.routes.js';
import { meRouter } from './routes/me.routes.js';
import { statsRouter } from './routes/stats.routes.js';
import { publicRouter } from './routes/public.routes.js';
import { apiClientsRouter } from './routes/apiClients.routes.js';
import { historyRouter } from './routes/history.routes.js';
import { restrictApiKeyToPublic } from './permissions/middleware.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(restrictApiKeyToPublic);
  app.use(createSessionMiddleware());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/teachers', teachersRouter);
  app.use('/api/grades', gradeOrderRouter);
  app.use('/api/grade-heads', gradeHeadsRouter);
  app.use('/api/special-days', specialDaysRouter);
  app.use('/api/initial-counts', initialCountsRouter);
  app.use('/api/months', monthsRouter);
  app.use('/api/assignments', assignmentsRouter);
  app.use('/api/me', meRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/history', historyRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/api-clients', apiClientsRouter);

  // 알 수 없는 /api/* 경로
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: '요청하신 API를 찾을 수 없습니다.' });
  });

  return app;
}
