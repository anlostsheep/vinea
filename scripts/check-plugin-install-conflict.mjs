#!/usr/bin/env node
import process from "node:process";

const options = parseOptions(process.argv.slice(2));
const policies = {
  codex: {
    public: "vinea@vinea",
    development: "vinea@personal",
    remove: (plugin) => `codex plugin remove ${plugin}`,
  },
  claude: {
    public: "vinea@vinea",
    development: "vinea@vinea-local",
    remove: (plugin) => `claude plugin uninstall ${plugin} --scope user`,
  },
};

try {
  const policy = policies[options.host];
  if (policy === undefined) throw new Error("--host must be codex or claude.");
  const validInstalling = options.host === "codex" ? ["vinea", "personal"] : ["vinea", "vinea-local"];
  if (!validInstalling.includes(options.installing)) {
    throw new Error(`--installing must be ${validInstalling.join(" or ")} for ${options.host}.`);
  }

  const pluginList = stripAnsi(await readStandardInput());
  const installingPublic = options.installing === "vinea";
  const conflict = installingPublic ? policy.development : policy.public;
  if (hasInstalledPlugin(pluginList, conflict, options.host)) {
    const target = installingPublic ? policy.public : policy.development;
    throw new Error([
      `Vinea plugin channel conflict: cannot install ${target} while ${conflict} is installed.`,
      "Vinea supports one installed channel per host; no plugin was removed or disabled.",
      `After confirming the migration, run: ${policy.remove(conflict)}`,
    ].join("\n"));
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parseOptions(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (name === "--host") parsed.host = value;
    else if (name === "--installing") parsed.installing = value;
    else throw new Error(`Unknown option: ${name ?? "<missing>"}`);
  }
  return parsed;
}

function hasInstalledPlugin(output, plugin, host) {
  const escaped = plugin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pluginPattern = new RegExp(`(^|\\s)${escaped}(?=\\s|$)`);
  const codexInstalledPattern = new RegExp(`(^|\\s)${escaped}\\s+installed(?:,|\\s|$)`);
  return output.split("\n").some((line) => (
    host === "codex" ? codexInstalledPattern.test(line) : pluginPattern.test(line)
  ));
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

async function readStandardInput() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  return input;
}
