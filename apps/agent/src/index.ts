import { runChat } from "./agent.js";
import { yellow } from "./colors.js";

if (!process.env.OPENAI_API_KEY) {
  console.error(
    yellow(
      "OPENAI_API_KEY is not set. The interactive chat needs it.\n" +
        "Set GUARD_DRY_RUN=1 to run the firewall against fixtures (no RPC), but the\n" +
        "conversational layer still requires an OpenAI key. For offline verification of\n" +
        "the dialog logic, run the unit tests: pnpm --filter @pharos-guard/agent test",
    ),
  );
  process.exit(1);
}

runChat().catch((err: unknown) => {
  console.error("agent failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
