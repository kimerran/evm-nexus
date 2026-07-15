import { describe, expect, it } from 'vitest';
import { checkCsrf, type CsrfCheckInput } from './csrf';

const APP = 'https://app.example.com';
const TOKEN = 'a-strong-random-csrf-token-value-123';

function base(overrides: Partial<CsrfCheckInput> = {}): CsrfCheckInput {
  return {
    origin: APP,
    referer: null,
    appOrigin: APP,
    cookieToken: TOKEN,
    headerToken: TOKEN,
    ...overrides,
  };
}

describe('checkCsrf (double-submit + origin)', () => {
  it('accepts a matching Origin and matching cookie/header token', () => {
    expect(checkCsrf(base())).toBe(true);
  });

  it('accepts when Origin is absent but Referer matches the app origin', () => {
    expect(checkCsrf(base({ origin: null, referer: `${APP}/dashboard` }))).toBe(true);
  });

  it('rejects a cross-site Origin (CSRF reject)', () => {
    expect(checkCsrf(base({ origin: 'https://evil.example.com' }))).toBe(false);
  });

  it('rejects when neither Origin nor Referer is present', () => {
    expect(checkCsrf(base({ origin: null, referer: null }))).toBe(false);
  });

  it('rejects a mismatched double-submit token (CSRF reject)', () => {
    expect(checkCsrf(base({ headerToken: 'different-token' }))).toBe(false);
  });

  it('rejects a missing header token', () => {
    expect(checkCsrf(base({ headerToken: null }))).toBe(false);
  });

  it('rejects a missing cookie token', () => {
    expect(checkCsrf(base({ cookieToken: null }))).toBe(false);
  });

  it('rejects tokens of differing length without throwing', () => {
    expect(checkCsrf(base({ headerToken: `${TOKEN}extra` }))).toBe(false);
  });
});
