// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Policy} from "../src/Policy.sol";
import {GuardLog} from "../src/GuardLog.sol";

/// @notice Deploys Policy + GuardLog to the Pharos testnet.
/// @dev Run with:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $PHAROS_RPC_URL --private-key $PRIVATE_KEY --broadcast
contract Deploy is Script {
    function run() external {
        // Per-tx limit defaults to 1 PHRS; override via PER_TX_LIMIT_WEI env var.
        uint256 perTxLimit = vm.envOr("PER_TX_LIMIT_WEI", uint256(1 ether));

        vm.startBroadcast();

        Policy policy = new Policy(msg.sender, perTxLimit);
        GuardLog guardLog = new GuardLog();

        vm.stopBroadcast();

        console.log("=== Pharos Guard deploy ===");
        console.log("Deployer       :", msg.sender);
        console.log("Policy address :", address(policy));
        console.log("GuardLog address:", address(guardLog));
        console.log("Per-tx limit   :", perTxLimit);
    }
}
