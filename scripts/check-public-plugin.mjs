import { access, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const publicRoot = join(projectRoot, "plugins", "vinea");
const expectedSkills = [
  "brainstorm",
  "check",
  "continue",
  "doctor",
  "finish",
  "orient",
  "plan",
  "propose",
];
const rootPackage = await readJson(join(projectRoot, "package.json"));
const version = requiredString(rootPackage.version, "package.json version");

const codexManifest = await readJson(join(publicRoot, ".codex-plugin", "plugin.json"));
const claudeManifest = await readJson(join(publicRoot, ".claude-plugin", "plugin.json"));
for (const [name, manifest] of [["Codex", codexManifest], ["Claude", claudeManifest]]) {
  if (manifest.version !== version) throw new Error(`${name} manifest version does not match package.json.`);
  if (manifest.skills !== "./skills/") throw new Error(`${name} manifest must expose ./skills/.`);
}

const cliPath = join(publicRoot, "bin", "vinea.mjs");
await access(cliPath);
const cliStat = await stat(cliPath);
if ((cliStat.mode & 0o111) === 0) throw new Error("Public CLI must be executable.");

const skillDirectories = (await readdir(join(publicRoot, "skills"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (JSON.stringify(skillDirectories) !== JSON.stringify(expectedSkills)) {
  throw new Error(`Public skill inventory is invalid: ${skillDirectories.join(", ")}.`);
}
for (const skill of expectedSkills) await access(join(publicRoot, "skills", skill, "SKILL.md"));

const codexMarketplace = await readJson(join(projectRoot, ".agents", "plugins", "marketplace.json"));
const claudeMarketplace = await readJson(join(projectRoot, ".claude-plugin", "marketplace.json"));
if (codexMarketplace.version !== version || codexMarketplace.plugins?.[0]?.version !== version) {
  throw new Error("Codex marketplace version does not match package.json.");
}
if (codexMarketplace.plugins?.[0]?.source?.path !== "./plugins/vinea") {
  throw new Error("Codex marketplace must point to ./plugins/vinea.");
}
if (claudeMarketplace.metadata?.version !== version || claudeMarketplace.plugins?.[0]?.version !== version) {
  throw new Error("Claude marketplace version does not match package.json.");
}
if (claudeMarketplace.plugins?.[0]?.source !== "./plugins/vinea") {
  throw new Error("Claude marketplace must point to ./plugins/vinea.");
}

const publicTextPaths = [
  ...(await walkFiles(publicRoot)),
  join(projectRoot, ".agents", "plugins", "marketplace.json"),
  join(projectRoot, ".claude-plugin", "marketplace.json"),
];
for (const path of publicTextPaths) {
  const text = await readFile(path, "utf8");
  if (/\/Users\/|\/home\/|\.codex\/plugins\/cache|__VINEA_VERSION__|\[TODO:/.test(text)) {
    throw new Error(`Public artifact contains a local path or unresolved scaffold placeholder: ${path}`);
  }
}

const help = await runNode(cliPath, ["--help"]);
for (const command of ["init", "orient", "propose", "continue", "check", "finish", "archive", "doctor", "validate"]) {
  if (!help.stdout.includes(command)) throw new Error(`Public CLI help is missing ${command}.`);
}

console.log("Public Vinea plugin checks passed.");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a nonempty string.`);
  return value;
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  }));
  return paths.flat();
}

async function runNode(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Public CLI --help failed (${signal ?? code ?? "unknown"}): ${stderr}`));
    });
  });
}
