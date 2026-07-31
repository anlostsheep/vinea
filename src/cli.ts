import packageJson from "../package.json" with { type: "json" };
import { initializeWorkspace, readConfig } from "./core/config.js";
import {
  addContextReference,
  listContextReferences,
  type ContextManifest,
} from "./core/context.js";
import { recordEvidence } from "./core/evidence.js";
import { VineaError } from "./core/errors.js";
import { resolveVineaPaths } from "./core/paths.js";
import { inspectWorkspace } from "./core/schema.js";
import {
  appendInlineAudit,
  addAcceptanceCriterion,
  addRequirement,
  createTask,
  incompleteRequirements,
  listTasks,
  nextGate,
  readTask,
  setTaskBrief,
  setTaskPlan,
  suggestRisk,
  transitionTask,
} from "./core/workflow.js";
import type {
  EvidenceRecord,
  ExecutionMode,
  QualityMode,
  RiskLevel,
  TaskRecord,
} from "./core/types.js";

const helpText = `Usage: vinea <command>

Commands:
  init
  orient
  propose
  continue
  check
  finish
  doctor
  validate
  task list
  task show
  task transition
  task unblock
  task require
  task accept
  task set-plan
  task set-brief
  context add
  context list
  evidence record
`;

class UsageError extends Error {
  readonly exitCode = 2;
  readonly code = "VINEA_VALIDATION_INVALID";
}

export async function main(args: string[]): Promise<number> {
  const command = args[0];
  const json = args.includes("--json");

  if (command === "--help" || command === "-h") {
    process.stdout.write(helpText);
    return 0;
  }

  if (command === "init") {
    try {
      await initializeWorkspace(resolveVineaPaths(process.cwd()));
      process.stdout.write("Initialized Vinea workspace.\n");
      return 0;
    } catch (error) {
      return reportError(error, false);
    }
  }

  if (command === "doctor") {
    const doctorArgs = args.slice(1);
    const json = doctorArgs.includes("--json");
    if (doctorArgs.some((argument) => argument !== "--json")) {
      if (json) {
        process.stdout.write(`${JSON.stringify({ error: { code: "VINEA_VALIDATION_INVALID", message: "Unknown doctor option." } })}\n`);
      } else {
        process.stderr.write(`Unknown doctor option: ${args[1]}\n`);
      }
      return 2;
    }
    const report = await inspectWorkspace(resolveVineaPaths(process.cwd()));
    if (json) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      process.stdout.write(renderDoctorReport(report));
    }
    return report.healthy ? 0 : 1;
  }

  if (command === "propose") {
    try {
      return await handlePropose(args.slice(1));
    } catch (error) {
      return reportError(error, json);
    }
  }

  if (command === "task") {
    try {
      return await handleTask(args.slice(1));
    } catch (error) {
      return reportError(error, json);
    }
  }

  if (command === "context") {
    try {
      return await handleContext(args.slice(1));
    } catch (error) {
      return reportError(error, json);
    }
  }

  if (command === "evidence") {
    try {
      return await handleEvidence(args.slice(1));
    } catch (error) {
      return reportError(error, json);
    }
  }

  if (command === "--version" || command === "-V") {
    process.stdout.write(`${packageJson.version}\n`);
    return 0;
  }

  const usageError = new UsageError(`Unknown command: ${command ?? "(none)"}`);
  process.stderr.write(`${usageError.message}\n`);
  return usageError.exitCode;
}

