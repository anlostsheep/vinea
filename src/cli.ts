import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverRepository } from "./kernel/repository.js";
import { KernelError } from "./kernel/errors.js";
import { safePath } from "./kernel/io.js";
import { executeCommand, executeReadCommand, type CommandEnvelope } from "./application.js";
import { commands } from "./cli/commands.js";

const reads = ["task show", "task list", "orient", "doctor", "validate", "legacy inspect", "snapshot show", "evidence show", "check show", "contribution show", "delivery show"];
const legacy = ["propose", "migrate", "learning", "task transition", "task unblock", "task require", "task accept", "task set-plan", "task set-brief", "task rework", "evidence record"];
const help = `Vinea: explicit local task collaboration\n\nvinea <command> --input - --json\nRead commands: --task <id> or --source <legacy-directory>\n\n${["session resolve", ...Object.keys(commands), ...reads].sort().join("\n")}\n\nResolve an instance once; reuse its echoed Actor. No automatic Git, migration, or agent dispatch.\n`;
export async function main(argv: string[], io = { stdin: process.stdin as NodeJS.ReadableStream, stdout: process.stdout as NodeJS.WritableStream, stderr: process.stderr as NodeJS.WritableStream }): Promise<number> {
  try {
    if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) { io.stdout.write(help); return 0; }
    if (legacy.some(c => argv.slice(0, c.split(" ").length).join(" ") === c)) throw new KernelError("LEGACY_COMMAND_REMOVED", "Legacy stage commands are read-only history; use legacy inspect/import explicitly");
    const parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
      input: { type: "string" }, json: { type: "boolean" }, task: { type: "string" }, source: { type: "string" }, id: { type: "string" },
      limit: { type: "string" }, after: { type: "string" },
    } });
    const command = parsed.positionals.join(" ");
    if (!reads.includes(command) && command !== "session resolve" && !Object.hasOwn(commands, command)) throw new KernelError("COMMAND_UNKNOWN", "Unknown command; use --help");
    const ctx = await discoverRepository(process.cwd());
    let result;
    if (reads.includes(command)) result = await executeReadCommand(ctx, command, { taskId: parsed.values.task, sourceRoot: parsed.values.source,
      resourceId: parsed.values.id, limit: parsed.values.limit === undefined ? undefined : Number(parsed.values.limit), after: parsed.values.after });
    else {
      if (!parsed.values.input) throw new KernelError("INPUT_REQUIRED", "Use --input - for the structured command envelope");
      let content = "";
      if (parsed.values.input === "-") {
        for await (const chunk of io.stdin) {
          content += chunk.toString();
          if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new KernelError("INPUT_TOO_LARGE", "Input exceeds 2 MiB");
        }
      } else content = await readFile(await safePath(ctx.worktreeRoot, resolve(ctx.worktreeRoot, parsed.values.input)), "utf8");
      if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new KernelError("INPUT_TOO_LARGE", "Input exceeds 2 MiB");
      let envelope: unknown;
      try { envelope = JSON.parse(content); } catch { throw new KernelError("INPUT_INVALID", "Input must be a JSON command envelope"); }
      result = await executeCommand(ctx, command, envelope as CommandEnvelope);
    }
    io.stdout.write(`${JSON.stringify(result, null, parsed.values.json ? undefined : 2)}\n`);
    return result.error || (command === "validate" && (result.data as { status: string }).status !== "ready") ? 1 : 0;
  } catch (error) {
    const known = error instanceof KernelError;
    io.stdout.write(`${JSON.stringify({ actor: null, workspaceId: null, operationId: null, data: null,
      error: { code: known ? error.code : "COMMAND_FAILED", message: known ? error.message : "Command failed; inspect current state before retrying", details: known ? error.details : {} } })}\n`);
    return 1;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
