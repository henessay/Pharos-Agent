# Pharos Skill Format

Reverse-engineered from the reference skill
[`PharosNetwork/pharos-skill-engine`](https://github.com/PharosNetwork/pharos-skill-engine)
(commit `a873387`, cloned 2026-06-11). This document is the spec our
`tx-guard` skill follows so it installs and behaves like a first-class Pharos
skill.

> **Skill model in one line:** a skill is a Markdown instruction file
> (`SKILL.md`) with YAML frontmatter, plus a folder of *assets* (data files,
> contract templates, code templates) and *references* (detailed, lazily-loaded
> instruction files). There is **no executable entrypoint** — the skill is a
> prompt/instruction bundle that an LLM agent reads and acts on using CLI tools
> like `cast` / `forge`.

---

## 1. Repository layout of the reference skill

```
pharos-skill-engine/
├── SKILL.md                         # entrypoint: frontmatter + capability index
├── assets/                          # data + templates the agent reads at runtime
│   ├── networks.json                # RPC URLs, chain ids, explorers per network
│   ├── tokens.json                  # known token addresses per network
│   ├── airdrop/                     # Solidity contracts + scripts for airdrops
│   │   ├── AirdropHelper.sol
│   │   ├── BatchAirdrop.s.sol
│   │   ├── BatchAirdropERC20.s.sol
│   │   ├── ERC20Distributor.sol
│   │   └── NativeDistributor.sol
│   ├── erc20/
│   │   └── StandardERC20.sol         # built-in ERC20 template for one-click deploy
│   └── templates/                    # code-gen templates, *.tpl to avoid IDE pickup
│       ├── template_read.{js,ts,py}.tpl
│       └── template_write.{js,ts,py}.tpl
└── references/                       # detailed instructions, loaded on demand
    ├── contract.md                   # deploy / verify / ERC20 one-click
    ├── query.md                      # balance / tx / read calls
    ├── transaction.md                # transfers / writes / gas / airdrops
    └── script-gen.md                 # contract interaction script generation
```

Key conventions observed:

- **`SKILL.md` is the only required file at the root.** Everything else is
  referenced *from* it by relative path.
- **Assets are read at runtime** by the agent (e.g.
  `jq -r '...' assets/networks.json`), not bundled/compiled.
- **References are lazily loaded.** `SKILL.md` holds a "Capability Index" table
  that maps a user need → a `references/<file>.md#anchor`. The agent only opens
  a reference when the matching capability is requested. This keeps the always-
  loaded context small.
- **Templates use a `.tpl` suffix** (`template_write.ts.tpl`) so editors/linters
  don't try to parse them as real source. Placeholders are `{{DOUBLE_BRACE}}`.

---

## 2. Frontmatter

`SKILL.md` opens with a YAML frontmatter block delimited by `---`. From the
reference:

```yaml
---
name: pharos-skill-engine
description: >
  REQUIRED for any Pharos blockchain task. This skill contains the RPC
  endpoints, chain IDs, explorer URLs, and token addresses needed to run
  cast/forge commands on Pharos ... Invoke whenever the user mentions
  "pharos", "PHRS", "PROS", ... Do not attempt Pharos on-chain operations
  without this skill.
version: 0.1.0
requires:
  anyBins:
    - cast
    - forge
---
```

### Frontmatter fields

| Field | Required | Type | Purpose |
|-------|----------|------|---------|
| `name` | ✅ | string (kebab-case) | Unique skill id. Matches the install name (`skills add <name>`). |
| `description` | ✅ | string (multi-line `>` ok) | The single most important field. It is **trigger text**: it tells the agent *when* to load the skill. The reference packs it with (a) a strong "REQUIRED for…" imperative, (b) explicit trigger keywords (`pharos`, `PHRS`, `PROS`, `atlantic-testnet`), and (c) an anti-fallback instruction ("Do not attempt … without this skill"). |
| `version` | ✅ | semver string | Skill version. |
| `requires.anyBins` | ⬜ optional | string[] | Binary prerequisites; *any one* satisfies. Reference lists `cast` / `forge`. Use `allBins` if every binary is mandatory. |

> **Template for our skill** — see [`§5`](#5-frontmatter-template-for-tx-guard).

---

## 3. Required vs optional files (compliance checklist)

| File | Required? | Notes |
|------|-----------|-------|
| `SKILL.md` | ✅ **Required** | Frontmatter + body. The only hard requirement. |
| `SKILL.md` › frontmatter `name` | ✅ | kebab-case, unique. |
| `SKILL.md` › frontmatter `description` | ✅ | Trigger text with keywords + imperative. |
| `SKILL.md` › frontmatter `version` | ✅ | semver. |
| `SKILL.md` › `# <Title>` H1 | ✅ | Human title of the skill. |
| `SKILL.md` › Prerequisites section | ◻️ Strongly recommended | How to install required bins (the reference makes Foundry install mandatory & blocking). |
| `SKILL.md` › Capability Index table | ◻️ Recommended | `User Need │ Capability │ → references/…#anchor`. The routing layer. |
| `SKILL.md` › Error-handling table(s) | ◻️ Recommended | CLI error signature → user-facing handling. |
| `SKILL.md` › Security section | ◻️ Recommended | Private-key handling, network confirmation. |
| `assets/` | ◻️ As needed | Runtime data (`networks.json`, `tokens.json`) and templates. |
| `references/*.md` | ◻️ As needed | One file per capability cluster, linked from the index via anchors. |
| `assets/templates/*.tpl` | ◻️ As needed | Code-gen templates with `{{PLACEHOLDER}}` tokens. |

### Body sections present in the reference `SKILL.md`

1. `# <Title>` + one-line summary
2. `## Prerequisites` (install Foundry; configure `$PRIVATE_KEY`)
3. `## Network Configuration` (how to read `assets/networks.json`)
4. `## Capability Index` (the routing table)
5. `## General Error Handling` (error signature → handling table)
6. `## Security Reminders`
7. `## Write Operation Pre-checks` (key check → derive address → confirm
   network → balance check)

---

## 4. Conventions to mirror

- **Networks come from `assets/networks.json`**, never hard-coded in prose.
  Each entry: `name`, `rpcUrl`, `chainId`, `explorerUrl`, `explorerApiUrl`,
  `nativeToken`; file also has a top-level `defaultNetwork`.
- **Capability routing via anchors:** index rows link to
  `references/<file>.md#<kebab-anchor>`; references are only opened on demand.
- **Tooling is `cast` / `forge`.** Write ops always pass `--rpc-url <rpc>` and
  `--private-key $PRIVATE_KEY` *explicitly* (the reference stresses that Foundry
  does not auto-read env vars).
- **Code-gen templates** live in `assets/templates/*.tpl` with `{{PLACEHOLDER}}`
  tokens; the agent string-replaces them. Placeholders used:
  `{{DEPENDENCY_COMMENT}}`, `{{RPC_URL}}`, `{{CHAIN_ID}}`, `{{NETWORK_NAME}}`,
  `{{CONTRACT_ADDRESS}}`, `{{ABI}}`, `{{METHOD_FUNCTIONS}}`, `{{MAIN_EXAMPLE}}`.
- **Security defaults:** never log/commit private keys; confirm target network
  (loud warning for mainnet) before any write.

---

## 5. Frontmatter template for `tx-guard`

```yaml
---
name: tx-guard
description: >
  REQUIRED before any AI agent sends a transaction on Pharos. tx-guard is a
  transaction firewall: it vets a proposed transaction (recipient, value,
  calldata) against an on-chain treasury Policy and records the verdict to a
  GuardLog contract BEFORE signing. Invoke whenever an agent is about to
  `cast send`, transfer PHRS/PROS, call a contract write method, or deploy on
  Pharos — or when the user mentions "tx-guard", "treasury policy", "spending
  limit", "allowlist", "pharos", "PHRS", or "PROS". Do NOT broadcast an agent
  transaction on Pharos without first clearing it through this skill.
version: 0.1.0
requires:
  anyBins:
    - cast
    - forge
---
```

### Minimum file set to ship `tx-guard` as a skill

- [ ] `SKILL.md` with the frontmatter above + body (Prerequisites, Capability
      Index, Security, Write Pre-checks, Error handling).
- [ ] `assets/networks.json` — at minimum a `pharos-testnet` entry
      (`chainId: 688688`, `rpcUrl`, `explorerUrl`). Mirrors the
      values in `packages/guard-skill/src/chain.ts`.
- [ ] `assets/policy.example.json` — sample treasury policy (allowlist,
      per-tx limit).
- [ ] `references/check.md` — how to evaluate a tx against the Policy contract
      (`cast call POLICY "check(address,uint256)" …`).
- [ ] `references/record.md` — how to append a verdict to GuardLog.
- [ ] `references/deploy.md` — deploy Policy + GuardLog (wraps
      `packages/contracts/script/Deploy.s.sol`).

---

## 6. Installation (`npx skills add`)

The reference repo does **not** ship an installer, manifest beyond
`SKILL.md`, or a published npm package — install is handled by the external
`skills` CLI, which clones/copies a skill directory into the agent's skills
folder and reads `SKILL.md`. The contract the skill must satisfy for
`npx skills add <source>` is simply:

1. A `SKILL.md` exists at the root of the added directory/repo.
2. Its frontmatter has a valid `name`, `description`, and `version`.
3. All paths referenced from `SKILL.md` (`assets/…`, `references/…`) exist
   relative to `SKILL.md`.

> Because install resolves relative paths from `SKILL.md`, keep every asset and
> reference **inside the skill directory** and link with relative paths only.

---

## 7. Validation schema / CI in the reference repo

**None present.** As of commit `a873387` the reference repo contains *no*
JSON schema, no `.github/` workflows, no lint config, and no test suite — it is
a pure instruction+asset bundle. Validation is therefore **convention-based**,
which is why this checklist exists. The closest thing to a machine-checkable
contract is the shape of `assets/networks.json` (every entry needs `name`,
`rpcUrl`, `chainId`, `explorerUrl`, `explorerApiUrl`, `nativeToken`).

If we want stronger guarantees for our own skill, we should add (not required
by the reference, but good practice):

- a JSON Schema for `networks.json` / `policy.json`, and
- a CI check that (a) parses the `SKILL.md` frontmatter, (b) asserts required
  fields, and (c) verifies every relative link in `SKILL.md` resolves.

---

## 8. Compliance checklist (tick before submission)

- [ ] `SKILL.md` present at skill root with valid YAML frontmatter.
- [ ] `name` is kebab-case and unique (`tx-guard`).
- [ ] `description` contains trigger keywords + a "REQUIRED/Do NOT … without"
      imperative.
- [ ] `version` is semver.
- [ ] `requires.anyBins` declares `cast` / `forge` if CLI tools are used.
- [ ] H1 title + one-line summary at the top of the body.
- [ ] Capability Index routes each user need to a `references/*.md#anchor`.
- [ ] Networks read from `assets/networks.json`, not hard-coded prose; testnet
      `chainId` is **688688**.
- [ ] Security section: never log/commit keys; confirm network before writes.
- [ ] Every relative path referenced from `SKILL.md` exists.
- [ ] Code-gen templates (if any) under `assets/templates/*.tpl` with
      `{{PLACEHOLDER}}` tokens.
```