async function handlePropose(args: string[]): Promise<number> {
  const options = parseOptions(
    args,
    new Set(["--title", "--description", "--risk", "--quality", "--execution", "--inline-skip-reason"]),
    new Set(["--confirmed", "--json"]),
  );
  const title = requiredOption(options, "--title");
  const description = requiredOption(options, "--description");
  const requestedRisk = oneOf(requiredOption(options, "--risk"), ["auto", "low", "medium", "high"] as const, "--risk");
  const qualityMode = oneOf(requiredOption(options, "--quality"), ["standard", "tdd"] as const, "--quality");
  const executionMode = oneOf(
    requiredOption(options, "--execution"),
    ["single-agent", "delegated"] as const,
    "--execution",
  );
  const confirmed = options.has("--confirmed");
  const inlineSkipReason = optionalValue(options, "--inline-skip-reason");
  const json = options.has("--json");
  if (confirmed && inlineSkipReason !== undefined) {
    throw new UsageError("--confirmed cannot be combined with --inline-skip-reason.");
  }

  const paths = resolveVineaPaths(process.cwd());
  const config = await readConfig(paths);
  const suggested = suggestRisk(title, description, [], config.riskRules);
  const risk = {
    level: (requestedRisk === "auto" ? suggested.level : requestedRisk) as RiskLevel,
    reasons: suggested.reasons,
  };
  const proposal = { title: title.trim(), description: description.trim(), risk, qualityMode, executionMode };

  if (inlineSkipReason !== undefined) {
    const record = await appendInlineAudit(paths, {
      title,
      description,
      proposedRisk: risk,
      reason: inlineSkipReason,
    });
    writeOutput(record, json, renderInlineAudit(record));
    return 0;
  }

  if (confirmed) {
    const created = await createTask(paths, {
      title,
      risk,
      qualityMode,
      executionMode,
      confirmation: "user",
    });
    writeOutput(created.task, json, renderTask(created.task));
    return 0;
  }

  writeOutput(proposal, json, renderProposal(proposal));
  return 0;
}

async function handleTask(args: string[]): Promise<number> {
  const subcommand = args[0];
  const paths = resolveVineaPaths(process.cwd());

  if (subcommand === "list") {
    const options = parseOptions(args.slice(1), new Set(["--status"]), new Set(["--json"]));
    const status = oneOf(optionalValue(options, "--status") ?? "active", ["active", "all"] as const, "--status");
    const tasks = await listTasks(paths, status);
    const json = options.has("--json");
    writeOutput(tasks, json, tasks.length === 0 ? "No tasks.\n" : tasks.map(renderTask).join("\n"));
    return 0;
  }

  if (subcommand === "show") {
    const taskId = requiredTaskId(args[1]);
    const options = parseOptions(args.slice(2), new Set(), new Set(["--json"]));
    const task = await readTask(paths, taskId);
    writeOutput(task, options.has("--json"), renderTask(task));
    return 0;
  }

  if (subcommand === "transition" || subcommand === "unblock") {
    const taskId = requiredTaskId(args[1]);
    const options = parseOptions(args.slice(2), new Set(["--to", "--reason"]), new Set(["--json"]));
    const to = oneOf(
      requiredOption(options, "--to"),
      ["planning", "ready", "in_progress", "checking", "finished", "archived", "blocked"] as const,
      "--to",
    );
    if (subcommand === "unblock" && !["ready", "in_progress", "checking"].includes(to)) {
      throw new UsageError("unblock --to must be ready, in_progress, or checking.");
    }
    const task = await transitionTask(paths, taskId, to, {
      actor: "cli",
      reason: requiredOption(options, "--reason"),
      unblock: subcommand === "unblock",
    });
    writeOutput(task, options.has("--json"), renderTask(task));
    return 0;
  }

  if (subcommand === "require" || subcommand === "accept") {
    const taskId = requiredTaskId(args[1]);
    const options = parseOptions(args.slice(2), new Set(["--id", "--text"]), new Set(["--json"]));
    const input = {
      id: requiredOption(options, "--id"),
      text: requiredOption(options, "--text"),
      actor: "cli",
    };
    const task = subcommand === "require"
      ? await addRequirement(paths, taskId, input)
      : await addAcceptanceCriterion(paths, taskId, input);
    writeOutput(task, options.has("--json"), renderTask(task));
    return 0;
  }

  if (subcommand === "set-plan" || subcommand === "set-brief") {
    const taskId = requiredTaskId(args[1]);
    const options = parseOptions(args.slice(2), new Set(["--file"]), new Set(["--json"]));
    const result = subcommand === "set-plan"
      ? await setTaskPlan(paths, taskId, requiredOption(options, "--file"))
      : await setTaskBrief(paths, taskId, requiredOption(options, "--file"));
    writeOutput(
      result,
      options.has("--json"),
      `Updated ${result.artifact} for ${result.taskId} (${result.estimatedBytes} bytes).\n`,
    );
    return 0;
  }

  throw new UsageError(`Unknown task command: ${subcommand ?? "(none)"}`);
}

