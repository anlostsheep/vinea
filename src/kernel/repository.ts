import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { KernelError } from "./errors.js";
import { actorRule } from "./schema.js";
import type { Actor, RepositoryContext } from "./types.js";

const execute = promisify(execFile);
export async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) delete env[key];
  return (await execute("git", args, { cwd, env, maxBuffer: 16 * 1024 * 1024 })).stdout;
}
export async function discoverRepository(cwd: string): Promise<RepositoryContext> {
  const root = await realpath(resolve(cwd));
  try {
    const path = async (flag: string) => {
      const out = await gitOutput(root, ["rev-parse", "--path-format=absolute", flag]);
      return realpath(out.endsWith("\n") ? out.slice(0, -1) : out);
    };
    const worktreeRoot = await path("--show-toplevel");
    const commonGitDir = await path("--git-common-dir");
    return { worktreeRoot, commonGitDir, storeRoot: join(commonGitDir, "vinea"),
      workspaceId: createHash("sha256").update(worktreeRoot).digest("hex") };
  } catch {
    throw new KernelError("NOT_GIT_REPOSITORY", "A Git working tree is required; no repository was initialized");
  }
}
export function newActor(host: string, hostSessionId?: string): Actor {
  const actor: Actor = { instanceId: randomUUID(), host, ...(hostSessionId ? { hostSessionId } : {}) };
  actorRule(actor);
  return actor;
}
