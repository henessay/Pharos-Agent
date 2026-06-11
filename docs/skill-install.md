# Installing the tx-guard skill

The skill lives in [`skill/`](../skill) and follows the Pharos skill format
(see [`skill-format.md`](skill-format.md)). It installs with the
[`skills`](https://github.com/vercel-labs/skills) CLI.

## Command

```bash
# from anywhere; point at the local skill directory
npx skills add /absolute/path/to/Pharos-Agent/skill \
  --copy --yes --agent claude-code --skill '*'
```

- `--copy` copies the files (instead of symlinking) into the agent's skills dir.
- `--agent claude-code` targets Claude Code (run `npx skills add --help` for the
  full agent list; use `--agent '*'` for all).

## Expected result

```text
o  Local path validated
o  Found 1 skill
•  Installing all 1 skills
o  Installed 1 skill
   ✓ tx-guard (copied)
     → ./.claude/skills/tx-guard
```

Installed tree:

```text
.claude/skills/tx-guard/
├── SKILL.md
├── assets/networks.json
├── references/risk-rules.md
└── scripts/{guard-check,policy-status,log-history}.mjs
```

The wrapper scripts import the built `@pharos-guard/guard-skill` core, so run
`pnpm install && pnpm build` in the monorepo first. Until the contracts are
deployed, every script returns
`{ "error": "contracts_not_deployed", "message": "… deploy pending …" }` — by
design, not a failure.
