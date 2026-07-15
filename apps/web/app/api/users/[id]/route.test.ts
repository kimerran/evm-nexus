import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// --- Mocks: DB, session, and CSRF (focus the test on RBAC + audit wiring) ---
const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const auditCreate = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: userFindUnique, update: userUpdate },
    auditLog: { create: auditCreate },
  },
}));

const getSession = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSession }));

// CSRF is exercised in lib/auth/csrf.test.ts; no-op it here.
vi.mock('@/lib/auth/mutation-guard', () => ({ requireCsrfUnlessApiKey: vi.fn() }));

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/users/user2', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: 'user2' }) };

beforeAll(() => {
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.SESSION_SECRET ??= 's'.repeat(40);
  process.env.ENCRYPTION_KEY ??= 'k'.repeat(32);
  process.env.CSRF_SECRET ??= 'c'.repeat(16);
  process.env.DATABASE_URL ??= 'postgresql://nexus:nexus@localhost:5432/evm_nexus';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
});

beforeEach(() => {
  userFindUnique.mockReset();
  userUpdate.mockReset();
  auditCreate.mockReset().mockResolvedValue({ id: 'log1' });
  getSession.mockReset();
});

describe('PATCH /api/users/[id]', () => {
  it('ADMIN deactivating a user succeeds and writes an audit row', async () => {
    getSession.mockResolvedValue({
      user: { id: 'admin1', username: 'admin', role: 'ADMIN' },
      sid: 'sid1',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    userFindUnique.mockResolvedValue({
      id: 'user2',
      username: 'bob',
      role: 'USER',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    userUpdate.mockResolvedValue({
      id: 'user2',
      username: 'bob',
      role: 'USER',
      isActive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { PATCH } = await import('./route');
    const res = await PATCH(patchRequest({ isActive: false }), ctx);

    expect(res.status).toBe(200);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'user2' }, data: { isActive: false } });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditData = auditCreate.mock.calls[0]?.[0]?.data as { action: string; userId: string };
    expect(auditData.action).toBe('user.deactivate');
    expect(auditData.userId).toBe('admin1');
  });

  it('DENIES a USER (403) and performs no write / no audit', async () => {
    getSession.mockResolvedValue({
      user: { id: 'user9', username: 'mallory', role: 'USER' },
      sid: 'sid9',
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const { PATCH } = await import('./route');
    const res = await PATCH(patchRequest({ isActive: false }), ctx);

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(userUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
