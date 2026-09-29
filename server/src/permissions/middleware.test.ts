import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireAdmin, requireGradeScope, requireSelfOrAdmin } from './middleware.js';
import type { AuthenticatedUser } from '../auth/authService.js';

function mockReq(user: Partial<AuthenticatedUser> | undefined): Request {
  return { user } as unknown as Request;
}

function mockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe('requireAdmin', () => {
  it('ADMIN이 아니면 403을 반환한다', () => {
    const req = mockReq({ isAdmin: false });
    const res = mockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('ADMIN이면 next()를 호출한다', () => {
    const req = mockReq({ isAdmin: true });
    const res = mockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('requireGradeScope', () => {
  it('담당 학년이 아닌 학년부장은 403을 받는다 (2학년 부장이 1학년 접근)', () => {
    const req = mockReq({ isAdmin: false, gradeHeadOf: [2] });
    const res = mockRes();
    const next = vi.fn();

    requireGradeScope(() => 1)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('담당 학년 부장은 통과한다', () => {
    const req = mockReq({ isAdmin: false, gradeHeadOf: [2] });
    const res = mockRes();
    const next = vi.fn();

    requireGradeScope(() => 2)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('ADMIN은 모든 학년에 대해 통과한다 (가정 13)', () => {
    const req = mockReq({ isAdmin: true, gradeHeadOf: [1, 2, 3] });
    const res = mockRes();
    const next = vi.fn();

    requireGradeScope(() => 3)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('학년 정보가 없으면 400을 반환한다', () => {
    const req = mockReq({ isAdmin: true, gradeHeadOf: [1, 2, 3] });
    const res = mockRes();
    const next = vi.fn();

    requireGradeScope(() => undefined)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireSelfOrAdmin', () => {
  it('본인이면 통과한다', () => {
    const req = mockReq({ id: 5, isAdmin: false });
    const res = mockRes();
    const next = vi.fn();

    requireSelfOrAdmin(() => 5)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('타인이면 403을 반환한다', () => {
    const req = mockReq({ id: 5, isAdmin: false });
    const res = mockRes();
    const next = vi.fn();

    requireSelfOrAdmin(() => 6)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('ADMIN은 타인 대상이어도 통과한다', () => {
    const req = mockReq({ id: 999, isAdmin: true });
    const res = mockRes();
    const next = vi.fn();

    requireSelfOrAdmin(() => 6)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
