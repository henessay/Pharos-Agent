import { createInterface } from "node:readline/promises";
import { toStructuredError } from "@pharos-guard/guard-skill";
import OpenAI from "openai";
import { aboutAgent } from "./about.js";
import { bold, colorVerdict, cyan, gray, green, red, yellow } from "./colors.js";
import { decideAction, fixHint } from "./decide.js";
import {
  addLiquidity,
  checkSwap,
  getQuote,
  parseAddLiquidityIntent,
  parseRemoveLiquidityIntent,
  parseSwapIntent,
  removeLiquidity,
  swapTokens,
} from "./dex.js";
import { marketOverview, suggestAllocation, tokenInfo } from "./market.js";
import { isProposeError, parseIntent } from "./propose.js";
import {
  type AgentContext,
  createContext,
  executePayment,
  getPolicyStatus,
  guardCheck,
} from "./tools.js";
import { runWalletCheckup } from "./wallet.js";

export const SYSTEM_PROMPT = `You are a Pharos treasury agent and Guarded DeFi Advisor. You move PHRS out of a TreasuryPolicy contract on the Pharos testnet on the user's behalf, trade on FaroSwap (swap between PHRS, WPHRS, USDC and USDT via get_quote / swap_tokens; manage full-range LP positions via add_liquidity / remove_liquidity), provide market analytics (market_overview / token_info / suggest_allocation), and audit wallets (wallet_checkup).

Wallet check-up: for "check my wallet", "is my wallet safe", "audit this address", "проверь кошелёк" and similar → call wallet_checkup with the 0x address. If the user gave no address, ASK for it first — never invent one. The check-up is read-only: present Portfolio, Approvals (with risk levels), Scam check, Gas Spent, the Health Score with its formula, and the Revoke Plan. NEVER offer to execute revokes: each plan entry is a ready approve(spender, 0) transaction the user sends themselves (in advisor deployments point them to https://github.com/henessay/Pharos-Agent).

Routing: a PAYMENT sends tokens TO someone else (needs a recipient address) — use propose_payment / guard_check / execute_payment. A SWAP exchanges one token for another with no recipient (the output lands in the agent's own wallet) — use get_quote / swap_tokens directly; the firewall runs inside those tools, so do NOT call guard_check or propose_payment for swaps or liquidity.

Advisor rules (market analytics):
A. NEVER give direct buy/sell recommendations — no "buy X", "sell Y", "you should invest in Z". Present market DATA and frame candidates strictly as "options that match your profile". The final decision is always the user's.
B. suggest_allocation REQUIRES a risk level. If the user already stated one ("high risk", "low risk", …), use it directly — do not re-ask. Only when the user has NOT stated a risk level, ASK them to choose — low (capital preservation), medium (balanced), or high (aggressive) — before calling the tool. Never assume or invent a risk profile.
C. End EVERY market-analytics answer with exactly: "This is market data, not financial advice. Always do your own research."
D. If you are deployed without wallet access (marketplace/advisor deployment), you cannot execute swaps: return the guarded quote (verdict, min return, price impact) and redirect execution to the open-source package at https://github.com/henessay/Pharos-Agent. With wallet access (this CLI), the normal confirmed swap flow applies.
E. When the user asks what you are or can do ("what can you do", "help", "how do I use you", "who are you", "кто ты"), or how to execute a quoted swap themselves: call about_agent and answer FROM its structure — identity in one line, the capability categories with one or two example requests each, the not-doing boundaries, and the links. Keep it short; do not invent capabilities that are not in the guide.

Hard rules (a firewall enforces these in code too):
1. NEVER call execute_payment without first calling guard_check on the same request. (Payments only — DeFi tools embed their own guard check.)
2. If the guard verdict is "allow": execute the payment, then show the block-explorer link.
3. If the verdict is "warn": show the risks and ask the user to confirm with y/n BEFORE executing.
4. If the verdict is "block": do NOT execute. Explain the blocking reason and how to fix it.
5. Use policy_status whenever the user asks about limits, daily spend, or balance.
6. Every DeFi action (swap, add/remove liquidity) runs the full tx-guard firewall INSIDE the tool — including its approvals. You never execute around the firewall, and there is no way to skip it.
7. Swaps ALWAYS need the user's explicit confirmation, even on an "allow" verdict. For any swap request, FIRST call swap_tokens WITHOUT confirmed — it never sends and returns the firewall GuardReport (get_quote alone is NOT enough: it has no verdict). Present the report (VERDICT, expected output, minimum return, price impact, route), ask y/n, and only after an explicit "y" call swap_tokens again with confirmed=true. The same applies to any DeFi tool returning decision.action "confirm". Never set confirmed=true on the first call, and never treat silence as consent.
8. On an executed action, always show the transaction hash link; on "block", relay the reason and the fix hint.
Be concise. Always state the verdict explicitly.`;

