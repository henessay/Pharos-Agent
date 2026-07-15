import { DODO_ROUTE_PROXY, FAROSWAP_CHAIN_ID, ROUTE_API_URL } from "./addresses.js";
import type {
  AddLiquidityParams,
  DexProvider,
  DexQuote,
  DexTxRequest,
  QuoteParams,
  RemoveLiquidityParams,
} from "./types.js";

export interface FaroswapProviderOptions {
  /** DODO route-service API key (the API returns 401 without one). */
  apiKey: string;
  /** Override the route API endpoint (default: {@link ROUTE_API_URL}). */
  apiUrl?: string;
  /** Per-request timeout in ms (default 10000). */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * FaroSwap (DODO fork) provider for Pharos Atlantic Testnet.
 *
 * Skeleton only — every method throws until implemented. Providers build
 * unsigned transactions; signing/sending stays with the caller behind the
 * guard engine.
 */
export class FaroswapProvider implements DexProvider {
  readonly name = "faroswap";
  readonly chainId = FAROSWAP_CHAIN_ID;

  /** Resolved options; consumed once the TODO methods below are implemented. */
  protected readonly opts: FaroswapProviderOptions;

  constructor(opts: FaroswapProviderOptions) {
    this.opts = { apiUrl: ROUTE_API_URL, timeoutMs: 10_000, ...opts };
  }

  async getQuote(_params: QuoteParams): Promise<DexQuote> {
    // TODO(faroswap): GET {apiUrl}?chainId=688689&fromTokenAddress=...&toTokenAddress=...
    //   &fromAmount=...&slippage=<pct>&userAddr=...&estimateGas=true&deadLine=<unix s>&apikey=...
    //   Native PHRS uses DEX_NATIVE_SENTINEL, not the zero address.
    //   Map response: data.resAmount (float, targetDecimals!) / data.minReturnAmount (base units)
    //   / data.routeInfo → DexQuote; keep the full payload in `raw` for buildSwapTx.
    //   Sample request/response: docs/faroswap-verification.md.
    throw new Error("FaroswapProvider.getQuote not implemented");
  }

  async buildSwapTx(_quote: DexQuote): Promise<DexTxRequest> {
    // TODO(faroswap): lift {to, data, value, gasLimit} straight from the quote's raw
    //   route API payload. `to` must equal DODO_ROUTE_PROXY — reject otherwise.
    //   approvalTarget = DODO_APPROVE for ERC-20 inputs, null for native PHRS.
    //   Quotes expire (deadLine + pool state): re-quote if stale.
    void DODO_ROUTE_PROXY;
    throw new Error("FaroswapProvider.buildSwapTx not implemented");
  }

  async buildAddLiquidityTx(_params: AddLiquidityParams): Promise<DexTxRequest> {
    // TODO(faroswap): V3-style mint/increaseLiquidity via POSITION_MANAGER
    //   (verified NonfungiblePositionManager). Needs fee tier + tick range in
    //   params.options; approvals for both tokens go to DODO_APPROVE — confirm
    //   whether the position manager pulls via DODOApprove or directly.
    throw new Error("FaroswapProvider.buildAddLiquidityTx not implemented");
  }

  async buildRemoveLiquidityTx(_params: RemoveLiquidityParams): Promise<DexTxRequest> {
    // TODO(faroswap): decreaseLiquidity + collect (multicall) on POSITION_MANAGER
    //   for a V3-style position tokenId.
    throw new Error("FaroswapProvider.buildRemoveLiquidityTx not implemented");
  }
}
