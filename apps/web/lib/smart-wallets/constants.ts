// ERC-4337 v0.7 constants for the smart-wallet flow (SPEC §6/§8.9).
//
// PURE + dependency-light. Gas limits are deliberately GENEROUS fixed values:
// anvil has no bundler RPC to run `eth_estimateUserOperationGas`, so we ship
// safe ceilings that cover an account-deploying UserOp (initCode) plus an inner
// call. The paymaster's EntryPoint deposit funds the difference; unused gas is
// refunded to the paymaster by the EntryPoint.
import type { EntryPointVersion } from 'viem/account-abstraction';

/** We target EntryPoint v0.7 (PackedUserOperation). */
export const ENTRYPOINT_VERSION: EntryPointVersion = '0.7';

/** Default account salt when the caller does not supply one. */
export const DEFAULT_SALT = 0n;

/** Fixed, generous gas limits for a sponsored UserOp on the test chain. */
export const DEFAULT_USEROP_GAS = {
  /** Covers account initCode deployment + validateUserOp. */
  verificationGasLimit: 1_500_000n,
  /** Covers the inner `execute` call. */
  callGasLimit: 600_000n,
  /** Bundler/batch overhead added to the paid gas. */
  preVerificationGas: 120_000n,
  /** Paymaster `validatePaymasterUserOp` budget. */
  paymasterVerificationGasLimit: 300_000n,
  /** Paymaster `postOp` budget. */
  paymasterPostOpGasLimit: 120_000n,
} as const;

/** Sponsorship validity window (seconds) the paymaster signature is valid for. */
export const SPONSOR_VALIDITY_WINDOW_SEC = 60 * 60; // 1 hour

/**
 * Upper bound on the total gas a sponsored UserOp may consume — the sum of every
 * gas-limit field. Used to compute a worst-case wei cost for the budget cap.
 */
export function totalGasLimit(gas: {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
  preVerificationGas: bigint;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
}): bigint {
  return (
    gas.verificationGasLimit +
    gas.callGasLimit +
    gas.preVerificationGas +
    gas.paymasterVerificationGasLimit +
    gas.paymasterPostOpGasLimit
  );
}
