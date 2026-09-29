import type { NextFunction, Request, Response } from 'express';
import { ServiceError } from '../services/schedulerService.js';

/**
 * async 라우트 핸들러 래퍼. ServiceError는 해당 상태 코드 + 한국어 메시지(+ details)로,
 * 그 외 예외는 500으로 응답한다. (Express 4는 async 핸들러의 예외를 잡지 못한다.)
 */
export function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response, _next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ServiceError) {
        return res.status(err.status).json({ error: err.message, ...err.details });
      }
      // eslint-disable-next-line no-console
      console.error(err);
      return res.status(500).json({ error: '요청 처리 중 오류가 발생했습니다.' });
    }
  };
}
