// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Policy} from "../src/Policy.sol";

contract PolicyTest is Test {
    Policy internal policy;
    address internal owner = address(0xA11CE);
    address internal recipient = address(0xB0B);
    address internal stranger = address(0xCAFE);

    function setUp() public {
        vm.prank(owner);
        policy = new Policy(owner, 1 ether);
    }

    function test_InitialState() public view {
        assertEq(policy.owner(), owner);
        assertEq(policy.perTxLimit(), 1 ether);
        assertTrue(policy.enabled());
    }

    function test_DeniesUnknownRecipient() public view {
        (bool allowed, string memory reason) = policy.check(recipient, 0.5 ether);
        assertFalse(allowed);
        assertEq(reason, "policy:recipient-not-allowed");
    }

    function test_AllowsWhitelistedWithinLimit() public {
        vm.prank(owner);
        policy.setRecipient(recipient, true);

        (bool allowed, string memory reason) = policy.check(recipient, 0.5 ether);
        assertTrue(allowed);
        assertEq(bytes(reason).length, 0);
    }

    function test_DeniesOverLimit() public {
        vm.prank(owner);
        policy.setRecipient(recipient, true);

        (bool allowed, string memory reason) = policy.check(recipient, 2 ether);
        assertFalse(allowed);
        assertEq(reason, "policy:over-per-tx-limit");
    }

    function test_DeniesZeroRecipient() public view {
        (bool allowed, string memory reason) = policy.check(address(0), 0);
        assertFalse(allowed);
        assertEq(reason, "policy:zero-recipient");
    }

    function test_DeniesWhenDisabled() public {
        vm.startPrank(owner);
        policy.setRecipient(recipient, true);
        policy.setEnabled(false);
        vm.stopPrank();

        (bool allowed, string memory reason) = policy.check(recipient, 0.5 ether);
        assertFalse(allowed);
        assertEq(reason, "policy:disabled");
    }

    function test_OnlyOwnerCanSetRecipient() public {
        vm.prank(stranger);
        vm.expectRevert(Policy.NotOwner.selector);
        policy.setRecipient(recipient, true);
    }

    function test_TransferOwnership() public {
        vm.prank(owner);
        policy.transferOwnership(stranger);
        assertEq(policy.owner(), stranger);
    }
}
