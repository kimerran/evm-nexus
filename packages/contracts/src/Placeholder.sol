// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Placeholder
/// @notice Scaffold-only contract so `forge build` / `forge test` are wired in
///         Sprint 0. The real token templates (Nexus{ERC20,ERC721,ERC1155}),
///         ChatLog, and ERC-4337 factory/paymaster land in later sprints.
contract Placeholder {
    function ping() external pure returns (bool) {
        return true;
    }
}
