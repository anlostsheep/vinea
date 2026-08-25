#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const requestedRelease = process.argv[2];
const releasePaths = [
  "package.json",
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  "plugins/vinea",
];
let releaseCommitCreated = false;
let releaseTagCreated = false;

try {
  const packagePath = `${repositoryRoot}/package.json`;
  const rootPackage = JSON.parse(await readFile(packagePath, "utf8"));
  if (rootPackage.name !== "vinea") throw new Error("Release repository package name must be vinea.");
  if (typeof rootPackage.version !== "string" || !/^\d+\.\d+\.\d+$/.test(rootPackage.version)) {
    throw new Error("Current package.json version must be MAJOR.MINOR.PATCH.");
  }
  const requestedVersion = resolveVersion(requestedRelease, rootPackage.version);
  if (compareVersions(requestedVersion, rootPackage.version) <= 0) {
    throw new Error(`Release version ${requestedVersion} must be greater than ${rootPackage.version}.`);
  }

  await assertMainBranch();
  await assertReleaseTagAbsent(requestedVersion);
  await assertCleanReleaseBase();

  rootPackage.version = requestedVersion;
  await writeFile(packagePath, `${JSON.stringify(rootPackage, null, 2)}\n`, "utf8");
  await run("npm", ["run", "check"], { inherit: true });
  await assertOnlyReleasePathsChanged();

  await run("git", ["add", "--", ...releasePaths]);
  const stagedPaths = splitNull((await run("git", ["diff", "--cached", "--name-only", "-z"])).stdout);
  if (stagedPaths.length === 0) throw new Error("Release produced no staged changes.");
  for (const path of stagedPaths) {
    if (!isReleasePath(path)) throw new Error(`Release staged an unsupported path: ${path}`);
  }

  await run("git", ["commit", "-m", `chore: release Vinea ${requestedVersion}`], { inherit: true });
  releaseCommitCreated = true;
  await run("git", ["tag", "-a", `v${requestedVersion}`, "-m", `Vinea ${requestedVersion}`]);
  releaseTagCreated = true;
  process.stdout.write(`Created local Vinea release ${requestedVersion}. Push is intentionally not performed.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write(
    `Local commit: ${releaseCommitCreated ? "created" : "not created"}; local tag: ${releaseTagCreated ? "created" : "not created"}; push: not attempted.\n`,
  );
  process.stderr.write("Inspect the worktree and local refs before retrying; no reset or cleanup was performed.\n");
  process.exitCode = 1;
}

async function assertMainBranch() {
  const branch = (await run("git", ["branch", "--show-current"])).stdout.trim();
  if (branch !== "main") throw new Error(`Release must run from main, not ${branch || "a detached HEAD"}.`);
}

async function assertReleaseTagAbsent(version) {
  try {
    await run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/v${version}`]);
  } catch {
    return;
  }
  throw new Error(`Release tag v${version} already exists.`);
}

async function assertCleanReleaseBase() {
  const entries = parseStatus((await run("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout);
  for (const entry of entries) {
    if (isVineaPath(entry.path)) {
      if (entry.indexStatus !== " " && entry.indexStatus !== "?") {
        throw new Error(`Vinea task state must not be staged for release: ${entry.path}`);
      }
      continue;
    }
    throw new Error(`Release requires a clean non-.vinea worktree; found ${entry.path}.`);
  }
}

async function assertOnlyReleasePathsChanged() {
  const entries = parseStatus((await run("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout);
  for (const { path } of entries) {
    if (!isVineaPath(path) && !isReleasePath(path)) {
      throw new Error(`Release validation changed an unsupported path: ${path}`);
    }
  }
}

function parseStatus(output) {
  const records = splitNull(output);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) continue;
    const indexStatus = record[0];
    const worktreeStatus = record[1];
    const path = record.slice(3);
    entries.push({ indexStatus, worktreeStatus, path });
    if (indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C") {
      index += 1;
      const originalPath = records[index];
      if (originalPath !== undefined) entries.push({ indexStatus, worktreeStatus, path: originalPath });
    }
  }
  return entries;
}

function isVineaPath(path) {
  return path === ".vinea" || path.startsWith(".vinea/");
}

function isReleasePath(path) {
  return releasePaths.some((candidate) => path === candidate || path.startsWith(`${candidate}/`));
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function resolveVersion(requested, current) {
  if (/^\d+\.\d+\.\d+$/.test(requested ?? "")) return requested;
  if (!/^(major|minor|patch)$/.test(requested ?? "")) {
    throw new Error("Release must be major, minor, patch, or an exact MAJOR.MINOR.PATCH value.");
  }
  const [major, minor, patch] = current.split(".").map(Number);
  if (requested === "major") return `${major + 1}.0.0`;
  if (requested === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function splitNull(value) {
  return value.split("\0").filter(Boolean);
}

async function run(command, args, options = {}) {
  if (options.inherit) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: repositoryRoot, stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve({ stdout: "", stderr: "" });
        else reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? code ?? "unknown"}).`));
      });
    });
  }
  return execFileAsync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}
