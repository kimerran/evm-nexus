// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

// Compilation anchor for the ERC-4337 v0.7 stack (SPEC §6, AGENT.md §7).
//
// Importing the eth-infinitism v0.7 reference contracts here forces forge to
// compile them so their artifacts (ABI + bytecode) land in out/ and are mirrored
// into @nexus/types by export-artifacts.mjs. We deploy the audited reference
// implementations UNCHANGED — EntryPoint (canonical bundler entry), a
// SimpleAccountFactory (CREATE2 counterfactual accounts) and a VerifyingPaymaster
// (operator-signed gas sponsorship). No custom Solidity is added on top.
import {EntryPoint} from "@account-abstraction/contracts/core/EntryPoint.sol";
import {SimpleAccount} from "@account-abstraction/contracts/samples/SimpleAccount.sol";
import {SimpleAccountFactory} from "@account-abstraction/contracts/samples/SimpleAccountFactory.sol";
import {VerifyingPaymaster} from "@account-abstraction/contracts/samples/VerifyingPaymaster.sol";
