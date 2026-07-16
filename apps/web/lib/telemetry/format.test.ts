import { describe, expect, it } from 'vitest';
import {
  EM_DASH,
  formatBlockHeight,
  formatCount,
  formatSeconds,
  formatWeiToGwei,
} from './format';

describe('formatWeiToGwei', () => {
  it('converts wei to gwei with bigint precision (no float drift)', () => {
    expect(formatWeiToGwei('1000000000')).toBe('1.00');
    expect(formatWeiToGwei('1500000000')).toBe('1.50');
    expect(formatWeiToGwei('18400000000')).toBe('18.40');
    expect(formatWeiToGwei('0')).toBe('0.00');
  });

  it('does not lose precision on very large wei amounts', () => {
    // 123456789 gwei exactly.
    expect(formatWeiToGwei('123456789000000000')).toBe('123456789.00');
  });

  it('supports zero decimals', () => {
    expect(formatWeiToGwei('1500000000', 0)).toBe('1');
  });

  it('returns the em-dash placeholder for garbage input', () => {
    expect(formatWeiToGwei('not-a-number')).toBe(EM_DASH);
    expect(formatWeiToGwei('-5')).toBe(EM_DASH);
  });
});

describe('formatSeconds', () => {
  it('formats a number to fixed decimals', () => {
    expect(formatSeconds(2.01)).toBe('2.01');
    expect(formatSeconds(2.567)).toBe('2.57');
    expect(formatSeconds(12)).toBe('12.00');
  });

  it('returns the placeholder for null / non-finite', () => {
    expect(formatSeconds(null)).toBe(EM_DASH);
    expect(formatSeconds(Number.NaN)).toBe(EM_DASH);
  });
});

describe('formatCount', () => {
  it('adds thousands separators', () => {
    expect(formatCount(1420)).toBe('1,420');
    expect(formatCount(0)).toBe('0');
  });

  it('returns the placeholder for null', () => {
    expect(formatCount(null)).toBe(EM_DASH);
  });
});

describe('formatBlockHeight', () => {
  it('formats a decimal-string height with a hash prefix', () => {
    expect(formatBlockHeight('1204882')).toBe('#1,204,882');
  });

  it('returns the placeholder for an unparseable height', () => {
    expect(formatBlockHeight('nope')).toBe(EM_DASH);
  });
});
