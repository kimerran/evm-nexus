import { beforeAll, describe, expect, it } from 'vitest';
import type { Network } from '@/lib/generated/prisma/client';

beforeAll(() => {
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.SESSION_SECRET ??= 's'.repeat(32);
  process.env.ENCRYPTION_KEY ??= 'k'.repeat(32);
  process.env.CSRF_SECRET ??= 'c'.repeat(16);
  process.env.DATABASE_URL ??= 'postgresql://nexus:nexus@localhost:5432/evm_nexus';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
});

function baseNetwork(overrides: Partial<Network>): Network {
  return {
    id: 'net_1',
    name: 'Test',
    chainId: 31337,
    rpcUrl: 'http://localhost:8545',
    wsUrl: null,
    explorerBaseUrl: null,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    isDefault: false,
    isArchival: false,
    faucetEnabled: true,
    faucetDripAmount: '5000000000000000000',
    faucetDailyCap: '500000000000000000000',
    faucetCooldownSec: 86400,
    faucetSignerRef: null,
    relayerSignerRef: null,
    paymasterAddress: null,
    entryPointAddress: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

describe('network DTO redaction', () => {
  it('redacts a credentialed RPC URL to its origin and never leaks the secret', async () => {
    const { encodeRpcUrlForStorage } = await import('./rpc-url');
    const { toNetworkDto } = await import('./network-dto');
    const stored = encodeRpcUrlForStorage('https://alice:s3cr3t@rpc.example.com/v1/KEY');
    const dto = toNetworkDto(baseNetwork({ rpcUrl: stored }));

    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain('s3cr3t');
    expect(serialized).not.toContain('alice');
    expect(serialized).not.toContain('KEY');
    expect(dto.rpcUrl).toBe('https://rpc.example.com');
    expect(dto.rpcUrlHasSecret).toBe(true);
  });

  it('never exposes an encrypted envelope for a credential-free URL', async () => {
    const { toNetworkDto } = await import('./network-dto');
    const dto = toNetworkDto(baseNetwork({ rpcUrl: 'http://localhost:8545' }));
    expect(dto.rpcUrl).toBe('http://localhost:8545');
    expect(dto.rpcUrlHasSecret).toBe(false);
    expect(JSON.stringify(dto)).not.toContain('enc:');
  });

  it('serializes wei amounts as strings and dates as ISO', async () => {
    const { toNetworkDto } = await import('./network-dto');
    const dto = toNetworkDto(baseNetwork({}));
    expect(dto.faucetDripAmount).toBe('5000000000000000000');
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
