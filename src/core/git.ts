import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface BusinessGitStatus {
  gitUnavailable: boolean;
  businessDirtyPaths: string[];
  error: string | null;
}

export async function inspectBusinessGitStatus(repoRoot: string): Promise<BusinessGitStatus> {
  let porcelain: string;
  try {
    const topLevel = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (resolve(topLevel.stdout.trim()) !== resolve(repoRoot)) {
      return {
        gitUnavailable: true,
        businessDirtyPaths: [],
        error: "Vinea repository root is nested below a different Git worktree root.",
      };
    }
    const result = await execFileAsync("git", ["status", "--porcelain=v1", "-z"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    porcelain = result.stdout;
  } catch (error) {
    return {
      gitUnavailable: true,
      businessDirtyPaths: [],
      error: error instanceof Error ? error.message : "Unable to run git status --porcelain=v1 -z.",
    };
  }

  return {
    gitUnavailable: false,
    businessDirtyPaths: parsePorcelainPaths(porcelain).filter((path) => !isVineaPath(path)),
    error: null,
  };
}

export function parsePorcelainPaths(porcelain: string): string[] {
  const records = porcelain.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record === "") continue;
    if (record.length < 4 || record[2] !== " ") {
      throw new Error("Malformed git status --porcelain=v1 -z output.");
    }
    const status = record.slice(0, 2);
    paths.push(record.slice(3));
    if (status.includes("R") || status.includes("C")) {
      const originalPath = records[index + 1];
      if (originalPath === undefined || originalPath === "") {
        throw new Error("Malformed renamed path in git status --porcelain=v1 -z output.");
      }
      paths.push(originalPath);
      index += 1;
    }
  }
  return [...new Set(paths)];
}

function isVineaPath(path: string): boolean {
  return path === ".vinea" || path.startsWith(".vinea/");
}
