import { createInterface } from "node:readline/promises";
import { toStructuredError } from "@pharos-guard/guard-skill";
import OpenAI from "openai";
import { bold, colorVerdict, cyan, gray, green, red } from "./colors.js";
import { decideAction, fixHint } from "./decide.js";
import {
  addLiquidity,
  getQuote,
  parseAddLiquidityIntent,
  parseRemoveLiquidityIntent,
  parseSwapIntent,
  removeLiquidity,
  swapTokens,
} from "./dex.js";
import { isProposeError, parseIntent } from "./propose.js";
import {
  type AgentContext,
  createContext,
  executePayment,
  getPolicyStatus,
  guardCheck,
} from "./tools.js";

const SYSTEM_PROMPT = `You are a Pharos treasury agent. You move PHRS out of a TreasuryPolicy contract on the Pharos testnet on the user's behalf. You can also trade on FaroSwap: swap between PHRS, WPHRS, USDC and USDT (get_quote / swap_tokens) and manage full-range LP positions (add_liquidity / remove_liquidity).

Hard rules (a firewall enforces these in code too):
1. NEVER call execute_payment without first calling guard_check on the same request.
2. If the guard verdict is "allow": execute the payment, then show the block-explorer link.
3. If the verdict is "warn": show the risks and ask the user to confirm with y/n BEFORE executing.
4. If the verdict is "block": do NOT execute. Explain the blocking reason and how to fix it.
5. Use policy_status whenever the user asks about limits, daily spend, or balance.
6. Every DeFi action (swap, add/remove liquidity) runs the full tx-guard firewall INSIDE the tool — including its approvals. You never execute around the firewall, and there is no way to skip it.
7. When a DeFi tool returns decision.action "confirm" (a warn verdict): show the triggered risks, ask y/n, and only after an explicit "y" call the SAME tool again with confirmed=true. Never set confirmed=true on the first call.
8. On an executed action, always show the transaction hash link; on "block", relay the reason and the fix hint.
Be concise. Always state the verdict explicitly.`;

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "propose_payment",
      description:
        "Parse a natural-language payment or approval request into a structured intent (preview only, no on-chain effect).",
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
        "Run the tx-guard firewall over the request and return the verdict (allow/warn/block) with risks. Call this before any execution.",
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
        "Swap PHRS/WPHRS/USDC/USDT on FaroSwap. Runs the full tx-guard firewall (base + DEX rules) over the swap and its approvals first; executes only on an allow verdict (or a warn the user explicitly confirmed).",
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
];

const json = (v: unknown) =>
  JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));

/** Dispatch a tool call; returns the JSON result for the model and a log line. */
async function dispatch(
  name: string,
  args: { text?: string; confirmed?: boolean },
  ctx: AgentContext,
): Promise<{ result: string; log: string }> {
  const execTag = (res: { executed: boolean; decision: { verdict: string } }) =>
    res.executed ? green("executed") : red(`refused (${res.decision.verdict})`);
  try {
    switch (name) {
      case "propose_payment": {
        const intent = parseIntent(args.text ?? "");
        return { result: json(intent), log: `${gray("→")} propose_payment` };
      }
      case "guard_check": {
        const intent = parseIntent(args.text ?? "");
        if (isProposeError(intent))
          return { result: json(intent), log: `${gray("→")} guard_check… ${red("parse error")}` };
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
