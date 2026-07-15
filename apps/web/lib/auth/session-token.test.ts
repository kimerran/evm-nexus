import { beforeAll, describe, expect, it } from 'vitest';

// The token module reads SESSION_SECRET through the validated env at call time,
// so provide a minimal valid env before importing it.
beforeAll(() => {
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.SESSION_SECRET ??= 's'.repeat(40);
  process.env.ENCRYPTION_KEY ??= 'k'.repeat(32);
  process.env.CSRF_SECRET ??= 'c'.repeat(16);
  process.env.DATABASE_URL ??= 'postgresql://nexus:nexus@localhost:5432/evm_nexus';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
});

describe('session JWS sign/verify', () => {
  it('round-trips claims (sign → verify)', async () => {
    const { signSessionToken, verifySessionToken } = await import('./session-token');
    const token = await signSessionToken({ userId: 'user_1', sid: 'sid_abc', role: 'ADMIN' });
    const claims = await verifySessionToken(token);
    expect(claims).toEqual({ userId: 'user_1', sid: 'sid_abc', role: 'ADMIN' });
  });

  it('rejects a tampered token (bad signature)', async () => {
    const { signSessionToken, verifySessionToken } = await import('./session-token');
    const token = await signSessionToken({ userId: 'user_1', sid: 'sid_abc', role: 'USER' });
    // Flip the last char of the signature segment.
    const parts = token.split('.');
    const sig = parts[2] ?? '';
    parts[2] = (sig.at(-1) === 'A' ? 'B' : 'A') + sig.slice(1);
    const tampered = parts.join('.');
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const { SignJWT } = await import('jose');
    const { verifySessionToken } = await import('./session-token');
    const foreign = await new SignJWT({ sid: 'sid_x', role: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user_1')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-totally-different-secret-value-32chars'));
    expect(await verifySessionToken(foreign)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const { signSessionToken, verifySessionToken } = await import('./session-token');
    // Negative TTL → exp in the past.
    const token = await signSessionToken({ userId: 'user_1', sid: 'sid_abc', role: 'USER' }, -60);
    expect(await verifySessionToken(token)).toBeNull();
  });

  it('rejects a token with an invalid role claim', async () => {
    const { SignJWT } = await import('jose');
    const { verifySessionToken } = await import('./session-token');
    const bad = await new SignJWT({ sid: 'sid_x', role: 'SUPERUSER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user_1')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET as string));
    expect(await verifySessionToken(bad)).toBeNull();
  });

  it('rejects garbage input', async () => {
    const { verifySessionToken } = await import('./session-token');
    expect(await verifySessionToken('not.a.jwt')).toBeNull();
    expect(await verifySessionToken('')).toBeNull();
  });
});

describe('sid hashing', () => {
  it('hashes a sid to a stable non-reversible hex digest', async () => {
    const { hashSid, generateSid } = await import('./session-token');
    const sid = generateSid();
    const h1 = hashSid(sid);
    const h2 = hashSid(sid);
    expect(h1).toBe(h2); // deterministic
    expect(h1).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
    expect(h1).not.toContain(sid); // does not leak the sid
  });

  it('generates distinct high-entropy sids', async () => {
    const { generateSid } = await import('./session-token');
    expect(generateSid()).not.toBe(generateSid());
  });
});

describe('session revocation / validity check', () => {
  it('accepts a live, non-revoked, unexpired session', async () => {
    const { isSessionRecordValid } = await import('./session-token');
    const future = new Date(Date.now() + 60_000);
    expect(isSessionRecordValid({ revokedAt: null, expiresAt: future })).toBe(true);
  });

  it('rejects a revoked session (revocation check)', async () => {
    const { isSessionRecordValid } = await import('./session-token');
    const future = new Date(Date.now() + 60_000);
    expect(isSessionRecordValid({ revokedAt: new Date(), expiresAt: future })).toBe(false);
  });

  it('rejects an expired session', async () => {
    const { isSessionRecordValid } = await import('./session-token');
    const past = new Date(Date.now() - 60_000);
    expect(isSessionRecordValid({ revokedAt: null, expiresAt: past })).toBe(false);
  });
});

describe('sliding refresh threshold', () => {
  it('refreshes when close to expiry', async () => {
    const { shouldRefreshSession, SESSION_REFRESH_THRESHOLD_SECONDS } = await import(
      './session-token'
    );
    const soon = new Date(Date.now() + (SESSION_REFRESH_THRESHOLD_SECONDS - 30) * 1000);
    expect(shouldRefreshSession(soon)).toBe(true);
  });

  it('does not refresh a freshly-minted session', async () => {
    const { shouldRefreshSession, SESSION_TTL_SECONDS } = await import('./session-token');
    const fresh = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
    expect(shouldRefreshSession(fresh)).toBe(false);
  });
});
