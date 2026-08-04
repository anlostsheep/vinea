#!/usr/bin/env bash
# Install the local Vinea public plugin into this user's Claude Code marketplace.
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
plugin_source="$project_root/plugins/vinea"
home_dir="${HOME:?HOME must be set to install the local Claude Code plugin.}"
marketplace_root="$home_dir/.claude/plugins/marketplaces/vinea-local"
plugin_root="$marketplace_root/plugins/vinea"
marketplace_file="$marketplace_root/.claude-plugin/marketplace.json"
version="$(node -p 'require(require("node:path").resolve(process.argv[1])).version' "$project_root/package.json")"

cd "$project_root"
npm run package:plugin

if [[ ! -d "$plugin_source" ]]; then
  printf 'Vinea package was not created at %s.\n' "$plugin_source" >&2
  exit 1
fi

mkdir -p "$(dirname "$plugin_root")"
staging_root="$(mktemp -d "$(dirname "$plugin_root")/.vinea-install.XXXXXX")"
cleanup() { rm -rf -- "$staging_root"; }
trap cleanup EXIT

cp -R "$plugin_source/." "$staging_root/"
rm -rf -- "$plugin_root"
mv "$staging_root" "$plugin_root"
trap - EXIT

mkdir -p "$(dirname "$marketplace_file")"
VINEA_INSTALL_VERSION="$version" node --input-type=module - "$marketplace_file" <<'NODE'
import { rename, writeFile } from "node:fs/promises";

const marketplaceFile = process.argv[2];
const marketplace = {
  name: "vinea-local",
  owner: { name: "local" },
  metadata: {
    description: "Local Vinea plugin for shared AI-coding task workflows.",
    version: process.env.VINEA_INSTALL_VERSION,
  },
  plugins: [{
    name: "vinea",
    description: "Shared AI-coding task workflows for Codex and Claude Code.",
    version: process.env.VINEA_INSTALL_VERSION,
    author: { name: "dengzhen" },
    source: "./plugins/vinea",
  }],
};

const temporaryFile = `${marketplaceFile}.tmp-${process.pid}`;
await writeFile(temporaryFile, `${JSON.stringify(marketplace, null, 2)}\n`, "utf8");
await rename(temporaryFile, marketplaceFile);
NODE

printf 'Prepared Claude Code plugin files:\n  %s\n  %s\n' "$plugin_root" "$marketplace_file"

if ! command -v claude >/dev/null 2>&1; then
  printf 'Claude Code CLI is unavailable; plugin activation was not performed.\n' >&2
  printf 'When Claude Code is available, run:\n  claude plugin validate %q\n  claude plugin marketplace add %q\n  claude plugin marketplace update vinea-local\n  if claude plugin list | grep -Fq "vinea@vinea-local"; then\n    claude plugin update vinea@vinea-local --scope user\n  else\n    claude plugin install vinea@vinea-local --scope user\n  fi\n' "$plugin_root" "$marketplace_root"
  printf 'Then start a new Claude Code session: plugins and skills are not hot-reloaded.\n'
  exit 0
fi

claude plugin validate "$plugin_root"
if ! claude plugin marketplace add "$marketplace_root"; then
  printf 'Claude Code marketplace add did not succeed; it may already be configured. Continuing with marketplace refresh.\n' >&2
fi
claude plugin marketplace update vinea-local
if claude plugin list | grep -Fq "vinea@vinea-local"; then
  claude plugin update vinea@vinea-local --scope user
else
  claude plugin install vinea@vinea-local --scope user
fi

printf 'Vinea is refreshed for Claude Code. Start a new Claude Code session: plugins and skills are not hot-reloaded.\n'
