// Chat-commit chain-safety ceilings (AGENT.md §5, SPEC §11.1).
//
// SERVER-ONLY. A `ChatLog.commit` is a cheap, NON-payable event log — so the
// value ceiling is ZERO (a commit must never move funds) and gas is bounded
// tightly. Loaded from AppSetting with safe fallbacks so the feature works before
// any seed runs; these are the hard limits enforced BEFORE any broadcast.
import { prisma } from '@/lib/db';

export const CHAT_ENABLED_SETTING = 'chat.enabled';
export const CHAT_MAX_GAS_SETTING = 'chat.maxGas';
export const CHAT_MAX_FEE_PER_GAS_WEI_SETTING = 'chat.maxFeePerGasWei';

export interface ChatCeilings {
  enabled: boolean;
  maxGas: bigint;
  /** A commit is never payable — the signed value must be exactly 0. */
  maxValueWei: bigint;
  maxFeePerGasWei: bigint;
}

export const DEFAULT_CHAT_CEILINGS: ChatCeilings = {
  enabled: true,
  maxGas: 200_000n, // an event-only commit is well under this
  maxValueWei: 0n, // non-payable
  maxFeePerGasWei: 1_000_000_000_000n, // 1000 gwei
};

function asBigint(value: unknown, fallback: bigint): bigint {
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return BigInt(value);
  return fallback;
}

/** Load the effective chat ceilings (one query; missing keys fall back to defaults). */
export async function loadChatCeilings(): Promise<ChatCeilings> {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: { in: [CHAT_ENABLED_SETTING, CHAT_MAX_GAS_SETTING, CHAT_MAX_FEE_PER_GAS_WEI_SETTING] },
    },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const enabledRaw = byKey.get(CHAT_ENABLED_SETTING);
  return {
    enabled: enabledRaw === undefined ? DEFAULT_CHAT_CEILINGS.enabled : enabledRaw === true,
    maxGas: asBigint(byKey.get(CHAT_MAX_GAS_SETTING), DEFAULT_CHAT_CEILINGS.maxGas),
    maxValueWei: DEFAULT_CHAT_CEILINGS.maxValueWei,
    maxFeePerGasWei: asBigint(
      byKey.get(CHAT_MAX_FEE_PER_GAS_WEI_SETTING),
      DEFAULT_CHAT_CEILINGS.maxFeePerGasWei,
    ),
  };
}
