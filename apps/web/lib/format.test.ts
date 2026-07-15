import { describe, it, expect } from 'vitest';
import { truncateAddress } from './format';

describe('truncateAddress', () => {
  const address = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';

  it('truncates a full address to the BRAND 0x71C…3A2 form', () => {
    expect(truncateAddress(address)).toBe('0x71C…76F');
  });

  it('keeps the 0x prefix inside the leading segment', () => {
    expect(truncateAddress(address).startsWith('0x71C')).toBe(true);
  });

  it('honors custom head/tail lengths', () => {
    expect(truncateAddress(address, { head: 6, tail: 4 })).toBe('0x71C7…976F');
  });

  it('returns short values unchanged (no wasteful truncation)', () => {
    expect(truncateAddress('0x1234')).toBe('0x1234');
  });

  it('does not truncate when the result would not be shorter', () => {
    // 9 chars, head+tail+ellipsis = 5+3+1 = 9 → returned as-is.
    expect(truncateAddress('0x1234567')).toBe('0x1234567');
  });

  it('truncates a transaction hash the same way', () => {
    const hash = '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    expect(truncateAddress(hash)).toBe('0xabc…789');
  });

  it('rejects negative segment lengths', () => {
    expect(() => truncateAddress(address, { head: -1 })).toThrow();
  });
});
