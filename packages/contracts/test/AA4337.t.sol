// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {EntryPoint} from "@account-abstraction/contracts/core/EntryPoint.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {SimpleAccount} from "@account-abstraction/contracts/samples/SimpleAccount.sol";
import {SimpleAccountFactory} from "@account-abstraction/contracts/samples/SimpleAccountFactory.sol";
import {VerifyingPaymaster} from "@account-abstraction/contracts/samples/VerifyingPaymaster.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

/// Minimal target the sponsored UserOp calls through the smart account.
contract Counter {
    uint256 public number;

    function increment() external {
        number += 1;
    }
}

/// End-to-end ERC-4337 v0.7 test: counterfactual address prediction, verifying
/// paymaster signature validation, and a sponsored handleOps that deploys the
/// account AND runs an inner call while the account owner EOA pays ZERO gas.
contract AA4337Test is Test {
    EntryPoint internal entryPoint;
    SimpleAccountFactory internal factory;
    VerifyingPaymaster internal paymaster;
    Counter internal counter;

    uint256 internal ownerKey = 0xA11CE;
    address internal owner;
    uint256 internal signerKey = 0xB0B;
    address internal paymasterSigner;
    address payable internal beneficiary = payable(address(0xBEEF));

    function setUp() public {
        entryPoint = new EntryPoint();
        factory = new SimpleAccountFactory(entryPoint);
        paymasterSigner = vm.addr(signerKey);
        paymaster = new VerifyingPaymaster(IEntryPoint(address(entryPoint)), paymasterSigner);
        counter = new Counter();
        owner = vm.addr(ownerKey);

        // Fund the paymaster's EntryPoint deposit so it can prefund gas.
        entryPoint.depositTo{value: 10 ether}(address(paymaster));
    }

    /// The factory's counterfactual address equals the address actually deployed.
    function test_predictedAddressEqualsDeployed() public {
        uint256 salt = 7;
        address predicted = factory.getAddress(owner, salt);
        assertEq(predicted.code.length, 0, "not counterfactual yet");
        SimpleAccount deployed = factory.createAccount(owner, salt);
        assertEq(address(deployed), predicted, "predicted != deployed");
        assertGt(predicted.code.length, 0, "no code after deploy");
    }

    /// A sponsored UserOp deploys the account (initCode) and runs an inner call;
    /// the owner EOA pays nothing and the paymaster's deposit funds the gas.
    function test_sponsoredUserOpLandsOwnerPaysZero() public {
        uint256 salt = 42;
        address sender = factory.getAddress(owner, salt);

        bytes memory initCode = abi.encodePacked(
            address(factory),
            abi.encodeCall(SimpleAccountFactory.createAccount, (owner, salt))
        );
        bytes memory callData = abi.encodeCall(
            SimpleAccount.execute,
            (address(counter), 0, abi.encodeCall(Counter.increment, ()))
        );

        PackedUserOperation memory op = _emptyOp(sender);
        op.initCode = initCode;
        op.callData = callData;
        op.accountGasLimits = _packLimits(1_500_000, 500_000); // verification, call
        op.preVerificationGas = 100_000;
        op.gasFees = _packLimits(1_000_000_000, 20_000_000_000); // maxPriority, maxFee

        _sponsor(op);
        _signOwner(op);

        uint256 ownerBalBefore = owner.balance;
        uint256 pmDepositBefore = entryPoint.balanceOf(address(paymaster));

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        entryPoint.handleOps(ops, beneficiary);

        assertGt(sender.code.length, 0, "account not deployed");
        assertEq(counter.number(), 1, "inner call did not execute");
        assertEq(owner.balance, ownerBalBefore, "owner EOA paid gas");
        assertLt(
            entryPoint.balanceOf(address(paymaster)),
            pmDepositBefore,
            "paymaster deposit did not decrease"
        );
    }

    /// A UserOp whose paymaster signature is from the WRONG signer is rejected by
    /// the EntryPoint (SIG_VALIDATION_FAILED surfaces as a FailedOp revert).
    function test_wrongPaymasterSignerRejected() public {
        uint256 salt = 99;
        address sender = factory.getAddress(owner, salt);
        PackedUserOperation memory op = _emptyOp(sender);
        op.initCode = abi.encodePacked(
            address(factory),
            abi.encodeCall(SimpleAccountFactory.createAccount, (owner, salt))
        );
        op.callData = abi.encodeCall(
            SimpleAccount.execute,
            (address(counter), 0, abi.encodeCall(Counter.increment, ()))
        );
        op.accountGasLimits = _packLimits(1_500_000, 500_000);
        op.preVerificationGas = 100_000;
        op.gasFees = _packLimits(1_000_000_000, 20_000_000_000);

        // Sign the paymaster hash with a bogus key.
        uint48 validUntil = uint48(block.timestamp + 3600);
        uint48 validAfter = 0;
        op.paymasterAndData = abi.encodePacked(address(paymaster), uint128(300_000), uint128(100_000));
        bytes32 pmHash = paymaster.getHash(op, validUntil, validAfter);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(0xDEAD, MessageHashUtils.toEthSignedMessageHash(pmHash));
        op.paymasterAndData = abi.encodePacked(
            address(paymaster),
            uint128(300_000),
            uint128(100_000),
            abi.encode(validUntil, validAfter),
            abi.encodePacked(r, s, v)
        );
        _signOwner(op);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.expectRevert();
        entryPoint.handleOps(ops, beneficiary);
    }

    // --- helpers ---------------------------------------------------------------

    function _emptyOp(address sender) internal pure returns (PackedUserOperation memory op) {
        op.sender = sender;
        op.nonce = 0;
        op.initCode = "";
        op.callData = "";
        op.paymasterAndData = "";
        op.signature = "";
    }

    function _packLimits(uint256 high, uint256 low) internal pure returns (bytes32) {
        return bytes32((high << 128) | low);
    }

    /// Attach a valid paymaster sponsorship signature (as the off-chain service would).
    function _sponsor(PackedUserOperation memory op) internal view {
        uint48 validUntil = uint48(block.timestamp + 3600);
        uint48 validAfter = 0;
        // getHash reads the two gas limits from paymasterAndData[20:52]; set the
        // prefix first so the hash covers them.
        op.paymasterAndData = abi.encodePacked(address(paymaster), uint128(300_000), uint128(100_000));
        bytes32 pmHash = paymaster.getHash(op, validUntil, validAfter);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(signerKey, MessageHashUtils.toEthSignedMessageHash(pmHash));
        op.paymasterAndData = abi.encodePacked(
            address(paymaster),
            uint128(300_000),
            uint128(100_000),
            abi.encode(validUntil, validAfter),
            abi.encodePacked(r, s, v)
        );
    }

    /// Attach the account-owner signature over the userOpHash.
    function _signOwner(PackedUserOperation memory op) internal view {
        bytes32 userOpHash = entryPoint.getUserOpHash(op);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(ownerKey, MessageHashUtils.toEthSignedMessageHash(userOpHash));
        op.signature = abi.encodePacked(r, s, v);
    }
}
