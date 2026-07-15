import { beforeAll, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { computeContentHash, buildCommitCalldata } from './chatlog';
import { encodeChatDraft, decodeChatDraft, type ChatCommitDraft } from './draft';
import { parseSignedCommit, assertCommitWithinPolicy } from './verify';
import { DEFAULT_CHAT_CEILINGS } from './ceilings';

// chatlog.ts + ceilings.ts import the prisma singleton; the pure helpers under
// test never touch it, so a stub keeps the import graph DB-free. (vitest hoists
// vi.mock above the imports.)
vi.mock('@/lib/db', () => ({ prisma: {} }));

beforeAll(() => {
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.SESSION_SECRET ??= 's'.repeat(32);
  process.env.ENCRYPTION_KEY ??= 'k'.repeat(32);
  process.env.CSRF_SECRET ??= 'c'.repeat(16);
  process.env.DATABASE_URL ??= 'postgresql://nexus:nexus@localhost:5432/evm_nexus';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
});

// Anvil funded key #0 — TEST CHAIN ONLY.
const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const CHAT_LOG = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const CHAIN_ID = 31337;

describe('computeContentHash (tamper-evidence)', () => {
  it('is deterministic for the same body', () => {
    expect(computeContentHash('hello', null)).toBe(computeContentHash('hello', null));
  });

  it('changes when the body is tampered', () => {
    expect(computeContentHash('hello', null)).not.toBe(computeContentHash('hell0', null));
  });

  it('folds the attachment key into the preimage', () => {
    expect(computeContentHash('hi', 'uploads/u/a.png')).not.toBe(computeContentHash('hi', null));
  });
});

describe('chat commit draft', () => {
  function draft(overrides: Partial<ChatCommitDraft> = {}): ChatCommitDraft {
    const contentHash = computeContentHash('hello world', null);
    return {
      v: 1,
      userId: 'user-1',
      networkId: 'net-1',
      chainId: CHAIN_ID,
      messageId: 'msg-1',
      contentHash,
      from: privateKeyToAccount(PK).address,
      txTo: CHAT_LOG,
      txValue: '0',
      data: buildCommitCalldata(contentHash, 'msg-1'),
      maxGas: DEFAULT_CHAT_CEILINGS.maxGas.toString(),
      maxFeePerGasWei: DEFAULT_CHAT_CEILINGS.maxFeePerGasWei.toString(),
      exp: Date.now() + 60_000,
      ...overrides,
    };
  }

  it('round-trips through encode/decode', () => {
    const d = draft();
    const decoded = decodeChatDraft(encodeChatDraft(d));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.draft.contentHash).toBe(d.contentHash);
  });

  it('rejects a tampered payload (bad signature)', () => {
    const token = encodeChatDraft(draft());
    const [payload, mac] = token.split('.');
    const tampered = `${payload}x.${mac}`;
    expect(decodeChatDraft(tampered).ok).toBe(false);
  });

  it('rejects an expired draft', () => {
    const decoded = decodeChatDraft(encodeChatDraft(draft({ exp: Date.now() - 1 })));
    expect(decoded.ok).toBe(false);
  });
});

describe('sign -> verify commit round-trip', () => {
  async function signCommit(overrides: {
    to?: Hex;
    value?: bigint;
    data?: Hex;
    chainId?: number;
  }): Promise<Hex> {
    const account = privateKeyToAccount(PK);
    const contentHash = computeContentHash('hello world', null);
    return account.signTransaction({
      type: 'eip1559',
      chainId: overrides.chainId ?? CHAIN_ID,
      nonce: 0,
      to: overrides.to ?? (CHAT_LOG as Hex),
      value: overrides.value ?? 0n,
      data: overrides.data ?? buildCommitCalldata(contentHash, 'msg-1'),
      gas: 100_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    });
  }

  function ctx(d: ChatCommitDraft) {
    return { draft: d, activeChainId: CHAIN_ID, ceilings: DEFAULT_CHAT_CEILINGS };
  }

  const goodDraft = (): ChatCommitDraft => {
    const contentHash = computeContentHash('hello world', null);
    return {
      v: 1,
      userId: 'u',
      networkId: 'n',
      chainId: CHAIN_ID,
      messageId: 'msg-1',
      contentHash,
      from: privateKeyToAccount(PK).address,
      txTo: CHAT_LOG,
      txValue: '0',
      data: buildCommitCalldata(contentHash, 'msg-1'),
      maxGas: DEFAULT_CHAT_CEILINGS.maxGas.toString(),
      maxFeePerGasWei: DEFAULT_CHAT_CEILINGS.maxFeePerGasWei.toString(),
      exp: Date.now() + 60_000,
    };
  };

  it('accepts a correctly-signed commit (verified)', async () => {
    const raw = await signCommit({});
    const parsed = await parseSignedCommit(raw);
    expect(() => assertCommitWithinPolicy(parsed, ctx(goodDraft()))).not.toThrow();
    // The on-chain contentHash (from the calldata) matches the recomputed body hash.
    expect(parsed.data).toBe(goodDraft().data);
  });

  it('REJECTS a commit that moves value', async () => {
    const raw = await signCommit({ value: 1n });
    const parsed = await parseSignedCommit(raw);
    expect(() => assertCommitWithinPolicy(parsed, ctx(goodDraft()))).toThrow(/value/i);
  });

  it('REJECTS a commit whose data was tampered (hash mismatch)', async () => {
    const tamperedHash = computeContentHash('TAMPERED body', null);
    const raw = await signCommit({ data: buildCommitCalldata(tamperedHash, 'msg-1') });
    const parsed = await parseSignedCommit(raw);
    expect(() => assertCommitWithinPolicy(parsed, ctx(goodDraft()))).toThrow(/data/i);
  });

  it('REJECTS a commit redirected to another contract', async () => {
    const raw = await signCommit({ to: '0x000000000000000000000000000000000000dEaD' });
    const parsed = await parseSignedCommit(raw);
    expect(() => assertCommitWithinPolicy(parsed, ctx(goodDraft()))).toThrow(/ChatLog/i);
  });

  it('REJECTS a wrong-chain commit', async () => {
    const raw = await signCommit({ chainId: 1 });
    const parsed = await parseSignedCommit(raw);
    expect(() => assertCommitWithinPolicy(parsed, ctx(goodDraft()))).toThrow(/chainId/i);
  });
});
