import { describe, expect, it } from 'vitest';
import { faucetRequestSchema } from './schema';

const ADDR_LOWER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const ADDR_CHECKSUM = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

describe('faucetRequestSchema', () => {
  it('accepts a valid address + wei amount and checksums the address', () => {
    const parsed = faucetRequestSchema.parse({ toAddress: ADDR_LOWER, amount: '1000' });
    expect(parsed.toAddress).toBe(ADDR_CHECKSUM);
    expect(parsed.amount).toBe('1000');
  });

  it('rejects a malformed address', () => {
    expect(faucetRequestSchema.safeParse({ toAddress: '0x123', amount: '1000' }).success).toBe(
      false,
    );
  });

  it('rejects a non-integer / float amount (no Number coercion)', () => {
    expect(
      faucetRequestSchema.safeParse({ toAddress: ADDR_LOWER, amount: '1.5' }).success,
    ).toBe(false);
    expect(
      faucetRequestSchema.safeParse({ toAddress: ADDR_LOWER, amount: '1e18' }).success,
    ).toBe(false);
  });

  it('rejects a zero amount', () => {
    expect(faucetRequestSchema.safeParse({ toAddress: ADDR_LOWER, amount: '0' }).success).toBe(
      false,
    );
  });

  it('rejects unknown keys (strict)', () => {
    expect(
      faucetRequestSchema.safeParse({ toAddress: ADDR_LOWER, amount: '1000', evil: true }).success,
    ).toBe(false);
  });

  it('accepts an optional networkId', () => {
    const parsed = faucetRequestSchema.parse({
      toAddress: ADDR_LOWER,
      amount: '1000',
      networkId: 'net_123',
    });
    expect(parsed.networkId).toBe('net_123');
  });
});