async function handleContext(args: string[]): Promise<number> {
  const subcommand = args[0];
  const taskId = requiredTaskId(args[1]);
  const paths = resolveVineaPaths(process.cwd());
  if (subcommand === "add") {
    const options = parseOptions(args.slice(2), new Set(["--path", "--purpose"]), new Set(["--json"]));
    const reference = await addContextReference(paths, taskId, {
      path: requiredOption(options, "--path"),
      purpose: requiredOption(options, "--purpose"),
    });
    writeOutput(
      reference,
      options.has("--json"),
      `Added context ${reference.path} (${reference.estimatedBytes} bytes).\n`,
    );
    return 0;
  }
  if (subcommand === "list") {
    const options = parseOptions(args.slice(2), new Set(), new Set(["--json"]));
    const manifest = await listContextReferences(paths, taskId);
    writeOutput(manifest, options.has("--json"), renderContextManifest(manifest));
    return 0;
  }
  throw new UsageError(`Unknown context command: ${subcommand ?? "(none)"}`);
}

async function handleEvidence(args: string[]): Promise<number> {
  const subcommand = args[0];
  if (subcommand !== "record") {
    throw new UsageError(`Unknown evidence command: ${subcommand ?? "(none)"}`);
  }
  const taskId = requiredTaskId(args[1]);
  const options = parseOptions(
    args.slice(2),
    new Set(["--kind", "--summary", "--command", "--exit-code", "--result"]),
    new Set(["--json"]),
  );
  const kind = oneOf(
    requiredOption(options, "--kind"),
    ["command", "manual", "tdd-red", "tdd-green"] as const,
    "--kind",
  );
  const resultValue = optionalValue(options, "--result");
  const result = resultValue === undefined
    ? undefined
    : oneOf(resultValue, ["pass", "fail"] as const, "--result");
  const exitCodeValue = optionalValue(options, "--exit-code");
  const exitCode = exitCodeValue === undefined ? undefined : parseExitCode(exitCodeValue);
  const evidence = await recordEvidence(resolveVineaPaths(process.cwd()), taskId, {
    kind,
    summary: requiredOption(options, "--summary"),
    command: optionalValue(options, "--command"),
    exitCode,
    result,
    actor: "cli",
  });
  writeOutput(evidence, options.has("--json"), renderEvidence(evidence));
  return 0;
}

function reportError(error: unknown, json: boolean): number {
  const code = error instanceof VineaError || error instanceof UsageError
    ? error.code
    : "VINEA_SCHEMA_INVALID";
  const message = error instanceof Error ? error.message : "Unknown failure";
  if (json) {
    process.stdout.write(`${JSON.stringify({ error: { code, message } })}\n`);
  } else if (error instanceof VineaError) {
    process.stderr.write(`${error.code}: ${error.message}\n`);
  } else {
    process.stderr.write(`${code}: ${message}\n`);
  }
  if (error instanceof UsageError) return error.exitCode;
  if (error instanceof VineaError) {
    return 1;
  }
  return 1;
}

