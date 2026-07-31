import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(projectRoot, "plugins", "vinea");
const versionPlaceholder = "__VINEA_VERSION__";

await runNpmBuild();

const packageJson = await readJson(join(projectRoot, "package.json"));
if (typeof packageJson.version !== "string" || packageJson.version.trim() === "") {
  throw new Error("package.json must contain a nonempty version.");
}
const version = packageJson.version;

await rm(publicRoot, { recursive: true, force: true });
await mkdir(join(publicRoot, "bin"), { recursive: true });
await mkdir(join(publicRoot, ".codex-plugin"), { recursive: true });
await mkdir(join(publicRoot, ".claude-plugin"), { recursive: true });

await cp(join(projectRoot, "dist", "vinea.mjs"), join(publicRoot, "bin", "vinea.mjs"));
await chmod(join(publicRoot, "bin", "vinea.mjs"), 0o755);
await cp(join(projectRoot, "skills"), join(publicRoot, "skills"), { recursive: true });
await cp(join(projectRoot, "hosts", "public-plugin", "README.md"), join(publicRoot, "README.md"));
await cp(join(projectRoot, "LICENSE"), join(publicRoot, "LICENSE"));

for (const [host, manifestDirectory] of [
  ["codex", ".codex-plugin"],
  ["claude", ".claude-plugin"],
]) {
  const sourceManifest = await readJson(
    join(projectRoot, "hosts", host, manifestDirectory, "plugin.json"),
  );
  if (sourceManifest.version !== versionPlaceholder) {
    throw new Error(`hosts/${host} plugin manifest must use ${versionPlaceholder}.`);
  }
  sourceManifest.version = version;
  await writeJson(join(publicRoot, manifestDirectory, "plugin.json"), sourceManifest);
}

await mkdir(join(projectRoot, ".agents", "plugins"), { recursive: true });
await mkdir(join(projectRoot, ".claude-plugin"), { recursive: true });

await writeJson(join(projectRoot, ".agents", "plugins", "marketplace.json"), {
  name: "vinea",
  version,
  interface: { displayName: "Vinea" },
  plugins: [
    {
      name: "vinea",
      version,
      source: { source: "local", path: "./plugins/vinea" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Developer Tools",
    },
  ],
});

await writeJson(join(projectRoot, ".claude-plugin", "marketplace.json"), {
  name: "vinea",
  owner: { name: "dengzhen" },
  metadata: {
    description: "Shared task state and guided AI-coding workflows for Codex and Claude Code.",
    version,
  },
  plugins: [
    {
      name: "vinea",
      description: "Shared AI-coding task workflows for Codex and Claude Code.",
      version,
      author: { name: "dengzhen" },
      source: "./plugins/vinea",
    },
  ],
});

console.log(`Packaged Vinea ${version} at plugins/vinea.`);

async function runNpmBuild() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  await new Promise((resolve, reject) => {
    const child = spawn(npmCommand, ["run", "build"], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`npm run build failed (${signal ?? code ?? "unknown"}).`));
    });
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
