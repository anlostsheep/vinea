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
assertHostManifest("Codex", codexManifest, version);
assertHostManifest("Claude", claudeManifest, version);
assertCodexInterface(codexManifest.interface);

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
assertCodexMarketplace(codexMarketplace, version);
assertClaudeMarketplace(claudeMarketplace, version);

const publicReadme = await readFile(join(publicRoot, "README.md"), "utf8");
assertPublicReadme(publicReadme);

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

function assertHostManifest(host, manifest, expectedVersion) {
  if (manifest.name !== "vinea") throw new Error(`${host} manifest must identify vinea.`);
  if (manifest.version !== expectedVersion) throw new Error(`${host} manifest version does not match package.json.`);
  if (typeof manifest.description !== "string" || !/shared task state.*Codex.*Claude Code/i.test(manifest.description)) {
    throw new Error(`${host} manifest must describe shared task state for Codex and Claude Code.`);
  }
  if (manifest.author?.name !== "dengzhen") throw new Error(`${host} manifest must declare the Vinea author.`);
  if (manifest.skills !== "./skills/") throw new Error(`${host} manifest must expose ./skills/.`);
  for (const unsupported of ["mcpServers", "hooks", "apps"]) {
    if (unsupported in manifest) throw new Error(`${host} manifest must not declare ${unsupported}.`);
  }
}

function assertCodexInterface(value) {
  if (value === null || typeof value !== "object") throw new Error("Codex manifest must include interface metadata.");
  const interfaceMetadata = value;
  for (const [field, expected] of Object.entries({
    displayName: "Vinea",
    shortDescription: "Shared AI-coding task workflows",
    developerName: "dengzhen",
    category: "Developer Tools",
  })) {
    if (interfaceMetadata[field] !== expected) throw new Error(`Codex interface ${field} is invalid.`);
  }
  if (typeof interfaceMetadata.longDescription !== "string" || interfaceMetadata.longDescription.trim() === "") {
    throw new Error("Codex interface longDescription is required.");
  }
  if (!Array.isArray(interfaceMetadata.capabilities) || interfaceMetadata.capabilities.length === 0) {
    throw new Error("Codex interface capabilities are required.");
  }
  if (!Array.isArray(interfaceMetadata.defaultPrompt) || interfaceMetadata.defaultPrompt.length === 0) {
    throw new Error("Codex interface defaultPrompt is required.");
  }
}

function assertCodexMarketplace(marketplace, expectedVersion) {
  const entry = marketplace.plugins?.[0];
  if (marketplace.name !== "vinea" || marketplace.version !== expectedVersion || entry?.name !== "vinea" || entry.version !== expectedVersion) {
    throw new Error("Codex marketplace identity or version is invalid.");
  }
  if (marketplace.interface?.displayName !== "Vinea") {
    throw new Error("Codex marketplace interface displayName is invalid.");
  }
  if (entry.source?.source !== "local" || entry.source.path !== "./plugins/vinea") {
    throw new Error("Codex marketplace must use the local ./plugins/vinea source.");
  }
  if (entry.policy?.installation !== "AVAILABLE" || entry.policy.authentication !== "ON_INSTALL") {
    throw new Error("Codex marketplace policy is invalid.");
  }
  if (entry.category !== "Developer Tools") throw new Error("Codex marketplace category is invalid.");
}

function assertClaudeMarketplace(marketplace, expectedVersion) {
  const entry = marketplace.plugins?.[0];
  if (marketplace.name !== "vinea" || marketplace.owner?.name !== "dengzhen") {
    throw new Error("Claude marketplace identity is invalid.");
  }
  if (typeof marketplace.metadata?.description !== "string" || marketplace.metadata.version !== expectedVersion) {
    throw new Error("Claude marketplace metadata is invalid.");
  }
  if (entry?.name !== "vinea" || entry.version !== expectedVersion || entry.author?.name !== "dengzhen" || entry.source !== "./plugins/vinea") {
    throw new Error("Claude marketplace plugin entry is invalid.");
  }
}

function assertPublicReadme(readme) {
  if (!readme.includes("node bin/vinea.mjs --help")) {
    throw new Error("Public README must invoke the bundled CLI from the plugin root.");
  }
  if (!/Codex/.test(readme) || !/Claude Code/.test(readme) || !/install/i.test(readme)) {
    throw new Error("Public README must give host installation guidance.");
  }
  if (/\bnpm\b|\bdist\/|\bpackage\.json\b|plugins\/vinea\b/.test(readme)) {
    throw new Error("Public README must not contain development-root commands or paths.");
  }
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
