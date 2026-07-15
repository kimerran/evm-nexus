// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {NexusERC1155} from "../src/NexusERC1155.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract NexusERC1155Test is Test {
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");

    function _deploy(bool mintable, bool burnable, bool pausable, bool supply) internal returns (NexusERC1155) {
        return new NexusERC1155("https://base.uri/{id}.json", owner, NexusERC1155.Flags(mintable, burnable, pausable, supply));
    }

    function test_ConstructorGrantsRoles() public {
        NexusERC1155 t = _deploy(true, true, true, true);
        assertTrue(t.hasRole(t.DEFAULT_ADMIN_ROLE(), owner));
        assertTrue(t.hasRole(t.MINTER_ROLE(), owner));
        assertTrue(t.hasRole(t.PAUSER_ROLE(), owner));
        assertTrue(t.hasRole(t.URI_SETTER_ROLE(), owner));
    }

    function test_MinterCanMintAndSupplyTracks() public {
        NexusERC1155 t = _deploy(true, false, false, true);
        vm.prank(owner);
        t.mint(alice, 1, 10, "");
        assertEq(t.balanceOf(alice, 1), 10);
        assertEq(t.totalSupply(1), 10);
        assertTrue(t.exists(1));
    }

    function test_MintBatch() public {
        NexusERC1155 t = _deploy(true, false, false, true);
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;
        amounts[0] = 5;
        amounts[1] = 7;
        vm.prank(owner);
        t.mintBatch(alice, ids, amounts, "");
        assertEq(t.balanceOf(alice, 2), 7);
        assertEq(t.totalSupply(), 12);
    }

    function test_UnauthorizedMintReverts() public {
        NexusERC1155 t = _deploy(true, false, false, false);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, t.MINTER_ROLE())
        );
        vm.prank(alice);
        t.mint(alice, 1, 1, "");
    }

    function test_MintRevertsWhenFlagOff() public {
        NexusERC1155 t = _deploy(false, false, false, false);
        vm.startPrank(owner);
        t.grantRole(t.MINTER_ROLE(), owner);
        vm.expectRevert(abi.encodeWithSelector(NexusERC1155.FeatureDisabled.selector, "mintable"));
        t.mint(alice, 1, 1, "");
        vm.stopPrank();
    }

    function test_BurnReducesSupply() public {
        NexusERC1155 t = _deploy(true, true, false, true);
        vm.startPrank(owner);
        t.mint(owner, 1, 10, "");
        t.burn(owner, 1, 4);
        vm.stopPrank();
        assertEq(t.totalSupply(1), 6);
    }

    function test_BurnRevertsWhenNotBurnable() public {
        NexusERC1155 t = _deploy(true, false, false, false);
        vm.startPrank(owner);
        t.mint(owner, 1, 10, "");
        vm.expectRevert(abi.encodeWithSelector(NexusERC1155.FeatureDisabled.selector, "burnable"));
        t.burn(owner, 1, 1);
        vm.stopPrank();
    }

    function test_PauseBlocksTransfers() public {
        NexusERC1155 t = _deploy(true, false, true, false);
        vm.startPrank(owner);
        t.mint(owner, 1, 10, "");
        t.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        t.safeTransferFrom(owner, alice, 1, 1, "");
        vm.stopPrank();
    }

    function test_UnauthorizedPauseReverts() public {
        NexusERC1155 t = _deploy(false, false, true, false);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, t.PAUSER_ROLE())
        );
        vm.prank(alice);
        t.pause();
    }

    function test_PauseRevertsWhenFlagOff() public {
        NexusERC1155 t = _deploy(false, false, false, false);
        vm.startPrank(owner);
        t.grantRole(t.PAUSER_ROLE(), owner);
        vm.expectRevert(abi.encodeWithSelector(NexusERC1155.FeatureDisabled.selector, "pausable"));
        t.pause();
        vm.stopPrank();
    }

    function test_SetURI() public {
        NexusERC1155 t = _deploy(true, false, false, false);
        vm.prank(owner);
        t.setURI("https://new.uri/{id}.json");
        assertEq(t.uri(1), "https://new.uri/{id}.json");
    }

    function test_SupportsInterfaces() public {
        NexusERC1155 t = _deploy(true, true, true, true);
        assertTrue(t.supportsInterface(0xd9b67a26)); // ERC1155
        assertTrue(t.supportsInterface(0x7965db0b)); // AccessControl
    }
}
