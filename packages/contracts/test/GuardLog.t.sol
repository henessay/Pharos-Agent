// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {GuardLog} from "../src/GuardLog.sol";

contract GuardLogTest is Test {
    GuardLog internal guardLog;
    address internal agent = address(0xA6E47);

    function setUp() public {
        guardLog = new GuardLog();
    }

    function test_StartsEmpty() public view {
        assertEq(guardLog.count(), 0);
    }

    function test_RecordsEntry() public {
        bytes32 digest = keccak256("tx-1");
        uint256 idx = guardLog.record(digest, agent, true, "policy:ok");

        assertEq(idx, 0);
        assertEq(guardLog.count(), 1);

        GuardLog.Entry memory e = guardLog.entryAt(0);
        assertEq(e.txDigest, digest);
        assertEq(e.agent, agent);
        assertTrue(e.allowed);
        assertEq(e.reason, "policy:ok");
    }

    function test_EmitsEvent() public {
        bytes32 digest = keccak256("tx-2");
        vm.expectEmit(true, true, true, true);
        emit GuardLog.Recorded(0, digest, agent, false, "policy:over-per-tx-limit");
        guardLog.record(digest, agent, false, "policy:over-per-tx-limit");
    }

    function test_AppendsInOrder() public {
        guardLog.record(keccak256("a"), agent, true, "ok");
        guardLog.record(keccak256("b"), agent, false, "deny");
        assertEq(guardLog.count(), 2);
        assertTrue(guardLog.entryAt(0).allowed);
        assertFalse(guardLog.entryAt(1).allowed);
    }
}
