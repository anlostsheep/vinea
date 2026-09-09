import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { assertPersistence, writeJson } from "./io.js";
import { decisionRule, environmentRule, array, text, nullable, one, id, integer } from "./schema.js";
import { assertContract, assertEntry, getTask } from "./policy.js";
import { readState, lookupOperation, mutateState } from "./store.js";
import { loadSnapshot, compareSnapshot } from "./snapshots.js";
import { appendEvidence } from "./evidence.js";
import { KernelError, requireThat } from "./errors.js";
import type { RepositoryContext, Meta, Id, Evidence, VerificationEnvironment, Decision } from "./types.js";

export async function runVerification(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; contractVersion: number; snapshotId: Id; argv: string[]; phase: Evidence["phase"];
  timeoutMs: number; environment: VerificationEnvironment; commandAuthorization: Decision;
}): Promise<Evidence> {
  assertPersistence(meta); decisionRule(input.commandAuthorization); environmentRule(input.environment); array(text)(input.argv);
  nullable(one("red", "green"))(input.phase); id(input.taskId); id(input.snapshotId); integer(input.contractVersion);
  requireThat(input.argv.length > 0 && Number.isSafeInteger(input.timeoutMs) && input.timeoutMs > 0 && input.timeoutMs <= 3600000, "COMMAND_REQUIRED", "Command and bounded timeout required");
  requireThat(!input.argv.some(a => /(?:Bearer\s+|(?:password|token|secret|api[_-]?key)=)/i.test(a))
    && !Object.keys(input.environment.labels).some(k => /password|token|secret|cookie|authorization|api.?key/i.test(k)), "SENSITIVE_INPUT", "Do not put credentials in recorded arguments or environment labels");
  requireThat(input.environment.runtime === process.version && input.environment.platform === process.platform, "VERIFICATION_CONDITIONS_MISMATCH", "Runtime describes the actual Node verifier; other runtimes belong in labels");
  const task = getTask(await readState(ctx), input.taskId);
  assertEntry(meta, task, "state-write"); assertContract(task, input.contractVersion);
  const request = { command: "verify.reserve", input, workspaceId: ctx.workspaceId };
  const existing = await lookupOperation(ctx, meta, request);
  if (existing) {
    const previous = Object.values((await readState(ctx)).tasks[input.taskId]!.evidence).find(e => e.artifactId === existing.resourceIds[0]);
    if (previous) return previous;
    throw new KernelError("VERIFICATION_INCOMPLETE", "The command was reserved or started; inspect its result before explicitly scheduling another attempt");
  }
  const snapshot = await loadSnapshot(ctx, input.snapshotId);
  requireThat((await compareSnapshot(ctx, snapshot)).matches, "SNAPSHOT_CHANGED", "Verification inputs have changed");
  let reserved = false;
  const reservation = await mutateState(ctx, meta, request, state => {
    const current = getTask(state, input.taskId); assertEntry(meta, current, "state-write"); assertContract(current, input.contractVersion);
    reserved = true; return [randomUUID()];
  });
  requireThat(reserved, "VERIFICATION_INCOMPLETE", "Another invocation owns this verification; the command was not repeated");
  const artifactId = reservation.resourceIds[0]!;
  const [command, ...args] = input.argv;
  const result = await new Promise<{ code: number | null; signal: string | null; timedOut: boolean; stdoutBytes: number; stderrBytes: number }>((resolve, reject) => {
    const child = spawn(command!, args, { cwd: ctx.worktreeRoot, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false, stdoutBytes = 0, stderrBytes = 0;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const stop = (signal: NodeJS.Signals) => {
      try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(signal); }
    };
    const timeout = setTimeout(() => { timedOut = true; stop("SIGTERM"); escalation = setTimeout(() => stop("SIGKILL"), 250); }, input.timeoutMs);
    child.stdout.on("data", (b: Buffer) => { stdoutBytes += b.length; });
    child.stderr.on("data", (b: Buffer) => { stderrBytes += b.length; });
    child.once("error", () => { clearTimeout(timeout); if (escalation) clearTimeout(escalation); reject(new KernelError("COMMAND_START_FAILED", "Verifier could not start")); });
    child.once("close", (code, signal) => { clearTimeout(timeout); if (escalation) clearTimeout(escalation); resolve({ code, signal, timedOut, stdoutBytes, stderrBytes }); });
  });
  const stillMatches = await compareSnapshot(ctx, snapshot).then(r => r.matches, () => false);
  assertContract(getTask(await readState(ctx), input.taskId), input.contractVersion);
  const status = result.timedOut || result.signal || result.code === null || !stillMatches ? "unverified" : result.code === 0 ? "pass" : "fail";
  // Do not persist arbitrary subprocess output: it can contain credentials.
  await writeJson(ctx, meta, `artifacts/${artifactId}/result.json`, { ...result, argv: input.argv, snapshotId: snapshot.id,
    environment: input.environment, rawOutputStored: false }, true);
  return appendEvidence(ctx, { ...meta, operationId: `evidence-${createHash("sha256").update(meta.operationId).digest("hex")}` }, { taskId: input.taskId, contractVersion: input.contractVersion, snapshotId: snapshot.id,
    result: status, phase: status === "unverified" ? null : input.phase, argv: input.argv, exitCode: result.code,
    environment: input.environment, summary: status === "unverified" ? "Command timed out, terminated, or input changed; not verified" : `Command exited ${result.code}` }, "command-runner", artifactId);
}
