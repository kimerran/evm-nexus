import { beforeAll, describe, expect, it } from 'vitest';

// draft.ts signs with SESSION_SECRET via the validated env module, so provide a
// minimal valid env before importing it (mirrors at-rest.test.ts).
beforeAll(() => {
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.SESSION_SECRET ??= 's'.repeat(32);
  process.env.ENCRYPTION_KEY ??= 'k'.repeat(32);
  process.env.CSRF_SECRET ??= 'c'.repeat(16);
  process.env.DATABASE_URL ??= 'postgresql://nexus:nexus@localhost:5432/evm_nexus';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
});

function sampleDraft(exp: number) {
  return {
    v: 1 as const,
    userId: 'user-1',
    networkId: 'net-1',
    chainId: 31337,
    standard: 'ERC20' as const,
    contractName: 'NexusERC20' as const,
    ownerAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    name: 'Nexus Gold',
    symbol: 'NXG',
    initialSupply: '1000',
    baseUri: null,
    features: { mintable: true },
    data: '0xdeadbeef' as const,
    maxGas: '15000000',
    maxValueWei: '0',
    maxFeePerGasWei: '1000000000000',
    exp,
  };
}

describe('deployment draft token (HMAC signed, opaque)', () => {
  it('round-trips a valid draft (encode → decode)', async () => {
    const { encodeDraft, decodeDraft } = await import('./draft');
    const draft = sampleDraft(Date.now() + 60_000);
    const token = encodeDraft(draft);
    const decoded = decodeDraft(token);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.draft).toMatchObject({ userId: 'user-1', chainId: 31337, data: '0xdeadbeef' });
    }
  });

  it('rejects a tampered payload (bad signature)', async () => {
    const { encodeDraft, decodeDraft } = await import('./draft');
    const token = encodeDraft(sampleDraft(Date.now() + 60_000));
    const [payload, mac] = token.split('.');
    // Flip a byte in the payload; the mac no longer matches.
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...sampleDraft(Date.now() + 60_000), userId: 'attacker' }),
      'utf8',
    ).toString('base64url');
    expect(tamperedPayload).not.toBe(payload);
    const decoded = decodeDraft(`${tamperedPayload}.${mac}`);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('bad-signature');
  });

  it('rejects an expired draft', async () => {
    const { encodeDraft, decodeDraft } = await import('./draft');
    const token = encodeDraft(sampleDraft(Date.now() - 1_000));
    const decoded = decodeDraft(token);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('expired');
  });

  it('rejects a malformed token', async () => {
    const { decodeDraft } = await import('./draft');
    expect(decodeDraft('not-a-token').ok).toBe(false);
    expect(decodeDraft('.').ok).toBe(false);
  });
});
