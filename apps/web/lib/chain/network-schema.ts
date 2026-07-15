// Network config validation (SPEC §8.2, AGENT.md §4 addresses/units, §5 chain).
//
// Every network write is validated here server-side: unknown keys are rejected,
// EVM addresses are checksum-normalized with viem `getAddress`, chainId is a
// positive int, RPC/WS URLs must use an http(s)/ws(s) scheme, and all wei
// amounts are non-negative integer strings (never Float/BigInt columns — money
// stays a decimal string at rest, AGENT.md §4).
import { z } from 'zod';
import { getAddress, isAddress } from 'viem';

/** Non-negative integer wei amount as a decimal string. */
const weiString = z
  .string()
  .trim()
  .regex(/^\d+$/, 'Must be a non-negative integer amount in wei.');

/** Checksummed EVM address (rejects invalid, normalizes case via getAddress). */
const evmAddress = z
  .string()
  .trim()
  .refine((v) => isAddress(v), { message: 'Invalid EVM address.' })
  .transform((v) => getAddress(v));

/** An http(s) or ws(s) RPC endpoint. */
const rpcUrlSchema = z
  .string()
  .trim()
  .url('Must be a valid URL.')
  .refine(
    (v) => {
      try {
        return ['http:', 'https:', 'ws:', 'wss:'].includes(new URL(v).protocol);
      } catch {
        return false;
      }
    },
    { message: 'RPC URL must use http(s) or ws(s).' },
  );

const explorerUrlSchema = z.string().trim().url('Must be a valid URL.');

/** Fields shared by create/update, all optional here; create tightens them. */
const networkFields = {
  name: z.string().trim().min(1, 'Name is required.').max(80),
  chainId: z.coerce.number().int().positive('chainId must be a positive integer.'),
  rpcUrl: rpcUrlSchema,
  wsUrl: rpcUrlSchema.nullable().optional(),
  explorerBaseUrl: explorerUrlSchema.nullable().optional(),
  nativeSymbol: z.string().trim().min(1).max(12).default('ETH'),
  nativeDecimals: z.coerce.number().int().min(0).max(36).default(18),
  isDefault: z.coerce.boolean().default(false),
  isArchival: z.coerce.boolean().default(false),
  faucetEnabled: z.coerce.boolean().default(true),
  faucetDripAmount: weiString.default('5000000000000000000'),
  faucetDailyCap: weiString.default('500000000000000000000'),
  faucetCooldownSec: z.coerce.number().int().min(0).default(86400),
  paymasterAddress: evmAddress.nullable().optional(),
  entryPointAddress: evmAddress.nullable().optional(),
} as const;

/** POST /api/networks — create. */
export const createNetworkSchema = z.object(networkFields).strict();

/** PATCH /api/networks/:id — update (all fields optional, at least one). */
export const updateNetworkSchema = z
  .object({
    name: networkFields.name.optional(),
    chainId: networkFields.chainId.optional(),
    rpcUrl: rpcUrlSchema.optional(),
    wsUrl: rpcUrlSchema.nullable().optional(),
    explorerBaseUrl: explorerUrlSchema.nullable().optional(),
    nativeSymbol: z.string().trim().min(1).max(12).optional(),
    nativeDecimals: z.coerce.number().int().min(0).max(36).optional(),
    isDefault: z.coerce.boolean().optional(),
    isArchival: z.coerce.boolean().optional(),
    faucetEnabled: z.coerce.boolean().optional(),
    faucetDripAmount: weiString.optional(),
    faucetDailyCap: weiString.optional(),
    faucetCooldownSec: z.coerce.number().int().min(0).optional(),
    paymasterAddress: evmAddress.nullable().optional(),
    entryPointAddress: evmAddress.nullable().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

export type CreateNetworkInput = z.infer<typeof createNetworkSchema>;
export type UpdateNetworkInput = z.infer<typeof updateNetworkSchema>;
