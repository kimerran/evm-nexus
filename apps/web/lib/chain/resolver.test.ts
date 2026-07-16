import { beforeAll, describe, expect, it } from 'vitest';
import type { NetworkClientConfig } from './resolver';

// The resolver's pure builders take a plain config, so they need no DB — but the
// module imports lib/db (Prisma singleton), which reads env at construction.
beforeAll(() => {
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.SESSION_SECRET ??= 's'.repeat(32);
  process.env.ENCRYPTION_KEY ??= 'k'.repeat(32);
  process.env.CSRF_SECRET ??= 'c'.repeat(16);
  process.env.DATABASE_URL ??= 'postgresql://nexus:nexus@localhost:5432/evm_nexus';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
});

const anvil: NetworkClientConfig = {
  chainId: 31337,
  name: 'Anvil-Local',
  rpcUrl: 'http://localhost:8545',
  wsUrl: 'ws://localhost:8545',
  nativeSymbol: 'ETH',
  nativeDecimals: 18,
  explorerBaseUrl: null,
};

describe('network resolver', () => {
  it('builds a viem chain descriptor from a Network config', async () => {
    const { toViemChain } = await import('./resolver');
    const chain = toViemChain(anvil);
    expect(chain.id).toBe(31337);
    expect(chain.name).toBe('Anvil-Local');
    expect(chain.nativeCurrency).toEqual({ name: 'ETH', symbol: 'ETH', decimals: 18 });
    expect(chain.rpcUrls.default.http[0]).toBe('http://localhost:8545');
  });

  it('builds a public client (http transport) bound to the config chain', async () => {
    const { buildPublicClient } = await import('./resolver');
    const client = buildPublicClient(anvil);
    expect(client.chain?.id).toBe(31337);
    expect(client.transport.type).toBe('http');
    expect(typeof client.getBlockNumber).toBe('function');
  });

  it('uses the webSocket transport when preferred and a wsUrl is set', async () => {
    const { buildPublicClient } = await import('./resolver');
    const client = buildPublicClient(anvil, { preferWebSocket: true });
    expect(client.transport.type).toBe('webSocket');
  });

  it('builds a wallet client bound to the config chain', async () => {
    const { buildWalletClient } = await import('./resolver');
    const client = buildWalletClient(anvil);
    expect(client.chain?.id).toBe(31337);
    expect(typeof client.sendTransaction).toBe('function');
  });
});
