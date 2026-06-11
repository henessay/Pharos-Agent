// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title GuardLog
/// @notice Append-only, on-chain audit trail of tx-guard verdicts. The firewall
///         records every decision (allow/deny) it makes about an agent
///         transaction so the treasury has a tamper-evident history.
contract GuardLog {
    struct Entry {
        bytes32 txDigest; // hash identifying the evaluated transaction
        address agent; // signer/agent the verdict applies to
        bool allowed; // final verdict
        uint64 timestamp; // block timestamp of the record
        string reason; // machine-readable reason string
    }

    /// @notice All recorded verdicts in chronological order.
    Entry[] private _entries;

    event Recorded(
        uint256 indexed index,
        bytes32 indexed txDigest,
        address indexed agent,
        bool allowed,
        string reason
    );

    /// @notice Record a guard verdict.
    /// @param txDigest Hash identifying the evaluated transaction.
    /// @param agent The agent/signer the verdict applies to.
    /// @param allowed The verdict.
    /// @param reason Machine-readable reason string.
    /// @return index The index of the newly stored entry.
    function record(bytes32 txDigest, address agent, bool allowed, string calldata reason)
        external
        returns (uint256 index)
    {
        index = _entries.length;
        _entries.push(
            Entry({
                txDigest: txDigest,
                agent: agent,
                allowed: allowed,
                timestamp: uint64(block.timestamp),
                reason: reason
            })
        );
        emit Recorded(index, txDigest, agent, allowed, reason);
    }

    /// @notice Total number of recorded entries.
    function count() external view returns (uint256) {
        return _entries.length;
    }

    /// @notice Fetch a stored entry by index.
    function entryAt(uint256 index) external view returns (Entry memory) {
        return _entries[index];
    }
}
