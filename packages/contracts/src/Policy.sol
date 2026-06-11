// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Policy
/// @notice On-chain treasury policy for AI-agent transactions. Defines which
///         recipients an agent may pay and the maximum value per transaction.
///         The off-chain tx-guard firewall reads `check` before signing, and a
///         policy-enforcing executor can call it on-chain as a second gate.
contract Policy {
    /// @notice Account allowed to administer the policy.
    address public owner;

    /// @notice Maximum native value (in wei) permitted for a single transaction.
    uint256 public perTxLimit;

    /// @notice Whether the policy is active. When false, `check` denies everything.
    bool public enabled;

    /// @notice Recipients the agent is permitted to send funds to.
    mapping(address recipient => bool allowed) public allowedRecipient;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PerTxLimitUpdated(uint256 previousLimit, uint256 newLimit);
    event RecipientUpdated(address indexed recipient, bool allowed);
    event EnabledUpdated(bool enabled);

    error NotOwner();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param initialOwner Account that administers the policy.
    /// @param initialPerTxLimit Maximum native value (wei) allowed per transaction.
    constructor(address initialOwner, uint256 initialPerTxLimit) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        perTxLimit = initialPerTxLimit;
        enabled = true;
        emit OwnershipTransferred(address(0), initialOwner);
        emit PerTxLimitUpdated(0, initialPerTxLimit);
        emit EnabledUpdated(true);
    }

    /// @notice Evaluate a proposed transaction against the policy.
    /// @param to Recipient address.
    /// @param amount Native value (wei) to be sent.
    /// @return allowed True when the transaction satisfies the policy.
    /// @return reason Machine-readable reason string (empty when allowed).
    function check(address to, uint256 amount)
        external
        view
        returns (bool allowed, string memory reason)
    {
        if (!enabled) return (false, "policy:disabled");
        if (to == address(0)) return (false, "policy:zero-recipient");
        if (!allowedRecipient[to]) return (false, "policy:recipient-not-allowed");
        if (amount > perTxLimit) return (false, "policy:over-per-tx-limit");
        return (true, "");
    }

    /// @notice Add or remove a recipient from the allowlist.
    function setRecipient(address recipient, bool allowed) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        allowedRecipient[recipient] = allowed;
        emit RecipientUpdated(recipient, allowed);
    }

    /// @notice Update the maximum native value permitted per transaction.
    function setPerTxLimit(uint256 newLimit) external onlyOwner {
        emit PerTxLimitUpdated(perTxLimit, newLimit);
        perTxLimit = newLimit;
    }

    /// @notice Enable or disable the whole policy.
    function setEnabled(bool newEnabled) external onlyOwner {
        enabled = newEnabled;
        emit EnabledUpdated(newEnabled);
    }

    /// @notice Transfer policy administration to a new owner.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
