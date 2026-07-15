// userop-sponsor processor — signs the VerifyingPaymaster `paymasterAndData`
// (SPEC §8.9/§9, AGENT.md §5).
//
// This is the ONLY place the PAYMASTER_SIGNER key is ever loaded. The web
// `/api/userops/sponsor` route enqueues a job and awaits this return value, so
// the key never enters the web process (prime directive). We compute the hash the
// paymaster will validate ON-CHAIN via its own `getHash` view (the authoritative
// source — no chance of an off-chain layout drift), sign the EIP-191 digest of it
// with the paymaster signer, and return the paymaster fields. Nothing is
// persisted; only ids / addresses are logged, never the key or the signature.
import { getContract } from 'viem';
import type { Hex } from 'viem';
import { VerifyingPaymasterAbi } from '@nexus/types';
import { loadNetworkBasic, buildPublicClientForNetwork, buildPaymasterSignerAccount, loadStack } from '../lib/chain';
import { SPONSOR_VALIDITY_WINDOW_SEC } from '../../apps/web/lib/smart-wallets/constants';
import { toPacked, buildPaymasterData } from '../../apps/web/lib/smart-wallets/userop';
import type { UserOpSponsorJobData, UserOpSponsorResult } from '../../apps/web/lib/smart-wallets/keys';

/** Sign the paymaster sponsorship for one UserOp. Returns the paymaster fields. */
export async function processUserOpSponsor(data: UserOpSponsorJobData): Promise<UserOpSponsorResult> {
  const { networkId, userOp } = data;

  const network = await loadNetworkBasic(networkId);
  if (!network) throw new Error(`network ${networkId} not found`);
  const stack = await loadStack(networkId);
  if (!stack) throw new Error(`ERC-4337 stack not deployed on network ${networkId}`);

  const publicClient = buildPublicClientForNetwork(network);
  const signer = buildPaymasterSignerAccount();
  if (signer.address.toLowerCase() !== stack.paymasterSigner.toLowerCase()) {
    throw new Error('PAYMASTER_SIGNER_PRIVATE_KEY does not match the deployed paymaster signer.');
  }

  // Validity window the sponsorship covers.
  const now = Math.floor(Date.now() / 1000);
  const validAfter = 0;
  const validUntil = now + SPONSOR_VALIDITY_WINDOW_SEC;

  // Pack the op WITHOUT paymasterData: paymasterAndData becomes
  // `paymaster ++ verGas ++ postGas` (52 bytes) — exactly the prefix the
  // paymaster's getHash reads the gas limits from.
  const packed = toPacked({ ...userOp, paymasterData: undefined, signature: '0x' });

  const paymaster = getContract({
    address: stack.paymaster,
    abi: VerifyingPaymasterAbi,
    client: publicClient,
  });
  const hash = (await paymaster.read.getHash([packed, validUntil, validAfter])) as Hex;

  // EIP-191 personal-sign of the hash — what the paymaster's ECDSA.recover checks.
  const signature = await signer.signMessage({ message: { raw: hash } });

  return {
    paymaster: stack.paymaster,
    paymasterVerificationGasLimit: userOp.paymasterVerificationGasLimit ?? '0',
    paymasterPostOpGasLimit: userOp.paymasterPostOpGasLimit ?? '0',
    paymasterData: buildPaymasterData(validUntil, validAfter, signature),
    validUntil,
    validAfter,
  };
}
