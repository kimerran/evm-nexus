import { describe, expect, it } from 'vitest';
import { createNetworkSchema, updateNetworkSchema } from './network-schema';

describe('network schema validation', () => {
  const valid = {
    name: 'Anvil-Local',
    chainId: 31337,
    rpcUrl: 'http://localhost:8545',
  };

  it('accepts a minimal valid network and applies defaults', () => {
    const parsed = createNetworkSchema.parse(valid);
    expect(parsed.nativeSymbol).toBe('ETH');
    expect(parsed.nativeDecimals).toBe(18);
    expect(parsed.isDefault).toBe(false);
    expect(parsed.faucetCooldownSec).toBe(86400);
  });

  it('checksum-normalizes EVM addresses', () => {
    const parsed = createNetworkSchema.parse({
      ...valid,
      entryPointAddress: '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789', // all lowercase
    });
    // getAddress returns the EIP-55 checksummed form.
    expect(parsed.entryPointAddress).toBe('0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789');
  });

  it('rejects an invalid EVM address', () => {
    expect(() =>
      createNetworkSchema.parse({ ...valid, paymasterAddress: '0xnothex' }),
    ).toThrow();
  });

  it('rejects a non-positive chainId', () => {
    expect(() => createNetworkSchema.parse({ ...valid, chainId: 0 })).toThrow();
  });

  it('rejects an RPC URL with an unsupported scheme', () => {
    expect(() => createNetworkSchema.parse({ ...valid, rpcUrl: 'ftp://rpc.example.com' })).toThrow();
  });

  it('rejects a non-integer wei amount', () => {
    expect(() => createNetworkSchema.parse({ ...valid, faucetDripAmount: '1.5' })).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() => createNetworkSchema.parse({ ...valid, bogus: true })).toThrow();
  });

  it('requires at least one field on update', () => {
    expect(() => updateNetworkSchema.parse({})).toThrow();
  });
});