export const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "propose_payment",
      description:
        "Parse a natural-language PAYMENT or approval request — sending tokens TO someone (needs a recipient 0x address) — into a structured intent (preview only, no on-chain effect). NOT for token swaps: those have no recipient — use swap_tokens.",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "The user's request verbatim." } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "guard_check",
      description:
        "Run the tx-guard firewall over a PAYMENT or approval request and return the verdict (allow/warn/block) with risks. Call this before execute_payment. Swaps and liquidity do NOT need it — their tools run the firewall internally (a swap phrase passed here is checked as a swap, without executing).",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "The user's request verbatim." } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_payment",
      description:
        "Execute a PHRS payment through the treasury. Runs a guard check first and refuses unless the verdict is allow.",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "The user's request verbatim." } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "policy_status",
      description: "Return treasury limits, today's spend, remaining daily allowance, and balance.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_quote",
      description:
        "Get a FaroSwap quote for swapping PHRS/WPHRS/USDC/USDT (expected output, minimum return, price impact, route). Read-only, nothing is signed or sent.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The swap request verbatim, e.g. 'swap 0.5 PHRS to USDC'.",
          },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "swap_tokens",
      description:
        "Exchange one token for another (PHRS/WPHRS/USDC/USDT) on FaroSwap — no recipient needed, the output goes to the agent's own wallet. Use for any 'swap/exchange/convert X to Y' request. The full tx-guard firewall (base + DEX rules) runs INSIDE this tool over the swap and its approvals — do not call guard_check first. The FIRST call never sends: it returns the GuardReport + quote for the user to confirm. Only after the user explicitly says yes, call again with confirmed=true to execute (block verdicts never execute).",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The swap request verbatim, e.g. 'swap 0.5 PHRS to USDC slippage 1%'.",
          },
          confirmed: {
            type: "boolean",
            description:
              "Set true ONLY after the user explicitly answered 'y' to the GuardReport shown for this exact swap. Never on the first call.",
          },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_liquidity",
      description:
        "Add full-range liquidity to a FaroSwap V3 pool (WPHRS/USDC/USDT pairs). Guarded like a swap: exact-amount approvals and the mint are all firewall-checked before sending.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The request verbatim, e.g. 'add liquidity 1 USDC and 1 USDT fee 100'.",
          },
          confirmed: {
            type: "boolean",
            description:
              "Set true ONLY after the user explicitly answered 'y' to a warn verdict for this exact request.",
          },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_liquidity",
      description:
        "Withdraw (part of) a FaroSwap V3 LP position back to the agent. Guarded: the decrease+collect calldata is firewall-checked (recipient must be the agent) before sending.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The request verbatim, e.g. 'remove 50% of position 123'.",
          },
          confirmed: {
            type: "boolean",
            description:
              "Set true ONLY after the user explicitly answered 'y' to a warn verdict for this exact request.",
          },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "wallet_checkup",
      description:
        "Read-only Wallet Check-up for a 0x address: portfolio (balances + USD where priced), ERC-20 approvals with risk classification (unlimited / EOA spender / unknown spender), scam check (where supported), gas spent over 7/30 days, a transparent 0-100 health score, and a firewall-vetted revoke plan (approve(spender, 0) intents the USER executes — this tool never sends anything). Use for 'check my wallet', 'is my wallet safe', 'audit 0x…'. If no address was given, ask the user for it instead of calling this.",
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description:
              "The wallet address to audit, e.g. '0x38a7…a945'. Full 42-char 0x address.",
          },
        },
        required: ["address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "about_agent",
      description:
        "The agent's self-description from the canonical user guide: identity, capability categories with example requests, explicit not-doing boundaries, step-by-step instructions for executing a quoted swap self-custodially, the coin-selection methodology, and links (GitHub, contracts on the explorer). Call for 'what can you do', 'help', 'who are you', 'how do I use you', or 'how do I execute the swap myself'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "market_overview",
      description:
        "Market overview with an explicit sort. sort='market_cap' (default) → the BIGGEST coins — use for 'top coins', 'market overview'. sort='gainers_7d' / 'losers_7d' → MOVERS: best/worst 7-day performers among the top-100 by cap, stablecoins excluded — use for 'top movers', 'what pumped/dumped this week', 'best/worst performers'. NEVER answer a movers question with the market_cap sort: a cap-ranked list is not movers. Read-only — end the answer with the standard disclaimer.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "How many coins to return (default 10)." },
          sort: {
            type: "string",
            enum: ["market_cap", "gainers_7d", "losers_7d"],
            description:
              "market_cap for size questions; gainers_7d/losers_7d for movers/performance questions.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "token_info",
      description:
        "Detailed market data for one coin: USD price, 24h/7d/30d changes, market cap, rank. Read-only — end the answer with the standard disclaimer.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Ticker symbol, e.g. 'BTC'." },
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_allocation",
      description:
        "Risk-profiled allocation IDEAS: 3-4 coins WITH market data (price, 7d/30d change, market cap) matching a risk level (low → stablecoins + BTC/ETH; medium → top-20; high → smaller caps / newer ecosystems). risk_level is REQUIRED — if the user has not stated their risk profile, ASK them (low/medium/high) BEFORE calling this. Present results as options matching the profile, never as buy instructions, and end with the standard disclaimer.",
      parameters: {
        type: "object",
        properties: {
          amount_usd: { type: "number", description: "Amount in USD the user mentioned." },
          risk_level: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "The user's OWN stated risk profile. Never guess it — ask the user first.",
          },
        },
        required: ["amount_usd", "risk_level"],
      },
    },
  },
];

