// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title NexusERC20
/// @notice Configurable fungible token template. A single precompiled artifact
///         covers every feature combination: the OZ mixins are always inherited
///         and gated at runtime by the immutable {Flags} chosen at construction,
///         so the app never compiles Solidity per request (AGENT.md §7).
/// @dev Constructor: (name, symbol, initialSupply, owner, flags).
contract NexusERC20 is ERC20, ERC20Burnable, ERC20Pausable, ERC20Permit, AccessControl {
    /// @notice Role permitted to mint new supply (granted to owner iff `mintable`).
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    /// @notice Role permitted to pause/unpause transfers (granted to owner iff `pausable`).
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Opt-in feature selectors, fixed at deploy time.
    struct Flags {
        bool mintable;
        bool burnable;
        bool pausable;
        bool permit;
    }

    /// @notice The feature flags this instance was deployed with.
    Flags public flags;

    /// @dev Thrown when a call targets a feature that was not enabled at deploy time.
    error FeatureDisabled(string feature);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply,
        address owner,
        Flags memory flags_
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        flags = flags_;
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        if (flags_.mintable) {
            _grantRole(MINTER_ROLE, owner);
        }
        if (flags_.pausable) {
            _grantRole(PAUSER_ROLE, owner);
        }
        if (initialSupply > 0) {
            _mint(owner, initialSupply);
        }
    }

    /// @notice Mint `amount` to `to`. Requires MINTER_ROLE and the `mintable` flag.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (!flags.mintable) {
            revert FeatureDisabled("mintable");
        }
        _mint(to, amount);
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

    /// @inheritdoc ERC20Burnable
    function burn(uint256 value) public override {
        if (!flags.burnable) {
            revert FeatureDisabled("burnable");
        }
        super.burn(value);
    }

    /// @inheritdoc ERC20Burnable
    function burnFrom(address account, uint256 value) public override {
        if (!flags.burnable) {
            revert FeatureDisabled("burnable");
        }
        super.burnFrom(account, value);
    }

    /// @inheritdoc ERC20Permit
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public override {
        if (!flags.permit) {
            revert FeatureDisabled("permit");
        }
        super.permit(owner, spender, value, deadline, v, r, s);
    }

    /// @dev Resolves the diamond between {ERC20} and {ERC20Pausable}.
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Pausable) {
        super._update(from, to, value);
    }
}
