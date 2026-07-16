import { describe, it, expect } from 'vitest';
import {
  evaluateBombardCeilings,
  isActiveRunStatus,
  isTerminalRunStatus,
  canApplyAction,
  ACTIVE_RUN_STATUSES,
  type BombardCeilings,
  type BombardRequestShape,
} from './policy';

const TO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

const CEILINGS: BombardCeilings = {
  enabled: true,
  maxTps: 1000,
  maxTotal: 1_000_000,
  maxGasPerTx: 100_000n,
  maxValuePerTxWei: 1_000_000_000_000_000_000n, // 1 ETH
  maxFeePerGasWei: 1_000_000_000_000n,
  allowlist: [],
};

const OK: BombardRequestShape = {
  mode: 'CLIENT_SIGNED',
  targetTps: 10,
  totalCount: 50,
  amountPerTxWei: '1',
  to: TO,
};

describe('evaluateBombardCeilings', () => {
  it('accepts a request within every ceiling', () => {
    expect(evaluateBombardCeilings(OK, CEILINGS)).toEqual({ ok: true });
  });

  it('rejects when the global kill-switch is off', () => {
    const r = evaluateBombardCeilings(OK, { ...CEILINGS, enabled: false });
    expect(r).toMatchObject({ ok: false, code: 'disabled' });
  });

  it('rejects targetTps above the ceiling', () => {
    const r = evaluateBombardCeilings({ ...OK, targetTps: 1001 }, CEILINGS);
    expect(r).toMatchObject({ ok: false, code: 'tps-too-high' });
  });

  it('rejects totalCount above the ceiling', () => {
    const r = evaluateBombardCeilings({ ...OK, totalCount: 1_000_001 }, CEILINGS);
    expect(r).toMatchObject({ ok: false, code: 'total-too-high' });
  });

  it('rejects a per-tx value above the ceiling (bigint wei, never Number)', () => {
    const overWei = (CEILINGS.maxValuePerTxWei + 1n).toString();
    const r = evaluateBombardCeilings({ ...OK, amountPerTxWei: overWei }, CEILINGS);
    expect(r).toMatchObject({ ok: false, code: 'value-too-high' });
  });

  it('rejects a relayer run whose target is not allow-listed', () => {
    const r = evaluateBombardCeilings({ ...OK, mode: 'RELAYER' }, CEILINGS);
    expect(r).toMatchObject({ ok: false, code: 'target-not-allowlisted' });
  });

  it('accepts a relayer run whose target IS allow-listed', () => {
    const r = evaluateBombardCeilings(
      { ...OK, mode: 'RELAYER' },
      { ...CEILINGS, allowlist: [TO.toLowerCase()] },
    );
    expect(r).toEqual({ ok: true });
  });

  it('rejects sub-1 tps/total', () => {
    expect(evaluateBombardCeilings({ ...OK, targetTps: 0 }, CEILINGS)).toMatchObject({
      ok: false,
      code: 'tps-too-low',
    });
    expect(evaluateBombardCeilings({ ...OK, totalCount: 0 }, CEILINGS)).toMatchObject({
      ok: false,
      code: 'total-too-low',
    });
  });
});

describe('run-status classification (single-active-run guard)', () => {
  it('treats QUEUED / RUNNING / PAUSED as active', () => {
    expect(ACTIVE_RUN_STATUSES).toEqual(['QUEUED', 'RUNNING', 'PAUSED']);
    expect(isActiveRunStatus('QUEUED')).toBe(true);
    expect(isActiveRunStatus('RUNNING')).toBe(true);
    expect(isActiveRunStatus('PAUSED')).toBe(true);
  });

  it('treats COMPLETED / FAILED / CANCELLED as inactive + terminal', () => {
    for (const s of ['COMPLETED', 'FAILED', 'CANCELLED'] as const) {
      expect(isActiveRunStatus(s)).toBe(false);
      expect(isTerminalRunStatus(s)).toBe(true);
    }
  });
});

describe('canApplyAction (control transitions / kill-switch)', () => {
  it('allows cancel from any active status', () => {
    expect(canApplyAction('RUNNING', 'cancel')).toBe(true);
    expect(canApplyAction('QUEUED', 'cancel')).toBe(true);
    expect(canApplyAction('PAUSED', 'cancel')).toBe(true);
  });

  it('forbids cancel of an already-terminal run', () => {
    expect(canApplyAction('COMPLETED', 'cancel')).toBe(false);
    expect(canApplyAction('CANCELLED', 'cancel')).toBe(false);
  });

  it('allows pause only from RUNNING and resume only from PAUSED', () => {
    expect(canApplyAction('RUNNING', 'pause')).toBe(true);
    expect(canApplyAction('QUEUED', 'pause')).toBe(false);
    expect(canApplyAction('PAUSED', 'resume')).toBe(true);
    expect(canApplyAction('RUNNING', 'resume')).toBe(false);
  });
});