const json = (v: unknown) =>
  JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));

/** Dispatch a tool call; returns the JSON result for the model and a log line. */
export async function dispatch(
  name: string,
  args: {
    text?: string;
    confirmed?: boolean;
    limit?: number;
    sort?: string;
    symbol?: string;
    amount_usd?: number;
    risk_level?: string;
    address?: string;
  },
  ctx: AgentContext,
): Promise<{ result: string; log: string }> {
  const execTag = (res: { executed: boolean; decision: { action: string; verdict: string } }) =>
    res.executed
      ? green("executed")
      : res.decision.action === "confirm"
        ? yellow(`awaiting confirmation (${res.decision.verdict})`)
        : red(`refused (${res.decision.verdict})`);
  try {
    switch (name) {
      case "propose_payment": {
        const intent = parseIntent(args.text ?? "");
        return { result: json(intent), log: `${gray("→")} propose_payment` };
      }
      case "guard_check": {
        const intent = parseIntent(args.text ?? "");
        if (isProposeError(intent)) {
          // Defensive routing: when the model sends a swap phrase here, run
          // the REAL firewall over the swap (without executing) instead of
          // failing with a payment-shaped "missing recipient" error.
          const swap = parseSwapIntent(args.text ?? "");
          if (!("error" in swap)) {
            const res = await checkSwap(swap, ctx);
            return {
              result: json({ ...res, note: "checked as a swap; execute via swap_tokens" }),
              log: `${gray("→")} guard_check(swap)… verdict: ${colorVerdict(res.report.verdict)}`,
            };
          }
          return { result: json(intent), log: `${gray("→")} guard_check… ${red("parse error")}` };
        }
        const report = await guardCheck(intent, ctx);
        const decision = decideAction(report);
        return {
          result: json({ report, decision, fix: fixHint(report) }),
          log: `${gray("→")} guard_check… verdict: ${colorVerdict(report.verdict)}`,
        };
      }
      case "execute_payment": {
        const intent = parseIntent(args.text ?? "");
        if (isProposeError(intent))
          return {
            result: json(intent),
            log: `${gray("→")} execute_payment… ${red("parse error")}`,
          };
        const res = await executePayment(intent, ctx);
        const tag = res.executed ? green("executed") : red(`refused (${res.decision.verdict})`);
        return { result: json(res), log: `${gray("→")} execute_payment… ${tag}` };
      }
      case "policy_status": {
        const status = await getPolicyStatus(ctx);
        return { result: json(status), log: `${gray("→")} policy_status` };
      }
      case "get_quote": {
        const intent = parseSwapIntent(args.text ?? "");
        if ("error" in intent)
          return { result: json(intent), log: `${gray("→")} get_quote… ${red("parse error")}` };
        const res = await getQuote(intent, ctx);
        return { result: json(res), log: `${gray("→")} get_quote… ${res.quote.pair}` };
      }
      case "swap_tokens": {
        const intent = parseSwapIntent(args.text ?? "");
        if ("error" in intent)
          return { result: json(intent), log: `${gray("→")} swap_tokens… ${red("parse error")}` };
        const res = await swapTokens(intent, ctx, args.confirmed === true);
        return { result: json(res), log: `${gray("→")} swap_tokens… ${execTag(res)}` };
      }
      case "add_liquidity": {
        const intent = parseAddLiquidityIntent(args.text ?? "");
        if ("error" in intent)
          return { result: json(intent), log: `${gray("→")} add_liquidity… ${red("parse error")}` };
        const res = await addLiquidity(intent, ctx, args.confirmed === true);
        return { result: json(res), log: `${gray("→")} add_liquidity… ${execTag(res)}` };
      }
      case "remove_liquidity": {
        const intent = parseRemoveLiquidityIntent(args.text ?? "");
        if ("error" in intent)
          return {
            result: json(intent),
            log: `${gray("→")} remove_liquidity… ${red("parse error")}`,
          };
        const res = await removeLiquidity(intent, ctx, args.confirmed === true);
        return { result: json(res), log: `${gray("→")} remove_liquidity… ${execTag(res)}` };
      }
      case "wallet_checkup": {
        const res = await runWalletCheckup(args.address, ctx);
        if ("error" in res) {
          return { result: json(res), log: `${gray("→")} wallet_checkup… ${yellow(res.error)}` };
        }
        const tag = `score ${res.health.score}/100 (${res.health.grade}), ${res.revokePlan.length} revoke item(s)`;
        return { result: json(res), log: `${gray("→")} wallet_checkup… ${tag}` };
      }
      case "about_agent": {
        const guide = aboutAgent();
        return {
          result: json(guide),
          log: `${gray("→")} about_agent… ${Object.keys(guide.capabilities).length} capability categories`,
        };
      }
      case "market_overview": {
        const res = await marketOverview(ctx, args.limit ?? 10, args.sort ?? "market_cap");
        return {
          result: json(res),
          log: `${gray("→")} market_overview… ${res.coins.length} coins, sort=${res.sort} (${res.source})`,
        };
      }
      case "token_info": {
        const res = await tokenInfo(args.symbol ?? "", ctx);
        return { result: json(res), log: `${gray("→")} token_info… ${res.coin.symbol}` };
      }
      case "suggest_allocation": {
        const res = await suggestAllocation(args.amount_usd ?? Number.NaN, args.risk_level, ctx);
        const tag =
          "error" in res
            ? yellow(res.error === "missing_risk_level" ? "needs risk profile" : res.error)
            : `${res.options.length} options (${res.riskLevel})`;
        return { result: json(res), log: `${gray("→")} suggest_allocation… ${tag}` };
      }
      default:
        return {
          result: json({ error: "unknown_tool", message: name }),
          log: `${gray("→")} ${name} (unknown)`,
        };
    }
  } catch (err) {
    return { result: json(toStructuredError(err)), log: `${gray("→")} ${name}… ${red("error")}` };
  }
}

