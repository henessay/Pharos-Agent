/** Error thrown when an operation needs on-chain addresses that are not yet known. */
export class ContractsNotDeployedError extends Error {
  /** Stable, machine-readable code surfaced to MCP / agent consumers. */
  readonly code = "contracts_not_deployed";

  constructor(message?: string) {
    super(
      message ??
        "Pharos Guard contracts are not deployed yet (deploy pending). Sync " +
          "packages/contracts/deployments/pharos-testnet.json or set POLICY_ADDRESS / " +
          "GUARDLOG_ADDRESS to enable on-chain calls.",
    );
    this.name = "ContractsNotDeployedError";
  }
}

/** Structured error payload returned by MCP tools / wrappers instead of throwing. */
export interface StructuredError {
  error: string;
  message: string;
}

/** Convert any error into a {@link StructuredError}; `contracts_not_deployed` is preserved. */
export function toStructuredError(err: unknown): StructuredError {
  if (err instanceof ContractsNotDeployedError) {
    return { error: err.code, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { error: "internal_error", message };
}
