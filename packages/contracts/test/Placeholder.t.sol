// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Placeholder} from "../src/Placeholder.sol";

/// @dev Dependency-free test (no forge-std) so Sprint 0 CI needs no git submodule.
///      Later contract suites add forge-std for cheatcodes and rich assertions.
contract PlaceholderTest {
    Placeholder internal placeholder;

    function setUp() public {
        placeholder = new Placeholder();
    }

    function test_Ping() public view {
        require(placeholder.ping(), "ping should return true");
    }
}