function parseOptions(
  args: string[],
  valueOptions: ReadonlySet<string>,
  booleanOptions: ReadonlySet<string>,
): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (parsed.has(argument)) throw new UsageError(`Duplicate option: ${argument}`);
    if (booleanOptions.has(argument)) {
      parsed.set(argument, true);
      continue;
    }
    if (!valueOptions.has(argument)) throw new UsageError(`Unknown option: ${argument}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`Missing value for ${argument}.`);
    parsed.set(argument, value);
    index += 1;
  }
  return parsed;
}

function requiredOption(options: ReadonlyMap<string, string | true>, name: string): string {
  const value = options.get(name);
  if (typeof value !== "string" || value.trim() === "") throw new UsageError(`Missing required option: ${name}.`);
  return value;
}

function optionalValue(options: ReadonlyMap<string, string | true>, name: string): string | undefined {
  const value = options.get(name);
  return typeof value === "string" ? value : undefined;
}

function requiredTaskId(value: string | undefined): string {
  if (value === undefined || value.startsWith("--") || value.trim() === "") {
    throw new UsageError("Missing task ID.");
  }
  return value;
}

function oneOf<const T extends readonly string[]>(value: string, allowed: T, option: string): T[number] {
  if (!allowed.includes(value)) {
    throw new UsageError(`Invalid ${option} value: ${value}. Expected ${allowed.join("|")}.`);
  }
  return value as T[number];
}

function parseExitCode(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new UsageError(`Invalid --exit-code value: ${value}. Expected a non-negative integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new UsageError(`Invalid --exit-code value: ${value}. Expected a non-negative integer.`);
  }
  return parsed;
}

function writeOutput(value: unknown, json: boolean, human: string): void {
  process.stdout.write(json ? `${JSON.stringify(value)}\n` : human);
}

function renderProposal(proposal: {
  title: string;
  description: string;
  risk: { level: RiskLevel; reasons: string[] };
  qualityMode: QualityMode;
  executionMode: ExecutionMode;
}): string {
  return [
    `title: ${proposal.title}`,
    `description: ${proposal.description}`,
    `risk: ${proposal.risk.level}`,
    `risk reasons: ${proposal.risk.reasons.length ? proposal.risk.reasons.join(", ") : "none"}`,
    `quality mode: ${proposal.qualityMode}`,
    `execution mode: ${proposal.executionMode}`,
    "confirmation required",
    "",
  ].join("\n");
}

function renderInlineAudit(record: { timestamp: string; requestSummary: string; reason: string }): string {
  return [
    "Inline skip recorded.",
    `timestamp: ${record.timestamp}`,
    `request: ${record.requestSummary}`,
    `reason: ${record.reason}`,
    "",
  ].join("\n");
}

function renderTask(task: TaskRecord): string {
  const incomplete = incompleteRequirements(task);
  return [
    `task ID: ${task.id}`,
    `status: ${task.status}`,
    `quality mode: ${task.qualityMode}`,
    `execution mode: ${task.executionMode}`,
    `risk: ${task.risk.level}`,
    `risk reasons: ${task.risk.reasons.length ? task.risk.reasons.join(", ") : "none"}`,
    `incomplete requirements: ${incomplete.length ? incomplete.join(", ") : "none"}`,
    `next gate: ${nextGate(task)}`,
    "",
  ].join("\n");
}

function renderContextManifest(manifest: ContextManifest): string {
  if (manifest.references.length === 0) {
    return `No context references. Budget: 0/${manifest.limits.maxFiles} files, 0/${manifest.limits.maxEstimatedBytes} bytes.\n`;
  }
  return [
    ...manifest.references.map(
      (reference) => `${reference.path} (${reference.estimatedBytes} bytes): ${reference.purpose}`,
    ),
    `Budget: ${manifest.totals.files}/${manifest.limits.maxFiles} files, ${manifest.totals.estimatedBytes}/${manifest.limits.maxEstimatedBytes} bytes.`,
    "",
  ].join("\n");
}

function renderEvidence(evidence: EvidenceRecord): string {
  return [
    `Evidence: ${evidence.id}`,
    `kind: ${evidence.kind}`,
    `result: ${evidence.result}`,
    `summary: ${evidence.summary}`,
    "",
  ].join("\n");
}

function renderDoctorReport(report: Awaited<ReturnType<typeof inspectWorkspace>>): string {
  const lines = [
    `initialized: ${report.initialized}`,
    `config schema: ${report.configSchemaVersion ?? "missing"}`,
    `supported schema: ${report.supportedSchema}`,
    `missing directories: ${report.missingRequiredDirectories.length ? report.missingRequiredDirectories.join(", ") : "none"}`,
    `healthy: ${report.healthy}`,
  ];
  if (report.migrationGuidance) lines.push(`guidance: ${report.migrationGuidance}`);
  return `${lines.join("\n")}\n`;
}

void main(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
