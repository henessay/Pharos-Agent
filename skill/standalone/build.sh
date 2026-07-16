#!/usr/bin/env bash
# Build tx-guard-standalone.zip: bundle the guard-skill core into a single
# zero-dependency minified ESM file (lib/guard-skill.mjs, viem inlined) and
# pack the standalone skill layout. Output: <repo root>/tx-guard-standalone.zip
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/tx-guard-standalone.zip"

ESBUILD=$(ls "$ROOT"/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild 2>/dev/null | sort -V | tail -1)
if [ -z "$ESBUILD" ]; then
  echo "esbuild not found in node_modules — run pnpm install first" >&2
  exit 1
fi

PACK=$(mktemp -d)
trap 'rm -rf "$PACK"' EXIT
mkdir -p "$PACK"/tx-guard/{lib,scripts,assets,references}

# The bundle may keep CJS require() calls from inlined deps — shim it for ESM.
"$ESBUILD" "$ROOT/packages/guard-skill/dist/index.js" \
  --bundle --minify --platform=node --format=esm \
  --banner:js='import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' \
  --outfile="$PACK/tx-guard/lib/guard-skill.mjs" \
  --log-level=warning

cp "$ROOT/skill/standalone/SKILL.md" "$PACK/tx-guard/SKILL.md"
cp "$ROOT/skill/standalone/package.json" "$PACK/tx-guard/package.json"
cp "$ROOT"/skill/standalone/scripts/*.mjs "$PACK/tx-guard/scripts/"
cp "$ROOT/skill/standalone/assets/networks.json" "$PACK/tx-guard/assets/"
cp "$ROOT/skill/references/risk-rules.md" "$PACK/tx-guard/references/"
# The agent's self-description — single source of truth shared with the repo.
cp "$ROOT/docs/AGENT_GUIDE.md" "$PACK/tx-guard/references/"

# Trim the monorepo deployments file down to what the runtime loader reads,
# so the packaged copy stays in sync with the actual deployment.
python3 - "$ROOT/packages/contracts/deployments/pharos-testnet.json" \
  "$PACK/tx-guard/assets/deployments.json" <<'EOF'
import json, sys
src = json.load(open(sys.argv[1]))
keep = {k: src[k] for k in
        ("network", "chainId", "status", "rpcUrl", "explorer",
         "treasuryPolicy", "guardLog") if k in src}
json.dump(keep, open(sys.argv[2], "w"), indent=2)
open(sys.argv[2], "a").write("\n")
EOF

(cd "$PACK" && OUT="$OUT" python3 - <<'EOF'
import os, zipfile
out = os.environ["OUT"]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk("tx-guard"):
        for f in sorted(files):
            if f == ".DS_Store":
                continue
            p = os.path.join(root, f)
            z.write(p, p)
print("written", out)
EOF
)
