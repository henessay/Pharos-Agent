// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { TreasuryPolicy } from "../src/TreasuryPolicy.sol";
import { GuardLog } from "../src/GuardLog.sol";

/// @notice Deploys TreasuryPolicy + GuardLog to the Pharos testnet, wires the
///         agent from $AGENT_ADDRESS, seeds native limits, and writes the
///         resulting addresses + deploy block to deployments/pharos-testnet.json.
/// @dev Run with:
///   AGENT_ADDRESS=0x... forge script script/Deploy.s.sol:Deploy \
///     --rpc-url "$PHAROS_RPC_URL" --private-key "$PRIVATE_KEY" --broadcast
contract Deploy is Script {
    function run() external {
        address agent = vm.envAddress("AGENT_ADDRESS");
        uint256 maxPerTx = vm.envOr("NATIVE_MAX_PER_TX_WEI", uint256(1 ether));
        uint256 dailyLimit = vm.envOr("NATIVE_DAILY_LIMIT_WEI", uint256(5 ether));

        vm.startBroadcast();

        TreasuryPolicy treasury = new TreasuryPolicy();
        GuardLog guardLog = new GuardLog();

        // address(0) == native token limits.
        treasury.setLimits(address(0), maxPerTx, dailyLimit);
        treasury.setAgent(agent);

        vm.stopBroadcast();

        console.log("=== Pharos Guard deploy ===");
        console.log("Deployer/owner   :", msg.sender);
        console.log("Agent            :", agent);
        console.log("TreasuryPolicy   :", address(treasury));
        console.log("GuardLog         :", address(guardLog));
        console.log("Native maxPerTx  :", maxPerTx);
        console.log("Native dailyLimit:", dailyLimit);

        _writeDeployment(address(treasury), address(guardLog), agent, maxPerTx, dailyLimit);
    }

    /// @dev Writes a deployments/pharos-testnet.json record. Requires
    ///      `fs_permissions` write access (configured in foundry.toml).
    function _writeDeployment(
        address treasury,
        address guardLog,
        address agent,
        uint256 maxPerTx,
        uint256 dailyLimit
    ) internal {
        string memory explorer = "https://testnet.pharosscan.xyz";
        string memory obj = "deployment";

        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "deployBlock", block.number);
        vm.serializeAddress(obj, "deployer", msg.sender);
        vm.serializeAddress(obj, "agent", agent);
        vm.serializeAddress(obj, "treasuryPolicy", treasury);
        vm.serializeAddress(obj, "guardLog", guardLog);
        vm.serializeString(obj, "explorer", explorer);
        vm.serializeUint(obj, "nativeMaxPerTxWei", maxPerTx);
        string memory json = vm.serializeUint(obj, "nativeDailyLimitWei", dailyLimit);

        vm.writeJson(json, "./deployments/pharos-testnet.json");
        console.log("Wrote deployments/pharos-testnet.json");
    }
}
