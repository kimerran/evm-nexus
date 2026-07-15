// Zod schema for POST /api/faucet/request (SPEC §8.4, AGENT.md §3/§4).
//
// Validates at the boundary and NORMALIZES: the address is checksummed with
// viem `getAddress` (stored/queried consistently checksummed), the amount stays
// a wei STRING (parsed to bigint only in memory, never `Number()`-ed). Unknown
// keys are rejected. `networkId` is optional and only ever compared against the
// active network downstream.
import { z } from 'zod';
import { getAddress, isAddress } from 'viem';

export const faucetRequestSchema = z
  .object({
    toAddress: z
      .string()
      .trim()
      .refine((v) => isAddress(v), { message: 'toAddress must be a valid EVM address.' })
      // Normalize to a checksummed address (consistent at-rest form).
      .transform((v) => getAddress(v)),
    // Wei as a decimal string; never a float. Bounded length guards against
    // absurd inputs before we ever build a BigInt.
    amount: z
      .string()
      .trim()
      .regex(/^[0-9]+$/, { message: 'amount must be a wei string (digits only).' })
      .max(40, { message: 'amount is out of range.' })
      // Guard the digits-only shape inside the refine too: zod runs every check
      // even after the regex fails, so a bare `BigInt(v)` on e.g. "1.5" would
      // throw instead of producing a clean validation error.
      .refine((v) => /^[0-9]+$/.test(v) && BigInt(v) > 0n, {
        message: 'amount must be greater than zero.',
      }),
    networkId: z.string().min(1).optional(),
  })
  .strict();

export type FaucetRequestInput = z.infer<typeof faucetRequestSchema>;
