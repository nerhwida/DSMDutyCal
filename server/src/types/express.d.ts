import type { AuthenticatedUser } from '../auth/authService.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      /** API 연동 계정 키로 인증된 경우 (배포 API 전용). */
      apiClient?: { id: number; name: string };
    }
  }
}

export {};
