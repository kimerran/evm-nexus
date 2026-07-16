// Zod schemas for the bombard flow (SPEC §8.7, AGENT.md §3/§4).
//
// Validates at the boundary and NORMALIZES: addresses are checksummed, counts are
// bounded integers, per-tx amount stays a decimal wei STRING (never `Number()`-ed
// into a float), unknown keys are rejected. Hard ceilings (tps/total/value/allow-
// list) are enforced downstream by evaluateBombardCeilings against the live
// config; the schema only bounds shape + obvious out-of-range values.
import { z } from 'zod';
import { getAddress, isAddress } from 'viem';

const address = z
  .string()
  .trim()
  .refine((v) => isAddress(v), { message: 'must be a valid EVM address.' })
  .transform((v) => getAddress(v));

const weiString = z
  .string()
  .trim()
  .regex(/^[0-9]+$/, { message: 'amountPerTx must be a non-negative integer (wei) string.' })
  .max(78, { message: 'amountPerTx is out of range.' });

/** POST /api/bombard/prepare body. */
export const bombardPrepareSchema = z
  .object({
    networkId: z.string().min(1).optional(),
    mode: z.enum(['CLIENT_SIGNED', 'RELAYER']).default('CLIENT_SIGNED'),
    from: address,
    to: address,
    // Absolute integer bounds; the live ceiling (min of env + AppSetting) is the
    // real limit and is checked server-side after load.
    targetTps: z.number().int().positive().max(1_000_000),
    totalCount: z.number().int().positive().max(10_000_000),
    /** Native value per tx in wei; defaults to 1 wei (cheapest value-moving tx). */
    amountPerTx: weiString.optional().default('1'),
  })
  .strict();

export type BombardPrepareInput = z.infer<typeof bombardPrepareSchema>;

/** A single client-signed raw tx (0x-hex). */
const rawSignedTx = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]+$/, { message: 'rawSignedTx must be 0x-hex.' });

/** POST /api/bombard/start body. */
export const bombardStartSchema = z
  .object({
    runId: z.string().min(1, 'runId is required.'),
    planToken: z.string().min(1, 'planToken is required.'),
    // Present for CLIENT_SIGNED mode (the bulk-pre-signed txs); omitted for RELAYER.
    rawSignedTxs: z.array(rawSignedTx).max(10_000_000).optional(),
  })
  .strict();

export type BombardStartInput = z.infer<typeof bombardStartSchema>;
