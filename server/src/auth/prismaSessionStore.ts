import session from 'express-session';
import { prisma } from '../lib/prisma.js';

type Callback = (err?: unknown) => void;

/** touch(요청마다 만료 연장) 시 이 시간보다 적게 연장되면 DB 쓰기를 건너뛴다. */
const TOUCH_THRESHOLD_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * express-session 저장소를 DB(Session 테이블)에 둔다.
 * 기본 MemoryStore는 서버를 재시작·업데이트할 때마다 모든 사용자가 로그아웃되고, 운영 환경용이 아니다.
 */
export class PrismaSessionStore extends session.Store {
  private cleanupTimer: NodeJS.Timeout;

  constructor(private readonly defaultTtlMs: number) {
    super();
    this.cleanupTimer = setInterval(() => void this.removeExpired(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref(); // 테스트·종료를 막지 않도록
  }

  private expiresOf(sess: session.SessionData): Date {
    const expires = sess.cookie?.expires;
    return expires ? new Date(expires) : new Date(Date.now() + this.defaultTtlMs);
  }

  async removeExpired() {
    await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }

  override get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    prisma.session
      .findUnique({ where: { sid } })
      .then((row) => {
        if (!row || row.expiresAt.getTime() <= Date.now()) return callback(null, null);
        callback(null, JSON.parse(row.data) as session.SessionData);
      })
      .catch((err) => callback(err));
  }

  override set(sid: string, sess: session.SessionData, callback?: Callback): void {
    const data = JSON.stringify(sess);
    const expiresAt = this.expiresOf(sess);
    prisma.session
      .upsert({ where: { sid }, update: { data, expiresAt }, create: { sid, data, expiresAt } })
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }

  override destroy(sid: string, callback?: Callback): void {
    prisma.session
      .deleteMany({ where: { sid } })
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }

  override touch(sid: string, sess: session.SessionData, callback?: Callback): void {
    // rolling 세션은 요청마다 touch되므로, 만료가 충분히 늘어날 때만 쓴다.
    const expiresAt = this.expiresOf(sess);
    prisma.session
      .updateMany({
        where: { sid, expiresAt: { lt: new Date(expiresAt.getTime() - TOUCH_THRESHOLD_MS) } },
        data: { expiresAt },
      })
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }
}
