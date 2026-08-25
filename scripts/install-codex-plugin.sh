#!/usr/bin/env bash
# Install the local Vinea public plugin into this user's Codex marketplace.
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
plugin_source="$project_root/plugins/vinea"
conflict_checker="$project_root/scripts/check-plugin-install-conflict.mjs"
home_dir="${HOME:?HOME must be set to install the local Codex plugin.}"
plugin_root="$home_dir/.codex/plugins/vinea"
marketplace_file="$home_dir/.agents/plugins/marketplace.json"

cd "$project_root"
if command -v codex >/dev/null 2>&1; then
  codex plugin list | node "$conflict_checker" --host codex --installing personal
fi
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

if [[ ! -f "$marketplace_file" ]]; then
  printf 'Configured Codex personal marketplace is unavailable at %s. Create it with Codex before refreshing Vinea.\n' "$marketplace_file" >&2
  exit 1
fi

marketplace_name="$(node --input-type=module - "$marketplace_file" <<'NODE'
import { readFile } from "node:fs/promises";

const marketplaceFile = process.argv[2];
const marketplace = JSON.parse(await readFile(marketplaceFile, "utf8"));
if (marketplace === null || typeof marketplace !== "object" || Array.isArray(marketplace)) {
  throw new Error(`Marketplace file must contain an object: ${marketplaceFile}`);
}
if (!Array.isArray(marketplace.plugins)) {
  throw new Error(`Marketplace file must contain a plugins array: ${marketplaceFile}`);
}
if (typeof marketplace.name !== "string" || marketplace.name.trim() === "") {
  throw new Error(`Marketplace file must contain a name: ${marketplaceFile}`);
}

const entry = marketplace.plugins.find((candidate) => (
  candidate !== null
  && typeof candidate === "object"
  && !Array.isArray(candidate)
  && candidate.name === "vinea"
));
if (entry === undefined) {
  throw new Error(`Marketplace file must contain a Vinea entry: ${marketplaceFile}`);
}
const source = entry.source;
if (
  source === null
  || typeof source !== "object"
  || Array.isArray(source)
  || source.source !== "local"
  || source.path !== "./.codex/plugins/vinea"
) {
  throw new Error(`Vinea entry must use local source ./.codex/plugins/vinea: ${marketplaceFile}`);
}

process.stdout.write(marketplace.name.trim());
NODE
)"

cachebuster_script="$home_dir/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py"
if [[ ! -f "$cachebuster_script" ]]; then
  printf 'Codex plugin cachebuster helper is unavailable at %s.\n' "$cachebuster_script" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  printf 'Python 3 is unavailable; it is required for the Codex plugin cachebuster.\n' >&2
  exit 1
fi

printf 'Prepared Codex plugin source:\n  %s\nValidated configured marketplace:\n  %s (%s)\n' "$plugin_root" "$marketplace_file" "$marketplace_name"

if ! command -v codex >/dev/null 2>&1; then
  printf 'Codex CLI is unavailable; plugin activation was not performed.\n' >&2
  printf 'When Codex is available, run:\n  python3 %q %q\n  codex plugin add vinea@%s\n' "$cachebuster_script" "$plugin_root" "$marketplace_name"
  printf 'Then start a new Codex session: plugins and skills are not hot-reloaded.\n'
  exit 0
fi

python3 "$cachebuster_script" "$plugin_root"
codex plugin add "vinea@$marketplace_name"

printf 'Vinea is refreshed for Codex. Start a new Codex session: plugins and skills are not hot-reloaded.\n'
