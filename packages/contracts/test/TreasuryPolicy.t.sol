// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { TreasuryPolicy } from "../src/TreasuryPolicy.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

contract TreasuryPolicyTest is Test {
    TreasuryPolicy internal policy;
    MockERC20 internal token;

    address internal agent = makeAddr("agent");
    address internal alice = makeAddr("alice"); // whitelisted recipient
    address internal bob = makeAddr("bob"); // NOT whitelisted

    bytes32 internal constant OK = bytes32("OK");
    bytes32 internal constant NOT_WHITELISTED = bytes32("NOT_WHITELISTED");
    bytes32 internal constant EXCEEDS_MAX_PER_TX = bytes32("EXCEEDS_MAX_PER_TX");
    bytes32 internal constant EXCEEDS_DAILY_LIMIT = bytes32("EXCEEDS_DAILY_LIMIT");
    bytes32 internal constant NO_LIMITS_SET = bytes32("NO_LIMITS_SET");

    uint256 internal constant MAX_PER_TX = 1 ether;
    uint256 internal constant DAILY_LIMIT = 5 ether;

    event AgentUpdated(address indexed previousAgent, address indexed newAgent);
    event RecipientUpdated(address indexed recipient, bool allowed);
    event LimitsUpdated(address indexed token, uint256 maxPerTx, uint256 dailyLimit);
    event PaymentExecuted(
        address indexed token, address indexed to, uint256 amount, uint256 indexed day
    );
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    function setUp() public {
        // Start at a non-zero, day-aligned timestamp for predictable day math.
        vm.warp(1_700_000_000);

        policy = new TreasuryPolicy(); // owner == address(this)
        token = new MockERC20();

        policy.setAgent(agent);
        policy.setRecipient(alice, true);
        policy.setLimits(address(0), MAX_PER_TX, DAILY_LIMIT);
        policy.setLimits(address(token), MAX_PER_TX, DAILY_LIMIT);

        // Fund the treasury.
        vm.deal(address(policy), 100 ether);
        token.mint(address(policy), 100 ether);
    }

    function _day() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }

    // -------------------------------------------------------------------
    // checkPayment — every reason-code branch
    // -------------------------------------------------------------------

    function test_Check_OK() public view {
        (bool allowed, bytes32 code) = policy.checkPayment(address(0), alice, 0.5 ether);
        assertTrue(allowed);
        assertEq(code, OK);
    }

    function test_Check_NotWhitelisted() public view {
        (bool allowed, bytes32 code) = policy.checkPayment(address(0), bob, 0.5 ether);
        assertFalse(allowed);
        assertEq(code, NOT_WHITELISTED);
    }

    function test_Check_NoLimitsSet() public view {
        // alice is whitelisted, but this token has no limits configured.
        (bool allowed, bytes32 code) = policy.checkPayment(address(0xDEAD), alice, 1);
        assertFalse(allowed);
        assertEq(code, NO_LIMITS_SET);
    }

    function test_Check_ExceedsMaxPerTx() public view {
        (bool allowed, bytes32 code) = policy.checkPayment(address(0), alice, 2 ether);
        assertFalse(allowed);
        assertEq(code, EXCEEDS_MAX_PER_TX);
    }

    function test_Check_ExceedsDailyLimit() public {
        // Spend up to the daily limit (5 x 1 ether), then one more would exceed it.
        vm.startPrank(agent);
        for (uint256 i; i < 5; ++i) {
            policy.executePayment(address(0), alice, 1 ether);
        }
        vm.stopPrank();

        assertEq(policy.spentOnDay(address(0), _day()), DAILY_LIMIT);

        (bool allowed, bytes32 code) = policy.checkPayment(address(0), alice, 1 ether);
        assertFalse(allowed);
        assertEq(code, EXCEEDS_DAILY_LIMIT);
    }

    // -------------------------------------------------------------------
    // executePayment — native
    // -------------------------------------------------------------------

    function test_ExecutePayment_Native() public {
        uint256 balBefore = alice.balance;

        vm.expectEmit(true, true, true, true);
        emit PaymentExecuted(address(0), alice, 1 ether, _day());

        vm.prank(agent);
        policy.executePayment(address(0), alice, 1 ether);

        assertEq(alice.balance, balBefore + 1 ether);
        assertEq(policy.spentOnDay(address(0), _day()), 1 ether);
    }

    function test_ExecutePayment_RevertWhenNotAgent() public {
        vm.expectRevert(TreasuryPolicy.NotAgent.selector);
        vm.prank(bob);
        policy.executePayment(address(0), alice, 1 ether);
    }

    function test_ExecutePayment_RevertOnPolicyViolation() public {
        vm.expectRevert(
            abi.encodeWithSelector(TreasuryPolicy.PolicyViolation.selector, NOT_WHITELISTED)
        );
        vm.prank(agent);
        policy.executePayment(address(0), bob, 1 ether);
    }

    // -------------------------------------------------------------------
    // executePayment — ERC-20 path (MockERC20 + SafeTransferLib)
    // -------------------------------------------------------------------

    function test_ExecutePayment_ERC20() public {
        uint256 balBefore = token.balanceOf(alice);

        vm.prank(agent);
        policy.executePayment(address(token), alice, 0.75 ether);

        assertEq(token.balanceOf(alice), balBefore + 0.75 ether);
        assertEq(policy.spentOnDay(address(token), _day()), 0.75 ether);
    }

    function test_ExecutePayment_ERC20_RevertOnPolicyViolation() public {
        vm.expectRevert(
            abi.encodeWithSelector(TreasuryPolicy.PolicyViolation.selector, EXCEEDS_MAX_PER_TX)
        );
        vm.prank(agent);
        policy.executePayment(address(token), alice, 2 ether);
    }

    // -------------------------------------------------------------------
    // executeBatch
    // -------------------------------------------------------------------

    function test_ExecuteBatch_Success() public {
        policy.setRecipient(bob, true);

        address[] memory to = new address[](3);
        uint256[] memory amounts = new uint256[](3);
        (to[0], to[1], to[2]) = (alice, bob, alice);
        (amounts[0], amounts[1], amounts[2]) = (1 ether, 1 ether, 1 ether);

        vm.prank(agent);
        policy.executeBatch(address(0), to, amounts);

        assertEq(policy.spentOnDay(address(0), _day()), 3 ether);
    }

    function test_ExecuteBatch_RevertMidViolation() public {
        // bob (index 1) is NOT whitelisted -> whole batch must revert atomically.
        address[] memory to = new address[](3);
        uint256[] memory amounts = new uint256[](3);
        (to[0], to[1], to[2]) = (alice, bob, alice);
        (amounts[0], amounts[1], amounts[2]) = (1 ether, 1 ether, 1 ether);

        uint256 aliceBalBefore = alice.balance;

        vm.expectRevert(
            abi.encodeWithSelector(TreasuryPolicy.BatchPolicyViolation.selector, 1, NOT_WHITELISTED)
        );
        vm.prank(agent);
        policy.executeBatch(address(0), to, amounts);

        // Nothing moved, nothing spent.
        assertEq(alice.balance, aliceBalBefore);
        assertEq(policy.spentOnDay(address(0), _day()), 0);
    }

    function test_ExecuteBatch_RevertCumulativeDailyLimit() public {
        // 6 x 1 ether: the 6th (index 5) tips cumulative spend over the 5 ether cap.
        address[] memory to = new address[](6);
        uint256[] memory amounts = new uint256[](6);
        for (uint256 i; i < 6; ++i) {
            to[i] = alice;
            amounts[i] = 1 ether;
        }

        vm.expectRevert(
            abi.encodeWithSelector(
                TreasuryPolicy.BatchPolicyViolation.selector, 5, EXCEEDS_DAILY_LIMIT
            )
        );
        vm.prank(agent);
        policy.executeBatch(address(0), to, amounts);

        assertEq(policy.spentOnDay(address(0), _day()), 0);
    }

    function test_ExecuteBatch_RevertLengthMismatch() public {
        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](1);
        to[0] = alice;
        to[1] = alice;
        amounts[0] = 1 ether;

        vm.expectRevert(TreasuryPolicy.LengthMismatch.selector);
        vm.prank(agent);
        policy.executeBatch(address(0), to, amounts);
    }

    function test_ExecuteBatch_RevertWhenNotAgent() public {
        address[] memory to = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        to[0] = alice;
        amounts[0] = 1 ether;

        vm.expectRevert(TreasuryPolicy.NotAgent.selector);
        policy.executeBatch(address(0), to, amounts);
    }

    // -------------------------------------------------------------------
    // Daily counter reset across UTC days
    // -------------------------------------------------------------------

    function test_DailyCounterResetsNextDay() public {
        vm.startPrank(agent);
        for (uint256 i; i < 5; ++i) {
            policy.executePayment(address(0), alice, 1 ether);
        }
        vm.stopPrank();

        uint256 dayOne = _day();
        assertEq(policy.spentOnDay(address(0), dayOne), DAILY_LIMIT);

        // A further payment today is blocked.
        (bool allowedToday,) = policy.checkPayment(address(0), alice, 1 ether);
        assertFalse(allowedToday);

        // Advance to the next UTC day: the daily counter resets.
        vm.warp(block.timestamp + 1 days);
        uint256 dayTwo = _day();
        assertEq(dayTwo, dayOne + 1);
        assertEq(policy.spentOnDay(address(0), dayTwo), 0);

        (bool allowedTomorrow, bytes32 code) = policy.checkPayment(address(0), alice, 1 ether);
        assertTrue(allowedTomorrow);
        assertEq(code, OK);

        vm.prank(agent);
        policy.executePayment(address(0), alice, 1 ether);
        assertEq(policy.spentOnDay(address(0), dayTwo), 1 ether);
        // Yesterday's tally is untouched.
        assertEq(policy.spentOnDay(address(0), dayOne), DAILY_LIMIT);
    }

    // -------------------------------------------------------------------
    // Owner administration + access control
    // -------------------------------------------------------------------

    function test_SetAgent_EmitsAndUpdates() public {
        address newAgent = makeAddr("newAgent");
        vm.expectEmit(true, true, false, false);
        emit AgentUpdated(agent, newAgent);
        policy.setAgent(newAgent);
        assertEq(policy.agent(), newAgent);
    }

    function test_SetAgent_RevertZeroAddress() public {
        vm.expectRevert(TreasuryPolicy.ZeroAddress.selector);
        policy.setAgent(address(0));
    }

    function test_SetAgent_OnlyOwner() public {
        vm.expectRevert(Ownable.Unauthorized.selector);
        vm.prank(bob);
        policy.setAgent(bob);
    }

    function test_SetRecipient_EmitsAndUpdates() public {
        vm.expectEmit(true, false, false, true);
        emit RecipientUpdated(bob, true);
        policy.setRecipient(bob, true);
        assertTrue(policy.recipientWhitelist(bob));
    }

    function test_SetRecipient_RevertZeroAddress() public {
        vm.expectRevert(TreasuryPolicy.ZeroAddress.selector);
        policy.setRecipient(address(0), true);
    }

    function test_SetRecipient_OnlyOwner() public {
        vm.expectRevert(Ownable.Unauthorized.selector);
        vm.prank(bob);
        policy.setRecipient(bob, true);
    }

    function test_SetLimits_EmitsAndUpdates() public {
        vm.expectEmit(true, false, false, true);
        emit LimitsUpdated(address(0), 2 ether, 10 ether);
        policy.setLimits(address(0), 2 ether, 10 ether);
        (uint256 maxPerTx, uint256 dailyLimit) = policy.limits(address(0));
        assertEq(maxPerTx, 2 ether);
        assertEq(dailyLimit, 10 ether);
    }

    function test_SetLimits_OnlyOwner() public {
        vm.expectRevert(Ownable.Unauthorized.selector);
        vm.prank(bob);
        policy.setLimits(address(0), 1, 1);
    }

    // -------------------------------------------------------------------
    // receive() + emergency withdrawal
    // -------------------------------------------------------------------

    function test_Receive_AcceptsNative() public {
        uint256 balBefore = address(policy).balance;
        (bool ok,) = address(policy).call{ value: 1 ether }("");
        assertTrue(ok);
        assertEq(address(policy).balance, balBefore + 1 ether);
    }

    function test_WithdrawAll_Native() public {
        uint256 treasuryBal = address(policy).balance;
        uint256 ownerBalBefore = address(this).balance;

        vm.expectEmit(true, true, false, true);
        emit Withdrawn(address(0), address(this), treasuryBal);
        policy.withdrawAll(address(0));

        assertEq(address(policy).balance, 0);
        assertEq(address(this).balance, ownerBalBefore + treasuryBal);
    }

    function test_WithdrawAll_ERC20() public {
        uint256 treasuryBal = token.balanceOf(address(policy));
        policy.withdrawAll(address(token));
        assertEq(token.balanceOf(address(policy)), 0);
        assertEq(token.balanceOf(address(this)), treasuryBal);
    }

    function test_WithdrawAll_OnlyOwner() public {
        vm.expectRevert(Ownable.Unauthorized.selector);
        vm.prank(bob);
        policy.withdrawAll(address(0));
    }

    // Allow this test contract to receive native withdrawals.
    receive() external payable { }
}
