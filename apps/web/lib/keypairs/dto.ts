// Keypair → client DTO (SPEC §8.3). Returns ONLY the public, non-custodial view:
// id, label, checksummed address, the opaque encrypted keystore blob (which the
// server cannot decrypt — safe to return for cross-device re-import), the
// ephemeral flag, and createdAt. There is no plaintext-key field to leak.
import type { Keypair } from '@/lib/generated/prisma/client';
import type { EncryptedKeystoreV3 } from '@/lib/crypto/keystore-schema';

export interface KeypairDto {
  id: string;
  label: string;
  address: string;
  /** Opaque client-encrypted keystore blob, or null if none was persisted. */
  encryptedKeystore: EncryptedKeystoreV3 | null;
  isEphemeral: boolean;
  createdAt: string;
}

/** Reduce a Keypair row to its secret-free client DTO. */
export function toKeypairDto(keypair: Keypair): KeypairDto {
  return {
    id: keypair.id,
    label: keypair.label,
    address: keypair.address,
    encryptedKeystore: (keypair.encryptedKeystore as EncryptedKeystoreV3 | null) ?? null,
    isEphemeral: keypair.isEphemeral,
    createdAt: keypair.createdAt.toISOString(),
  };
}
