// Zod schemas for the transfer flow (SPEC §8.6, AGENT.md §3/§4).
//
// Validates at the boundary and NORMALIZES: every address is checksummed with
// viem `getAddress`, `amount` (wei / token units) and `tokenId` stay decimal
// STRINGS (parsed to bigint only in memory, never `Number()`-ed), unknown keys
// are rejected. The prepare body is a discriminated union on `kind` so each asset
// kind only accepts its own fields. `networkId` is compared against the active
// network downstream (transfers only ever target the approved chain).
import { z } from 'zod';
import { getAddress, isAddress } from 'viem';

const address = z
  .string()
  .trim()
  .refine((v) => isAddress(v), { message: 'must be a valid EVM address.' })
  .transform((v) => getAddress(v));

const uintString = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^[0-9]+$/, { message: `${label} must be a non-negative integer string.` })
    .max(78, { message: `${label} is out of range.` });

// A transfer amount must be strictly positive (a zero-value transfer is a no-op
// we reject early rather than broadcast).
const amount = uintString('amount').refine((v) => BigInt(v) > 0n, {
  message: 'amount must be greater than zero.',
});

const tokenId = uintString('tokenId');
const networkId = z.string().min(1).optional();
const sponsored = z.boolean().optional().default(false);

const nativeSchema = z
  .object({
    kind: z.literal('NATIVE'),
    networkId,
    from: address,
    to: address,
    amount,
    sponsored,
  })
  .strict();

const erc20Schema = z
  .object({
    kind: z.literal('ERC20'),
    networkId,
    from: address,
    to: address,
    tokenAddress: address,
    amount,
    sponsored,
  })
  .strict();

const erc721Schema = z
  .object({
    kind: z.literal('ERC721'),
    networkId,
    from: address,
    to: address,
    tokenAddress: address,
    tokenId,
    sponsored,
  })
  .strict();

const erc1155Schema = z
  .object({
    kind: z.literal('ERC1155'),
    networkId,
    from: address,
    to: address,
    tokenAddress: address,
    tokenId,
    amount,
    sponsored,
  })
  .strict();

/** POST /api/transfers/prepare body. */
export const transferPrepareSchema = z.discriminatedUnion('kind', [
  nativeSchema,
  erc20Schema,
  erc721Schema,
  erc1155Schema,
]);

export type TransferRequest = z.infer<typeof transferPrepareSchema>;

/** POST /api/transfers/broadcast body (client-signed path). */
export const transferBroadcastSchema = z
  .object({
    networkId: z.string().min(1).optional(),
    transferDraftId: z.string().min(1, 'transferDraftId is required.'),
    rawSignedTx: z
      .string()
      .trim()
      .regex(/^0x[0-9a-fA-F]+$/, { message: 'rawSignedTx must be 0x-hex.' }),
  })
  .strict();

export type TransferBroadcastInput = z.infer<typeof transferBroadcastSchema>;
