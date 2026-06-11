// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "solady/auth/Ownable.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";

/// @title TreasuryPolicy
/// @notice On-chain treasury for an AI treasurer agent. The contract custodies
///         native PHRS and ERC-20 tokens and only releases them through
///         `executePayment` / `executeBatch`, which enforce a recipient
///         allowlist plus per-transaction and per-UTC-day spending limits.
/// @dev    Days are fixed UTC windows (`block.timestamp / 1 days`), not a
///         rolling window — simpler and more predictable for the demo.
contract TreasuryPolicy is Ownable {
    using SafeTransferLib for address;

    /// @notice Spending limits for a token. `address(0)` denotes the native token.
    struct Limits {
        uint256 maxPerTx;
        uint256 dailyLimit;
    }

    // --- reason codes (returned by checkPayment / carried by PolicyViolation) ---
    bytes32 internal constant OK = bytes32("OK");
    bytes32 internal constant NOT_WHITELISTED = bytes32("NOT_WHITELISTED");
    bytes32 internal constant EXCEEDS_MAX_PER_TX = bytes32("EXCEEDS_MAX_PER_TX");
    bytes32 internal constant EXCEEDS_DAILY_LIMIT = bytes32("EXCEEDS_DAILY_LIMIT");
    bytes32 internal constant NO_LIMITS_SET = bytes32("NO_LIMITS_SET");

    /// @notice The only address permitted to execute payments.
    address public agent;

    /// @notice Recipients the agent is allowed to pay.
    mapping(address recipient => bool allowed) public recipientWhitelist;

    /// @notice Per-token spending limits. `address(0)` = native token.
    mapping(address token => Limits limits) public limits;

    /// @notice Amount already spent per token per UTC day (`block.timestamp / 1 days`).
    mapping(address token => mapping(uint256 day => uint256 spent)) public spentOnDay;

    event AgentUpdated(address indexed previousAgent, address indexed newAgent);
    event RecipientUpdated(address indexed recipient, bool allowed);
    event LimitsUpdated(address indexed token, uint256 maxPerTx, uint256 dailyLimit);
    event PaymentExecuted(
        address indexed token, address indexed to, uint256 amount, uint256 indexed day
    );
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    /// @notice The caller is not the configured agent.
    error NotAgent();
    /// @notice A single payment violated the policy.
    error PolicyViolation(bytes32 reasonCode);
    /// @notice A payment inside a batch violated the policy; carries its index.
    error BatchPolicyViolation(uint256 index, bytes32 reasonCode);
    /// @notice `to` and `amounts` arrays have different lengths.
    error LengthMismatch();
    /// @notice A required address argument was the zero address.
    error ZeroAddress();

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor() {
        _initializeOwner(msg.sender);
    }

    /// @notice Accept native token deposits into the treasury.
    receive() external payable { }

    // ---------------------------------------------------------------------
    // Owner administration
    // ---------------------------------------------------------------------

    /// @notice Set the agent address allowed to execute payments.
    /// @param newAgent The new agent address (non-zero).
    function setAgent(address newAgent) external onlyOwner {
        if (newAgent == address(0)) revert ZeroAddress();
        emit AgentUpdated(agent, newAgent);
        agent = newAgent;
    }

    /// @notice Add or remove a recipient from the allowlist.
    /// @param recipient The recipient address (non-zero).
    /// @param allowed Whether the recipient may receive payments.
    function setRecipient(address recipient, bool allowed) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        recipientWhitelist[recipient] = allowed;
        emit RecipientUpdated(recipient, allowed);
    }

    /// @notice Set spending limits for a token (`address(0)` for native).
    /// @param token The token address (`address(0)` = native).
    /// @param maxPerTx Maximum amount per single payment.
    /// @param dailyLimit Maximum cumulative amount per UTC day.
    function setLimits(address token, uint256 maxPerTx, uint256 dailyLimit) external onlyOwner {
        limits[token] = Limits({ maxPerTx: maxPerTx, dailyLimit: dailyLimit });
        emit LimitsUpdated(token, maxPerTx, dailyLimit);
    }

    // ---------------------------------------------------------------------
    // Policy evaluation
    // ---------------------------------------------------------------------

    /// @notice Evaluate a prospective payment against the policy without mutating state.
    /// @param token The token address (`address(0)` = native).
    /// @param to The recipient address.
    /// @param amount The amount to send.
    /// @return allowed True when the payment satisfies the policy.
    /// @return reasonCode `"OK"` when allowed, otherwise the failing rule.
    function checkPayment(address token, address to, uint256 amount)
        public
        view
        returns (bool allowed, bytes32 reasonCode)
    {
        if (!recipientWhitelist[to]) return (false, NOT_WHITELISTED);

        Limits memory lim = limits[token];
        if (lim.maxPerTx == 0 && lim.dailyLimit == 0) return (false, NO_LIMITS_SET);

        if (amount > lim.maxPerTx) return (false, EXCEEDS_MAX_PER_TX);

        uint256 day = block.timestamp / 1 days;
        if (spentOnDay[token][day] + amount > lim.dailyLimit) {
            return (false, EXCEEDS_DAILY_LIMIT);
        }

        return (true, OK);
    }

    // ---------------------------------------------------------------------
    // Execution (agent only)
    // ---------------------------------------------------------------------

    /// @notice Execute a single policy-compliant payment from the treasury.
    /// @dev Reverts with {PolicyViolation} carrying the failing reason code.
    /// @param token The token address (`address(0)` = native).
    /// @param to The recipient address.
    /// @param amount The amount to send.
    function executePayment(address token, address to, uint256 amount) external onlyAgent {
        (bool allowed, bytes32 reasonCode) = checkPayment(token, to, amount);
        if (!allowed) revert PolicyViolation(reasonCode);

        uint256 day = block.timestamp / 1 days;
        spentOnDay[token][day] += amount;
        _transfer(token, to, amount);

        emit PaymentExecuted(token, to, amount, day);
    }

    /// @notice Execute a batch of payments atomically; any violation reverts all.
    /// @dev Spending accumulates across the batch, so the daily limit is enforced
    ///      cumulatively. On violation reverts with {BatchPolicyViolation} carrying
    ///      the offending index and reason code.
    /// @param token The token address (`address(0)` = native).
    /// @param to The recipient addresses.
    /// @param amounts The amounts to send, aligned with `to`.
    function executeBatch(address token, address[] calldata to, uint256[] calldata amounts)
        external
        onlyAgent
    {
        if (to.length != amounts.length) revert LengthMismatch();

        uint256 day = block.timestamp / 1 days;
        for (uint256 i; i < to.length; ++i) {
            (bool allowed, bytes32 reasonCode) = checkPayment(token, to[i], amounts[i]);
            if (!allowed) revert BatchPolicyViolation(i, reasonCode);

            spentOnDay[token][day] += amounts[i];
            _transfer(token, to[i], amounts[i]);

            emit PaymentExecuted(token, to[i], amounts[i], day);
        }
    }

    // ---------------------------------------------------------------------
    // Emergency withdrawal
    // ---------------------------------------------------------------------

    /// @notice Withdraw the full treasury balance of a token to the owner.
    /// @param token The token address (`address(0)` = native).
    function withdrawAll(address token) external onlyOwner {
        uint256 bal;
        if (token == address(0)) {
            bal = address(this).balance;
            SafeTransferLib.safeTransferETH(msg.sender, bal);
        } else {
            bal = SafeTransferLib.balanceOf(token, address(this));
            SafeTransferLib.safeTransfer(token, msg.sender, bal);
        }
        emit Withdrawn(token, msg.sender, bal);
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    /// @dev Native uses `call{value}` (via SafeTransferLib), ERC-20 uses safeTransfer.
    function _transfer(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            SafeTransferLib.safeTransferETH(to, amount);
        } else {
            SafeTransferLib.safeTransfer(token, to, amount);
        }
    }
}
