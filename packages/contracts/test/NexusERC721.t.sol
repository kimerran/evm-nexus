// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {NexusERC721} from "../src/NexusERC721.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract NexusERC721Test is Test {
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");

    function _deploy(bool mintable, bool burnable, bool pausable) internal returns (NexusERC721) {
        return new NexusERC721(
            "NexusNFT", "NNFT", "https://base.uri/", owner, NexusERC721.Flags(mintable, burnable, pausable)
        );
    }

    function test_ConstructorGrantsRoles() public {
        NexusERC721 t = _deploy(true, true, true);
        assertTrue(t.hasRole(t.DEFAULT_ADMIN_ROLE(), owner));
        assertTrue(t.hasRole(t.MINTER_ROLE(), owner));
        assertTrue(t.hasRole(t.PAUSER_ROLE(), owner));
    }

    function test_MintUsesBaseURIThenPerTokenURI() public {
        NexusERC721 t = _deploy(true, false, false);
        vm.startPrank(owner);
        uint256 id0 = t.safeMint(alice, "");
        uint256 id1 = t.safeMint(alice, "special.json");
        vm.stopPrank();
        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(t.ownerOf(0), alice);
        assertEq(t.tokenURI(0), "https://base.uri/0");
        assertEq(t.tokenURI(1), "https://base.uri/special.json");
    }

    function test_UnauthorizedMintReverts() public {
        NexusERC721 t = _deploy(true, false, false);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, t.MINTER_ROLE())
        );
        vm.prank(alice);
        t.safeMint(alice, "");
    }

    function test_MintRevertsWhenFlagOffEvenIfRoleGranted() public {
        NexusERC721 t = _deploy(false, false, false);
        vm.startPrank(owner);
        t.grantRole(t.MINTER_ROLE(), owner);
        vm.expectRevert(abi.encodeWithSelector(NexusERC721.FeatureDisabled.selector, "mintable"));
        t.safeMint(alice, "");
        vm.stopPrank();
    }

    function test_BurnRemovesToken() public {
        NexusERC721 t = _deploy(true, true, false);
        vm.startPrank(owner);
        uint256 id = t.safeMint(owner, "");
        t.burn(id);
        vm.stopPrank();
        vm.expectRevert();
        t.ownerOf(id);
    }

    function test_BurnRevertsWhenNotBurnable() public {
        NexusERC721 t = _deploy(true, false, false);
        vm.startPrank(owner);
        uint256 id = t.safeMint(owner, "");
        vm.expectRevert(abi.encodeWithSelector(NexusERC721.FeatureDisabled.selector, "burnable"));
        t.burn(id);
        vm.stopPrank();
    }

    function test_PauseBlocksTransfers() public {
        NexusERC721 t = _deploy(true, false, true);
        vm.startPrank(owner);
        uint256 id = t.safeMint(owner, "");
        t.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        t.transferFrom(owner, alice, id);
        vm.stopPrank();
    }

    function test_UnauthorizedPauseReverts() public {
        NexusERC721 t = _deploy(false, false, true);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, t.PAUSER_ROLE())
        );
        vm.prank(alice);
        t.pause();
    }

    function test_PauseRevertsWhenFlagOff() public {
        NexusERC721 t = _deploy(false, false, false);
        vm.startPrank(owner);
        t.grantRole(t.PAUSER_ROLE(), owner);
        vm.expectRevert(abi.encodeWithSelector(NexusERC721.FeatureDisabled.selector, "pausable"));
        t.pause();
        vm.stopPrank();
    }

    function test_SupportsInterfaces() public {
        NexusERC721 t = _deploy(true, true, true);
        assertTrue(t.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(t.supportsInterface(0x5b5e139f)); // ERC721Metadata
        assertTrue(t.supportsInterface(0x7965db0b)); // AccessControl (IAccessControl)
    }
}
