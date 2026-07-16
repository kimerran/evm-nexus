import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Prisma singleton so writeAudit can be tested without a database.
const create = vi.fn();
vi.mock('@/lib/db', () => ({ prisma: { auditLog: { create } } }));

describe('writeAudit (audit writer)', () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ id: 'log1' });
  });

  it('writes a row for a privileged action, mapping target → targetType/targetId', async () => {
    const { writeAudit } = await import('./audit');
    await writeAudit({
      actorId: 'admin1',
      action: 'user.deactivate',
      target: { type: 'user', id: 'user2' },
      metadata: { targetUsername: 'bob' },
      ip: '127.0.0.1',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'admin1',
        action: 'user.deactivate',
        targetType: 'user',
        targetId: 'user2',
        ip: '127.0.0.1',
        metadata: { targetUsername: 'bob' },
      },
    });
  });

  it('stores metadata verbatim and never injects extra (secret) fields', async () => {
    const { writeAudit } = await import('./audit');
    await writeAudit({
      actorId: 'admin1',
      action: 'apiKey.issue',
      target: { type: 'apiKey', id: 'k1' },
      metadata: { name: 'ci-bot', prefix: 'nxs_ab12cd34' },
    });

    const data = create.mock.calls[0]?.[0]?.data as { metadata: Record<string, unknown> };
    // Only the two non-secret keys the caller passed — no token/hash/password.
    expect(Object.keys(data.metadata).sort()).toEqual(['name', 'prefix']);
    const serialized = JSON.stringify(data);
    expect(serialized).not.toMatch(/password|passwordHash|keyHash|token|privateKey/i);
  });

  it('omits metadata entirely when none is provided', async () => {
    const { writeAudit } = await import('./audit');
    await writeAudit({ actorId: null, action: 'user.activate', target: { type: 'user', id: 'u3' } });
    const data = create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect('metadata' in data).toBe(false);
    expect(data.userId).toBeNull();
  });

  it('is best-effort: a DB failure is swallowed, never thrown', async () => {
    create.mockRejectedValueOnce(new Error('db down'));
    const { writeAudit } = await import('./audit');
    await expect(writeAudit({ actorId: 'a', action: 'user.activate' })).resolves.toBeUndefined();
  });
});
