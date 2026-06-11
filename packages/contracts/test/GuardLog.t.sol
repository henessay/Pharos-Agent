// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { GuardLog } from "../src/GuardLog.sol";

contract GuardLogTest is Test {
    GuardLog internal guardLog;

    address internal reporter = makeAddr("reporter");
    address internal other = makeAddr("other");

    event VerdictLogged(
        address indexed reporter,
        bytes32 indexed intentHash,
        uint8 verdict,
        string reason,
        uint256 timestamp
    );

    function setUp() public {
        vm.warp(1_700_000_000);
        guardLog = new GuardLog();
    }

    function test_StartsAtZero() public view {
        assertEq(guardLog.verdictCount(reporter), 0);
    }

    function test_LogVerdict_EmitsAndCounts() public {
        bytes32 intent = keccak256("intent-1");

        vm.expectEmit(true, true, false, true);
        emit VerdictLogged(reporter, intent, 2, "over daily limit", block.timestamp);

        vm.prank(reporter);
        guardLog.logVerdict(intent, 2, "over daily limit");

        assertEq(guardLog.verdictCount(reporter), 1);
    }

    function test_LogVerdict_AcceptsAllValidVerdicts() public {
        vm.startPrank(reporter);
        guardLog.logVerdict(keccak256("a"), guardLog.VERDICT_ALLOW(), "allow");
        guardLog.logVerdict(keccak256("b"), guardLog.VERDICT_WARN(), "warn");
        guardLog.logVerdict(keccak256("c"), guardLog.VERDICT_BLOCK(), "block");
        vm.stopPrank();

        assertEq(guardLog.verdictCount(reporter), 3);
    }

    function test_LogVerdict_RevertsOnInvalidVerdict() public {
        vm.expectRevert(abi.encodeWithSelector(GuardLog.InvalidVerdict.selector, uint8(3)));
        guardLog.logVerdict(keccak256("x"), 3, "bad");
    }

    function test_VerdictCount_IsPerReporter() public {
        vm.prank(reporter);
        guardLog.logVerdict(keccak256("a"), 0, "ok");

        vm.prank(other);
        guardLog.logVerdict(keccak256("b"), 1, "warn");
        vm.prank(other);
        guardLog.logVerdict(keccak256("c"), 0, "ok");

        assertEq(guardLog.verdictCount(reporter), 1);
        assertEq(guardLog.verdictCount(other), 2);
    }
}
