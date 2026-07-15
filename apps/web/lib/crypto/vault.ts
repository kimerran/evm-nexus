'use client';

// In-memory keypair vault (SPEC §4.1 "manage offline", AGENT.md §6).
//
// BROWSER-ONLY. Holds decrypted accounts in module memory ONLY — never in
// localStorage/sessionStorage, never on disk, never on the network. The vault is
// wiped on `beforeunload`/`unload` (and best-effort on `pagehide`), so closing or
// refreshing the tab destroys every in-memory private key. "Persisting" a keypair
// stores ONLY its encrypted keystore blob via POST /api/keypairs — never this.
import type { Address, Hex } from 'viem';

interface VaultEntry {
  address: Address;
  privateKey: Hex;
  label: string;
}

// Keyed by lowercased address. Module-scoped so it is shared across the app but
// dies with the page.
const entries = new Map<string, VaultEntry>();

function key(address: Address): string {
  return address.toLowerCase();
}

/** Add / replace an in-memory keypair. The private key lives only here. */
export function putKeypair(entry: VaultEntry): void {
  entries.set(key(entry.address), entry);
}

/** Look up an in-memory keypair by address (for client-side signing). */
export function getKeypair(address: Address): VaultEntry | undefined {
  return entries.get(key(address));
}

/** Remove a single in-memory keypair. */
export function removeKeypair(address: Address): void {
  entries.delete(key(address));
}

/** Snapshot of vault entries (addresses + labels; callers should not log keys). */
export function listKeypairs(): VaultEntry[] {
  return [...entries.values()];
}

/** Wipe every in-memory key. Overwrites nothing sensitive to disk. */
export function clearVault(): void {
  entries.clear();
}

let registered = false;

/**
 * Install the unload handlers that wipe the vault when the tab closes/refreshes.
 * Idempotent and a no-op outside the browser (SSR / tests).
 */
export function registerVaultAutoClear(): void {
  if (registered || typeof window === 'undefined') return;
  registered = true;
  const wipe = () => clearVault();
  window.addEventListener('beforeunload', wipe);
  window.addEventListener('unload', wipe);
  window.addEventListener('pagehide', wipe);
}
