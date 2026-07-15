// Zod schemas for the smart-wallet / UserOp flow (SPEC §8.9, AGENT.md §4/§5).
//
// Validates at the boundary and NORMALIZES: addresses are checksummed via viem
// `getAddress`, amounts/salt stay decimal STRINGS (parsed to bigint only in
// memory, never `Number()`-ed), calldata/hex is 0x-validated, unknown keys are
// rejected. The UserOp submit body accepts the full serialized op the client
// signed; the server independently re-verifies it before bundling.
import { z } from 'zod';
import { getAddress, isAddress } from 'viem';

const address = z
  .string()
  .trim()
  .refine((v) => isAddress(v), { message: 'must be a valid EVM address.' })
  .transform((v) => getAddress(v));

const hex = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]*$/, { message: 'must be 0x-hex.' })
  .transform((v) => v as `0x${string}`);

const uintString = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^[0-9]+$/, { message: `${label} must be a non-negative integer string.` })
    .max(78, { message: `${label} is out of range.` });

const salt = uintString('salt').optional();
const networkId = z.string().min(1).optional();

/** POST /api/smart-accounts/predict — counterfactual address. */
export const predictSchema = z
  .object({ networkId, ownerAddress: address, salt })
  .strict();
export type PredictInput = z.infer<typeof predictSchema>;

/** POST /api/smart-accounts/deploy — build the unsigned factory-create tx. */
export const deployPrepareSchema = z
  .object({ networkId, ownerAddress: address, salt })
  .strict();
export type DeployPrepareInput = z.infer<typeof deployPrepareSchema>;

/** POST /api/smart-accounts/deploy/broadcast — verify + broadcast a signed factory tx. */
export const deployBroadcastSchema = z
  .object({
    networkId,
    deployDraftId: z.string().min(1, 'deployDraftId is required.'),
    rawSignedTx: hex,
  })
  .strict();
export type DeployBroadcastInput = z.infer<typeof deployBroadcastSchema>;

/**
 * POST /api/userops/sponsor — the sponsor request is expressed as a high-level
 * INTENT: the owner + salt (identifying the account) plus a single inner call.
 * The server scaffolds the full UserOp (nonce, fees, gas, initCode, callData),
 * enforces the budget cap, has the worker sign the paymaster data, and returns
 * the fully-sponsored (unsigned) UserOp + userOpHash for the client to sign.
 */
export const sponsorSchema = z
  .object({
    networkId,
    ownerAddress: address,
    salt,
    call: z
      .object({
        to: address,
        value: uintString('value').default('0'),
        data: hex.default('0x'),
      })
      .strict(),
  })
  .strict();
export type SponsorInput = z.infer<typeof sponsorSchema>;

/** A serialized UserOperation as it crosses the wire (numeric fields as strings). */
export const serializedUserOpSchema = z
  .object({
    sender: address,
    nonce: uintString('nonce'),
    factory: address.optional(),
    factoryData: hex.optional(),
    callData: hex,
    callGasLimit: uintString('callGasLimit'),
    verificationGasLimit: uintString('verificationGasLimit'),
    preVerificationGas: uintString('preVerificationGas'),
    maxFeePerGas: uintString('maxFeePerGas'),
    maxPriorityFeePerGas: uintString('maxPriorityFeePerGas'),
    paymaster: address.optional(),
    paymasterVerificationGasLimit: uintString('paymasterVerificationGasLimit').optional(),
    paymasterPostOpGasLimit: uintString('paymasterPostOpGasLimit').optional(),
    paymasterData: hex.optional(),
    signature: hex,
  })
  .strict();

/** POST /api/userops/send — submit the owner-signed, sponsored UserOp. */
export const sendSchema = z
  .object({ networkId, userOp: serializedUserOpSchema })
  .strict();
export type SendInput = z.infer<typeof sendSchema>;