/** Run the interactive CLI chat loop. */
export async function runChat(): Promise<void> {
  const ctx = createContext();
  const client = new OpenAI();
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  console.log(bold(cyan("Pharos Guard — treasurer agent")));
  console.log(
    gray(
      `  mode: ${ctx.dryRun ? "DRY RUN (fixtures, no RPC)" : "LIVE"} | model: ${model} | ` +
        `policy: ${ctx.deployments.treasuryPolicy ?? "pending"}`,
    ),
  );
  console.log(
    gray(
      '  try: "send 0.05 PHRS to 0x…beef", "swap 0.5 PHRS to USDC" or "what are my limits?"  (Ctrl-C to exit)\n',
    ),
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  while (true) {
    const userInput = (await rl.question(bold("you › "))).trim();
    if (!userInput) continue;
    if (userInput === "exit" || userInput === "quit") break;
    messages.push({ role: "user", content: userInput });

    // Tool-calling loop until the model produces a final answer.
    for (let hop = 0; hop < 8; hop++) {
      const completion = await client.chat.completions.create({ model, messages, tools: TOOLS });
      const msg = completion.choices[0]?.message;
      if (!msg) break;
      messages.push(msg);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        if (msg.content) console.log(`${cyan("agent ›")} ${msg.content}\n`);
        break;
      }

      for (const call of msg.tool_calls) {
        if (call.type !== "function") continue;
        let parsed: { text?: string } = {};
        try {
          parsed = JSON.parse(call.function.arguments || "{}");
        } catch {
          parsed = {};
        }
        const { result, log } = await dispatch(call.function.name, parsed, ctx);
        console.log(`  ${log}`);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }
  }

  rl.close();
}
