// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {NexusERC20} from "../src/NexusERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract NexusERC20Test is Test {
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function _deploy(bool mintable, bool burnable, bool pausable, bool permit) internal returns (NexusERC20) {
        return new NexusERC20(
            "Nexus", "NXS", 1_000 ether, owner, NexusERC20.Flags(mintable, burnable, pausable, permit)
        );
    }

    function test_ConstructorMintsInitialSupplyToOwner() public {
        NexusERC20 t = _deploy(true, true, true, true);
        assertEq(t.totalSupply(), 1_000 ether);
        assertEq(t.balanceOf(owner), 1_000 ether);
        assertTrue(t.hasRole(t.DEFAULT_ADMIN_ROLE(), owner));
        assertTrue(t.hasRole(t.MINTER_ROLE(), owner));
        assertTrue(t.hasRole(t.PAUSER_ROLE(), owner));
    }

    function test_RolesNotGrantedWhenFeaturesDisabled() public {
        NexusERC20 t = _deploy(false, false, false, false);
        assertFalse(t.hasRole(t.MINTER_ROLE(), owner));
        assertFalse(t.hasRole(t.PAUSER_ROLE(), owner));
    }

    // --- mint ---

    function test_MinterCanMint() public {
        NexusERC20 t = _deploy(true, false, false, false);
        vm.prank(owner);
        t.mint(alice, 5 ether);
        assertEq(t.balanceOf(alice), 5 ether);
    }

    function test_UnauthorizedMintReverts() public {
        NexusERC20 t = _deploy(true, false, false, false);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, t.MINTER_ROLE())
        );
        vm.prank(alice);
        t.mint(alice, 1 ether);
    }

    function test_MintRevertsWhenNotMintable() public {
        NexusERC20 t = _deploy(false, false, false, false);
        // owner lacks MINTER_ROLE because feature is off -> access control reverts first.
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, owner, t.MINTER_ROLE())
        );
        vm.prank(owner);
        t.mint(alice, 1 ether);
    }

    function test_MintRevertsWhenFlagOffEvenIfRoleGranted() public {
        // admin grants MINTER_ROLE manually but the flag still gates minting.
        NexusERC20 t = _deploy(false, false, false, false);
        vm.startPrank(owner);
        t.grantRole(t.MINTER_ROLE(), owner);
        vm.expectRevert(abi.encodeWithSelector(NexusERC20.FeatureDisabled.selector, "mintable"));
        t.mint(alice, 1 ether);
        vm.stopPrank();
    }

    // --- burn ---

    function test_BurnReducesSupply() public {
        NexusERC20 t = _deploy(false, true, false, false);
        vm.prank(owner);
        t.burn(100 ether);
        assertEq(t.totalSupply(), 900 ether);
    }

    function test_BurnRevertsWhenNotBurnable() public {
        NexusERC20 t = _deploy(false, false, false, false);
        vm.expectRevert(abi.encodeWithSelector(NexusERC20.FeatureDisabled.selector, "burnable"));
        vm.prank(owner);
        t.burn(1 ether);
    }

    function test_BurnFromRevertsWhenNotBurnable() public {
        NexusERC20 t = _deploy(false, false, false, false);
        vm.expectRevert(abi.encodeWithSelector(NexusERC20.FeatureDisabled.selector, "burnable"));
        vm.prank(bob);
        t.burnFrom(owner, 1 ether);
    }

    // --- pause ---

    function test_PauserCanPauseAndBlockTransfers() public {
        NexusERC20 t = _deploy(false, false, true, false);
        vm.prank(owner);
        t.pause();
        assertTrue(t.paused());
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(owner);
        t.transfer(alice, 1 ether);
    }

    function test_UnpauseRestoresTransfers() public {
        NexusERC20 t = _deploy(false, false, true, false);
        vm.startPrank(owner);
        t.pause();
        t.unpause();
        t.transfer(alice, 1 ether);
        vm.stopPrank();
        assertEq(t.balanceOf(alice), 1 ether);
    }

    function test_UnauthorizedPauseReverts() public {
        NexusERC20 t = _deploy(false, false, true, false);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, t.PAUSER_ROLE())
        );
        vm.prank(alice);
        t.pause();
    }

    function test_PauseRevertsWhenFlagOffEvenIfRoleGranted() public {
        NexusERC20 t = _deploy(false, false, false, false);
        vm.startPrank(owner);
        t.grantRole(t.PAUSER_ROLE(), owner);
        vm.expectRevert(abi.encodeWithSelector(NexusERC20.FeatureDisabled.selector, "pausable"));
        t.pause();
        vm.stopPrank();
    }

    // --- permit ---

    function test_PermitSetsAllowance() public {
        NexusERC20 t = _deploy(false, false, false, true);
        (address signer, uint256 pk) = makeAddrAndKey("signer");
        vm.prank(owner);
        t.transfer(signer, 10 ether);

        uint256 deadline = block.timestamp + 1 days;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                signer,
                bob,
                5 ether,
                t.nonces(signer),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", t.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        t.permit(signer, bob, 5 ether, deadline, v, r, s);
        assertEq(t.allowance(signer, bob), 5 ether);
    }

    function test_PermitRevertsWhenNotEnabled() public {
        NexusERC20 t = _deploy(false, false, false, false);
        vm.expectRevert(abi.encodeWithSelector(NexusERC20.FeatureDisabled.selector, "permit"));
        t.permit(owner, bob, 1 ether, block.timestamp + 1 days, 27, bytes32(0), bytes32(0));
    }
}
