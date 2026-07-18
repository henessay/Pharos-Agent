// ABIs + decoding
export {
  bytes32ToString,
  decodeCalldata,
  erc20Abi,
  guardLogAbi,
  NATIVE_TOKEN,
  treasuryPolicyAbi,
  UNLIMITED_APPROVE_THRESHOLD,
} from "./abi.js";
export { PHAROS_TESTNET_CHAIN_ID, pharosTestnet } from "./chain.js";
// Deployments
export {
  type Deployments,
  explorerAddressUrl,
  loadDeployments,
  requireDeployments,
} from "./deployments.js";
// DEX providers (FaroSwap)
export * from "./dex/index.js";
// Risk engine
export { aggregateVerdict, type GuardOptions, guardTransaction, hashIntent } from "./engine.js";
// Errors
export {
  ContractsNotDeployedError,
  MarketDataUnavailableError,
  QuoteUnavailableError,
  type StructuredError,
  toStructuredError,
} from "./errors.js";
// Explorer client
export {
  createBlockscoutClient,
  createExplorerClient,
  type ExplorerClient,
  type SourceCodeResult,
  type TxListResult,
} from "./explorer.js";
export {
  checkTransaction,
  type GuardPolicy,
  type GuardReason,
  type GuardVerdict,
  type ProposedTransaction,
} from "./guard.js";
// Agent self-documentation (AGENT_GUIDE.md parser)
export {
  type AgentGuide,
  type AgentGuideCapability,
  parseAgentGuide,
  readAgentGuide,
} from "./guide.js";
// Market data (advisor role)
export * from "./market/index.js";
// On-chain queries
export {
  guardLogHistory,
  type PolicyStatus,
  policyStatus,
  type VerdictEntry,
} from "./queries.js";
// DEX guard rules
export {
  type DexGuardContext,
  ruleExactApprove,
  ruleLpRecognition,
  rulePriceImpact,
  ruleRouterAllowlist,
  ruleSlippageBound,
} from "./rules/index.js";
// Runtime client builders
export {
  accountFromEnv,
  getPublicClient,
  getWalletClient,
  resolveRpcUrl,
} from "./runtime.js";
export {
  type DecodedCall,
  type DecodedKind,
  type GuardIntent,
  type GuardReport,
  type Risk,
  type RiskStatus,
  type RuleId,
  type Severity,
  type SimulationResult,
  type Verdict,
  verdictToCode,
} from "./types.js";
// Wallet check-up (read-only advisor)
export * from "./wallet/index.js";
// Yield comparison — RWA vs DeFi (read-only advisor)
export * from "./yields/index.js";
