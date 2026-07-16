import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.SESSION_SECRET ??= 's'.repeat(32);
  process.env.ENCRYPTION_KEY ??= 'k'.repeat(32);
  process.env.CSRF_SECRET ??= 'c'.repeat(16);
  process.env.DATABASE_URL ??= 'postgresql://nexus:nexus@localhost:5432/evm_nexus';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
});

describe('network delete-guard', () => {
  it('blocks deleting the active (default) network', async () => {
    const { assertNetworkDeletable } = await import('./network-service');
    expect(() => assertNetworkDeletable({ isDefault: true, referenceCount: 0 })).toThrow(
      /active .*default/i,
    );
  });

  it('blocks deleting a referenced network', async () => {
    const { assertNetworkDeletable } = await import('./network-service');
    expect(() => assertNetworkDeletable({ isDefault: false, referenceCount: 3 })).toThrow(
      /referenced by 3/i,
    );
  });

  it('allows deleting an unreferenced, non-default network', async () => {
    const { assertNetworkDeletable } = await import('./network-service');
    expect(() => assertNetworkDeletable({ isDefault: false, referenceCount: 0 })).not.toThrow();
  });
});
