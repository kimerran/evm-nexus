import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Prisma so verifyApiKey runs without a DB and we can inspect the query.
const findUnique = vi.fn();
const update = vi.fn();
vi.mock('@/lib/db', () => ({ prisma: { apiKey: { findUnique, update } } }));

describe('API key verification is one-way (lookup by hash, raw never stored)', () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset().mockResolvedValue({});
  });

  it('looks the key up by sha256 hash — the raw token never appears in the query', async () => {
    const { generateApiKey, hashApiKey, verifyApiKey } = await import('./api-key');
    const { token } = generateApiKey();

    findUnique.mockResolvedValue({
      id: 'k1',
      user: { id: 'u1', username: 'alice', role: 'USER', isActive: true },
      revokedAt: null,
      expiresAt: null,
    });

    const principal = await verifyApiKey(token);

    // The DB was queried by the HASH, not the raw token.
    const where = findUnique.mock.calls[0]?.[0]?.where as { keyHash: string };
    expect(where.keyHash).toBe(hashApiKey(token));
    // The raw key must never appear anywhere in the query object.
    expect(JSON.stringify(findUnique.mock.calls[0]?.[0])).not.toContain(token);
    // sha256 is not reversible: hashing again is deterministic, but no inverse.
    expect(hashApiKey(token)).toMatch(/^[0-9a-f]{64}$/);

    expect(principal).toEqual({ id: 'u1', username: 'alice', role: 'USER' });
  });

  it('rejects a revoked key (null principal), so a revoked raw key cannot authenticate', async () => {
    const { generateApiKey, verifyApiKey } = await import('./api-key');
    const { token } = generateApiKey();
    findUnique.mockResolvedValue({
      id: 'k1',
      user: { id: 'u1', username: 'alice', role: 'USER', isActive: true },
      revokedAt: new Date(),
      expiresAt: null,
    });
    expect(await verifyApiKey(token)).toBeNull();
  });
});
