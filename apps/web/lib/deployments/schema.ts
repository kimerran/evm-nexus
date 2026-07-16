// Zod schemas for the deployment flow (SPEC §8.5, AGENT.md §3/§4).
//
// Validates at the boundary and NORMALIZES: `ownerAddress` is checksummed with
// viem `getAddress`, `initialSupply` stays a wei STRING (parsed to bigint only in
// memory, never `Number()`-ed), unknown keys are rejected. The estimate body is a
// discriminated union on `standard` so each token standard only accepts its own
// fields + feature flags. `networkId` is optional and only ever compared against
// the active network downstream (deploys only ever target the approved chain).
import { z } from 'zod';
import { getAddress, isAddress } from 'viem';

const ownerAddress = z
  .string()
  .trim()
  .refine((v) => isAddress(v), { message: 'ownerAddress must be a valid EVM address.' })
  .transform((v) => getAddress(v));

const weiString = z
  .string()
  .trim()
  .regex(/^[0-9]+$/, { message: 'initialSupply must be a wei string (digits only).' })
  .max(78, { message: 'initialSupply is out of range.' });

const name = z.string().trim().min(1, 'name is required.').max(64, 'name is too long.');
const symbol = z.string().trim().min(1, 'symbol is required.').max(16, 'symbol is too long.');
const baseUri = z.string().trim().max(512, 'baseUri is too long.').optional();
const networkId = z.string().min(1).optional();

const erc20Features = z
  .object({
    mintable: z.boolean().default(false),
    burnable: z.boolean().default(false),
    pausable: z.boolean().default(false),
    permit: z.boolean().default(false),
  })
  .strict();

const erc721Features = z
  .object({
    mintable: z.boolean().default(false),
    burnable: z.boolean().default(false),
    pausable: z.boolean().default(false),
  })
  .strict();

const erc1155Features = z
  .object({
    mintable: z.boolean().default(false),
    burnable: z.boolean().default(false),
    pausable: z.boolean().default(false),
    supply: z.boolean().default(false),
  })
  .strict();

const erc20Schema = z
  .object({
    standard: z.literal('ERC20'),
    networkId,
    ownerAddress,
    name,
    symbol,
    initialSupply: weiString,
    features: erc20Features,
  })
  .strict();

const erc721Schema = z
  .object({
    standard: z.literal('ERC721'),
    networkId,
    ownerAddress,
    name,
    symbol,
    baseUri,
    features: erc721Features,
  })
  .strict();

const erc1155Schema = z
  .object({
    standard: z.literal('ERC1155'),
    networkId,
    ownerAddress,
    baseUri,
    features: erc1155Features,
  })
  .strict();

/** POST /api/deployments/estimate body. */
export const deployEstimateSchema = z.discriminatedUnion('standard', [
  erc20Schema,
  erc721Schema,
  erc1155Schema,
]);

export type DeployRequest = z.infer<typeof deployEstimateSchema>;

/** POST /api/deployments/broadcast body. */
export const deployBroadcastSchema = z
  .object({
    networkId: z.string().min(1).optional(),
    deploymentDraftId: z.string().min(1, 'deploymentDraftId is required.'),
    rawSignedTx: z
      .string()
      .trim()
      .regex(/^0x[0-9a-fA-F]+$/, { message: 'rawSignedTx must be 0x-hex.' }),
  })
  .strict();

export type DeployBroadcastInput = z.infer<typeof deployBroadcastSchema>;
