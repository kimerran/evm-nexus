// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChatLog} from "../src/ChatLog.sol";

contract ChatLogTest is Test {
    ChatLog internal chat;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event MessageCommitted(
        address indexed sender, bytes32 indexed contentHash, uint256 timestamp, string ref
    );

    function setUp() public {
        chat = new ChatLog();
    }

    function test_CommitEmitsEvent() public {
        bytes32 hash = keccak256("hello world");
        vm.warp(1_700_000_000);
        vm.expectEmit(true, true, false, true, address(chat));
        emit MessageCommitted(alice, hash, 1_700_000_000, "msg-1");
        vm.prank(alice);
        chat.commit(hash, "msg-1");
    }

    function test_CommitUsesMsgSenderAndBlockTimestamp() public {
        bytes32 hash = keccak256(abi.encodePacked("payload"));
        vm.warp(42);
        vm.expectEmit(true, true, false, true, address(chat));
        emit MessageCommitted(bob, hash, 42, "");
        vm.prank(bob);
        chat.commit(hash, "");
    }

    function test_MultipleCommitsEmitDistinctEvents() public {
        vm.startPrank(alice);
        for (uint256 i = 0; i < 3; i++) {
            bytes32 hash = keccak256(abi.encodePacked("m", i));
            vm.expectEmit(true, true, false, true, address(chat));
            emit MessageCommitted(alice, hash, block.timestamp, "ref");
            chat.commit(hash, "ref");
        }
        vm.stopPrank();
    }

    function test_DifferentSendersRecordedIndependently() public {
        bytes32 h1 = keccak256("from-alice");
        bytes32 h2 = keccak256("from-bob");

        vm.expectEmit(true, true, false, true, address(chat));
        emit MessageCommitted(alice, h1, block.timestamp, "a");
        vm.prank(alice);
        chat.commit(h1, "a");

        vm.expectEmit(true, true, false, true, address(chat));
        emit MessageCommitted(bob, h2, block.timestamp, "b");
        vm.prank(bob);
        chat.commit(h2, "b");
    }
}
