// Shared TypeScript types for EVM Nexus. Populated as features land; contract
// types and DTOs are exported from here (AGENT.md §2).

/** A 0x-prefixed, checksummed EVM address. */
export type Address = `0x${string}`;

/** A 0x-prefixed transaction / data hash. */
export type Hex = `0x${string}`;

/**
 * Token/native amounts are carried as decimal **wei strings** at rest and over
 * the wire, and parsed to `bigint` only in memory (AGENT.md §4). Never a float.
 */
export type WeiString = string;

/**
 * Precompiled token-template artifacts (ABI + bytecode) for `Nexus{ERC20,ERC721,
 * ERC1155}`, generated from the Foundry build. The app imports these to deploy
 * via `viem` `deployContract` — Solidity is never compiled at request time
 * (AGENT.md §7, SPEC §6).
 */
export * from "./contracts/index";
