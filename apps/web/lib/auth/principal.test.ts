import { describe, expect, it } from 'vitest';
import { authorize, type Principal } from './principal';
import { ForbiddenError, UnauthenticatedError } from '@/lib/errors';

function principal(role: 'ADMIN' | 'USER'): Principal {
  return { user: { id: 'u1', username: 'alice', role }, via: 'session' };
}

describe('authorize (RBAC decision)', () => {
  it('throws 401 UNAUTHENTICATED when there is no principal', () => {
    try {
      authorize(null, 'USER');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthenticatedError);
      expect((err as UnauthenticatedError).status).toBe(401);
    }
  });

  it('DENIES an under-privileged USER hitting an ADMIN route with 403', () => {
    try {
      authorize(principal('USER'), 'ADMIN');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).status).toBe(403);
      expect((err as ForbiddenError).code).toBe('FORBIDDEN');
    }
  });

  it('allows a USER on a USER route', () => {
    expect(authorize(principal('USER'), 'USER').user.role).toBe('USER');
  });

  it('allows an ADMIN on a USER route (ADMIN satisfies USER)', () => {
    expect(authorize(principal('ADMIN'), 'USER').user.role).toBe('ADMIN');
  });

  it('allows an ADMIN on an ADMIN route', () => {
    expect(authorize(principal('ADMIN'), 'ADMIN').user.role).toBe('ADMIN');
  });
});
