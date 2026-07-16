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

/** Error thrown when the DEX route API cannot produce a usable quote. */
export class QuoteUnavailableError extends Error {
  /** Stable, machine-readable code surfaced to MCP / agent consumers. */
  readonly code = "quote_unavailable";
  /** What failed on the last attempt (timeout, HTTP status, API error…). */
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "QuoteUnavailableError";
    this.cause = cause;
  }
}

/** Error thrown when no market-data provider can produce usable data. */
export class MarketDataUnavailableError extends Error {
  /** Stable, machine-readable code surfaced to MCP / agent consumers. */
  readonly code = "market_data_unavailable";
  /** What failed on the last attempt (timeout, HTTP status, API error…). */
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "MarketDataUnavailableError";
    this.cause = cause;
  }
}

/** Structured error payload returned by MCP tools / wrappers instead of throwing. */
export interface StructuredError {
  error: string;
  message: string;
}

/** Convert any error into a {@link StructuredError}; known error codes are preserved. */
export function toStructuredError(err: unknown): StructuredError {
  if (
    err instanceof ContractsNotDeployedError ||
    err instanceof QuoteUnavailableError ||
    err instanceof MarketDataUnavailableError
  ) {
    return { error: err.code, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { error: "internal_error", message };
}
