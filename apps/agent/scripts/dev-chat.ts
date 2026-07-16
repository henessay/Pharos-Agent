/**
 * Dev harness: run phrases through the REAL model + tool loop (same
 * SYSTEM_PROMPT / TOOLS / dispatch as the interactive chat) and log every
 * tool call the model makes, with its raw arguments. The guard side runs
 * against fixtures when GUARD_DRY_RUN=1, so nothing touches RPC or chain.
 *
 * Usage:
 *   GUARD_DRY_RUN=1 OPENAI_API_KEY=… pnpm exec tsx scripts/dev-chat.ts "swap 0.01 PHRS to USDC" …
 */
import OpenAI from "openai";
import { dispatch, SYSTEM_PROMPT, TOOLS } from "../src/agent.js";
import { createContext } from "../src/tools.js";

const phrases = process.argv.slice(2);
if (phrases.length === 0) {
  console.error('usage: dev-chat.ts "phrase" ["phrase" …]');
  process.exit(2);
}

const ctx = createContext();
const client = new OpenAI();
const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
console.log(`mode: ${ctx.dryRun ? "DRY RUN" : "LIVE"} | model: ${model}`);

// Each argv entry is one conversation; " >>> " separates follow-up user turns
// inside it (e.g. "swap 0.01 PHRS to USDC >>> yes").
for (const phrase of phrases) {
  console.log(`\n${"═".repeat(72)}`);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  for (const turn of phrase.split(" >>> ")) {
    console.log(`you › ${turn}`);
    messages.push({ role: "user", content: turn });

    for (let hop = 0; hop < 8; hop++) {
      const completion = await client.chat.completions.create({ model, messages, tools: TOOLS });
      const msg = completion.choices[0]?.message;
      if (!msg) break;
      messages.push(msg);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        console.log(`agent › ${msg.content}`);
        break;
      }

      for (const call of msg.tool_calls) {
        if (call.type !== "function") continue;
        console.log(`[tool-call] ${call.function.name} ${call.function.arguments}`);
        let parsed: { text?: string; confirmed?: boolean } = {};
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
}
