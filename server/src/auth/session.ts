import session from 'express-session';
import { PrismaSessionStore } from './prismaSessionStore.js';

declare module 'express-session' {
  interface SessionData {
    teacherId?: number;
  }
}

export function createSessionMiddleware() {
  const hours = Number(process.env.SESSION_HOURS ?? '8');
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.');
  }
  const maxAge = hours * 60 * 60 * 1000;

  return session({
    name: 'dutycal.sid',
    secret,
    // 세션을 DB에 저장해 서버 재시작·업데이트 후에도 로그인이 유지되게 한다.
    store: new PrismaSessionStore(maxAge),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // HTTPS로 서비스할 때 .env에 COOKIE_SECURE=true (리버스 프록시 뒤라면 TRUST_PROXY=1도 함께)
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge,
    },
  });
}
