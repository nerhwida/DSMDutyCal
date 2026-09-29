import session from 'express-session';

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

  return session({
    name: 'dutycal.sid',
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // 배포 환경에서 HTTPS를 사용하면 true로 전환한다.
      secure: false,
      maxAge: hours * 60 * 60 * 1000,
    },
  });
}
