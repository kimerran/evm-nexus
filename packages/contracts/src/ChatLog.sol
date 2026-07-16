// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ChatLog
/// @notice A stateless on-chain event logger for the EVM Nexus chat feature
///         (SPEC §6/§8.8). Messages themselves live OFF-CHAIN; only a keccak256
///         `contentHash` (computed off-chain over the message body + optional
///         attachment key) is committed here, making a message TAMPER-EVIDENT:
///         anyone can recompute the hash of the stored body and compare it to the
///         indexed `contentHash` in the emitted event.
/// @dev Deliberately holds NO storage and needs NO OpenZeppelin — it only emits an
///      event. A single instance is deployed once per network (address stored in
///      the app's AppSetting) and every user commits through it.
contract ChatLog {
    /// @notice Emitted on every {commit}. `sender` and `contentHash` are indexed so
    ///         clients can filter a user's commits or look up a specific hash.
    /// @param sender      The account that signed the commit tx.
    /// @param contentHash keccak256 of the off-chain message content.
    /// @param timestamp   The block timestamp the commit was mined in.
    /// @param ref         An opaque off-chain reference (e.g. the message id).
    event MessageCommitted(
        address indexed sender, bytes32 indexed contentHash, uint256 timestamp, string ref
    );

    /// @notice Commit a message content hash on-chain. Emits {MessageCommitted}.
    /// @param contentHash keccak256 of the off-chain content (never the plaintext).
    /// @param ref         An opaque off-chain reference string (may be empty).
    function commit(bytes32 contentHash, string calldata ref) external {
        emit MessageCommitted(msg.sender, contentHash, block.timestamp, ref);
    }
}
