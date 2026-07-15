// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721Burnable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import {ERC721Pausable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title NexusERC721
/// @notice Configurable NFT collection template. A single precompiled artifact
///         covers every feature combination: OZ mixins are always inherited and
///         gated at runtime by the immutable {Flags} chosen at construction, so
///         the app never compiles Solidity per request (AGENT.md §7).
/// @dev Constructor: (name, symbol, baseURI, owner, flags). Per-token URIs via
///      {ERC721URIStorage} layer on top of the collection base URI.
contract NexusERC721 is ERC721, ERC721URIStorage, ERC721Pausable, ERC721Burnable, AccessControl {
    /// @notice Role permitted to mint tokens (granted to owner iff `mintable`).
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    /// @notice Role permitted to pause/unpause transfers (granted to owner iff `pausable`).
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Opt-in feature selectors, fixed at deploy time.
    struct Flags {
        bool mintable;
        bool burnable;
        bool pausable;
    }

    /// @notice The feature flags this instance was deployed with.
    Flags public flags;

    string private _baseTokenURI;
    uint256 private _nextTokenId;

    /// @dev Thrown when a call targets a feature that was not enabled at deploy time.
    error FeatureDisabled(string feature);

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_,
        address owner,
        Flags memory flags_
    ) ERC721(name_, symbol_) {
        flags = flags_;
        _baseTokenURI = baseURI_;
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        if (flags_.mintable) {
            _grantRole(MINTER_ROLE, owner);
        }
        if (flags_.pausable) {
            _grantRole(PAUSER_ROLE, owner);
        }
    }

    /// @notice Mint the next sequential token to `to` with an optional per-token URI.
    /// @dev Requires MINTER_ROLE and the `mintable` flag. Pass an empty `uri` to
    ///      rely solely on the collection base URI.
    function safeMint(address to, string memory uri) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        if (!flags.mintable) {
            revert FeatureDisabled("mintable");
        }
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        if (bytes(uri).length > 0) {
            _setTokenURI(tokenId, uri);
        }
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

    /// @inheritdoc ERC721Burnable
    function burn(uint256 tokenId) public override {
        if (!flags.burnable) {
            revert FeatureDisabled("burnable");
        }
        super.burn(tokenId);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // --- Required multiple-inheritance overrides ---

    /// @dev Resolves the diamond between {ERC721} and {ERC721Pausable}.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Pausable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
