// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GuardLog
/// @notice Permissionless, append-only audit trail of tx-guard verdicts. Any
///         reporter (the firewall, a monitor, anyone) can log its verdict on a
///         transaction intent so the treasury has a tamper-evident history.
contract GuardLog {
    /// @notice Verdict classes.
    uint8 public constant VERDICT_ALLOW = 0;
    uint8 public constant VERDICT_WARN = 1;
    uint8 public constant VERDICT_BLOCK = 2;

    /// @notice Number of verdicts logged by each reporter.
    mapping(address reporter => uint256 count) private _verdictCount;

    event VerdictLogged(
        address indexed reporter,
        bytes32 indexed intentHash,
        uint8 verdict,
        string reason,
        uint256 timestamp
    );

    /// @notice The verdict value was outside the allowed range (0..2).
    error InvalidVerdict(uint8 verdict);

    /// @notice Log a verdict on a transaction intent.
    /// @param intentHash Hash identifying the evaluated transaction intent.
    /// @param verdict 0 = allow, 1 = warn, 2 = block.
    /// @param reason Human-readable explanation of the verdict.
    function logVerdict(bytes32 intentHash, uint8 verdict, string calldata reason) external {
        if (verdict > VERDICT_BLOCK) revert InvalidVerdict(verdict);

        unchecked {
            ++_verdictCount[msg.sender];
        }

        emit VerdictLogged(msg.sender, intentHash, verdict, reason, block.timestamp);
    }

    /// @notice Number of verdicts a given reporter has logged.
    /// @param reporter The reporter address to query.
    /// @return The reporter's verdict count.
    function verdictCount(address reporter) external view returns (uint256) {
        return _verdictCount[reporter];
    }
}
