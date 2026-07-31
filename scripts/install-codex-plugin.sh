#!/usr/bin/env bash
# Install the local Vinea public plugin into this user's Codex marketplace.
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
plugin_source="$project_root/plugins/vinea"
home_dir="${HOME:?HOME must be set to install the local Codex plugin.}"
plugin_root="$home_dir/.codex/plugins/vinea"
marketplace_file="$home_dir/.agents/plugins/marketplace.json"
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
marketplace_name="$(VINEA_INSTALL_VERSION="$version" node --input-type=module - "$marketplace_file" <<'NODE'
import { readFile, rename, writeFile } from "node:fs/promises";

const marketplaceFile = process.argv[2];
let marketplace = {
  name: "personal",
  version: process.env.VINEA_INSTALL_VERSION,
  interface: { displayName: "Personal plugins" },
  plugins: [],
};

try {
  marketplace = JSON.parse(await readFile(marketplaceFile, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (marketplace === null || typeof marketplace !== "object" || Array.isArray(marketplace)) {
  throw new Error(`Marketplace file must contain an object: ${marketplaceFile}`);
}
if (!Array.isArray(marketplace.plugins)) {
  throw new Error(`Marketplace file must contain a plugins array: ${marketplaceFile}`);
}
if (typeof marketplace.name !== "string" || marketplace.name.trim() === "") {
  marketplace.name = "personal";
}
if (typeof marketplace.version !== "string" || marketplace.version.trim() === "") {
  marketplace.version = process.env.VINEA_INSTALL_VERSION;
}
if (marketplace.interface === null || typeof marketplace.interface !== "object" || Array.isArray(marketplace.interface)) {
  marketplace.interface = { displayName: "Personal plugins" };
}

const entry = {
  name: "vinea",
  version: process.env.VINEA_INSTALL_VERSION,
  source: { source: "local", path: "./.codex/plugins/vinea" },
  policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
  category: "Developer Tools",
};
marketplace.plugins = marketplace.plugins.filter((candidate) => candidate?.name !== "vinea");
marketplace.plugins.push(entry);

const temporaryFile = `${marketplaceFile}.tmp-${process.pid}`;
await writeFile(temporaryFile, `${JSON.stringify(marketplace, null, 2)}\n`, "utf8");
await rename(temporaryFile, marketplaceFile);
process.stdout.write(marketplace.name);
NODE
)"

printf 'Prepared Codex plugin files:\n  %s\n  %s\n' "$plugin_root" "$marketplace_file"

if ! command -v codex >/dev/null 2>&1; then
  printf 'Codex CLI is unavailable; plugin activation was not performed.\n' >&2
  printf 'When Codex is available, run:\n  codex plugin marketplace add %q\n  codex plugin add vinea@%s\n' "$home_dir" "$marketplace_name"
  printf 'Then start a new Codex session: plugins and skills are not hot-reloaded.\n'
  exit 0
fi

if ! codex plugin marketplace add "$home_dir"; then
  printf 'Codex marketplace add did not succeed; it may already be configured. Continuing with plugin installation.\n' >&2
fi
codex plugin add "vinea@$marketplace_name"

printf 'Vinea is installed for Codex. Start a new Codex session: plugins and skills are not hot-reloaded.\n'
