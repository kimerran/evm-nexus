// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Burnable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import {ERC1155Pausable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Pausable.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title NexusERC1155
/// @notice Configurable multi-token template. A single precompiled artifact
///         covers every feature combination: OZ mixins are always inherited and
///         gated at runtime by the immutable {Flags} chosen at construction, so
///         the app never compiles Solidity per request (AGENT.md §7).
/// @dev Constructor: (baseURI, owner, flags). `{ERC1155Supply}` per-id totals are
///      always tracked (cheap, read-only) but only surfaced when `supply` is set,
///      matching the opt-in feature list.
contract NexusERC1155 is ERC1155, ERC1155Pausable, ERC1155Burnable, ERC1155Supply, AccessControl {
    /// @notice Role permitted to mint tokens (granted to owner iff `mintable`).
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    /// @notice Role permitted to pause/unpause transfers (granted to owner iff `pausable`).
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice Role permitted to set the collection URI (granted to owner).
    bytes32 public constant URI_SETTER_ROLE = keccak256("URI_SETTER_ROLE");

    /// @notice Opt-in feature selectors, fixed at deploy time.
    struct Flags {
        bool mintable;
        bool burnable;
        bool pausable;
        bool supply;
    }

    /// @notice The feature flags this instance was deployed with.
    Flags public flags;

    /// @dev Thrown when a call targets a feature that was not enabled at deploy time.
    error FeatureDisabled(string feature);

    constructor(string memory baseURI_, address owner, Flags memory flags_) ERC1155(baseURI_) {
        flags = flags_;
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(URI_SETTER_ROLE, owner);
        if (flags_.mintable) {
            _grantRole(MINTER_ROLE, owner);
        }
        if (flags_.pausable) {
            _grantRole(PAUSER_ROLE, owner);
        }
    }

    /// @notice Update the metadata URI for all token ids.
    function setURI(string memory newuri) external onlyRole(URI_SETTER_ROLE) {
        _setURI(newuri);
    }

    /// @notice Mint `amount` of token `id` to `to`. Requires MINTER_ROLE and `mintable`.
    function mint(address to, uint256 id, uint256 amount, bytes memory data) external onlyRole(MINTER_ROLE) {
        if (!flags.mintable) {
            revert FeatureDisabled("mintable");
        }
        _mint(to, id, amount, data);
    }

    /// @notice Batch-mint. Requires MINTER_ROLE and the `mintable` flag.
    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data)
        external
        onlyRole(MINTER_ROLE)
    {
        if (!flags.mintable) {
            revert FeatureDisabled("mintable");
        }
        _mintBatch(to, ids, amounts, data);
    }

    /// @notice Pause all transfers. Requires PAUSER_ROLE and the `pausable` flag.
    function pause() external onlyRole(PAUSER_ROLE) {
        if (!flags.pausable) {
            revert FeatureDisabled("pausable");
        }
        _pause();
    }

    /// @notice Resume transfers. Requires PAUSER_ROLE and the `pausable` flag.
    function unpause() external onlyRole(PAUSER_ROLE) {
        if (!flags.pausable) {
            revert FeatureDisabled("pausable");
        }
        _unpause();
    }

    /// @inheritdoc ERC1155Burnable
    function burn(address account, uint256 id, uint256 value) public override {
        if (!flags.burnable) {
            revert FeatureDisabled("burnable");
        }
        super.burn(account, id, value);
    }

    /// @inheritdoc ERC1155Burnable
    function burnBatch(address account, uint256[] memory ids, uint256[] memory values) public override {
        if (!flags.burnable) {
            revert FeatureDisabled("burnable");
        }
        super.burnBatch(account, ids, values);
    }

    /// @dev Resolves the diamond between {ERC1155}, {ERC1155Pausable} and {ERC1155Supply}.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Pausable, ERC1155Supply)
    {
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
