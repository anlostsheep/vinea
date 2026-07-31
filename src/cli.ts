import packageJson from "../package.json" with { type: "json" };
import {
  commaList,
  oneOf,
  optionalValue,
  parseExitCode,
  parseOptions,
  requestsJson,
  requiredOption,
  requiredTaskId,
  UsageError,
} from "./cli/args.js";
import {
  helpText,
  renderCheckSummary,
  renderContextManifest,
  renderDoctorReport,
  renderEvidence,
  renderInlineAudit,
  renderOrient,
  renderProposal,
  renderTask,
  renderValidationReport,
  reportError,
  writeOutput,
} from "./cli/render.js";
import { initializeWorkspace, readConfig } from "./core/config.js";
import {
  showCheck,
  upsertCheck,
} from "./core/check.js";
import {
  addContextReference,
  listContextReferences,
} from "./core/context.js";
import { recordEvidence } from "./core/evidence.js";
import { diagnoseWorkspace } from "./core/doctor.js";
import {
  acceptLearning,
  archiveLearning,
  proposeLearning,
} from "./core/learning.js";
import { resolveVineaPaths } from "./core/paths.js";
import { validateWorkspace } from "./core/validate.js";
import {
  appendInlineAudit,
  addAcceptanceCriterion,
  addRequirement,
  archiveTask,
  createTask,
  finishTask,
  listTasks,
  orientWorkspace,
  readTask,
  continueTask,
  setTaskBrief,
  setTaskPlan,
  suggestRisk,
  transitionTask,
} from "./core/workflow.js";
import type {
  RiskLevel,
} from "./core/types.js";

export async function main(args: string[]): Promise<number> {
  const json = requestsJson(args);
  try {
    const command = args[0];

    if (command === "--help" || command === "-h") {
      parseOptions(args.slice(1), new Set(), new Set());
      process.stdout.write(helpText);
      return 0;
    }

    if (command === "--version" || command === "-V") {
      parseOptions(args.slice(1), new Set(), new Set());
      process.stdout.write(`${packageJson.version}\n`);
      return 0;
    }

    if (command === "init") {
      const options = parseOptions(args.slice(1), new Set(), new Set(["--json"]));
      await initializeWorkspace(resolveVineaPaths(process.cwd()));
      writeOutput({ initialized: true }, options.has("--json"), "Initialized Vinea workspace.\n");
      return 0;
    }

    if (command === "doctor") {
      const options = parseOptions(args.slice(1), new Set(), new Set(["--json"]));
      const report = await diagnoseWorkspace(resolveVineaPaths(process.cwd()));
      writeOutput(report, options.has("--json"), renderDoctorReport(report));
      return report.healthy ? 0 : 1;
    }

    if (command === "validate") {
      const options = parseOptions(args.slice(1), new Set(), new Set(["--json"]));
      const report = await validateWorkspace(resolveVineaPaths(process.cwd()));
      writeOutput(report, options.has("--json"), renderValidationReport(report));
      return report.issues.length === 0 ? 0 : 1;
    }

    if (command === "propose") {
      return await handlePropose(args.slice(1));
    }

    if (command === "orient") {
      return await handleOrient(args.slice(1));
    }

    if (command === "continue") {
      return await handleContinue(args.slice(1));
    }

    if (command === "task") {
      return await handleTask(args.slice(1));
    }

    if (command === "context") {
      return await handleContext(args.slice(1));
    }

    if (command === "evidence") {
      return await handleEvidence(args.slice(1));
    }

    if (command === "learning") {
      return await handleLearning(args.slice(1));
    }

    if (command === "check") {
      return await handleCheck(args.slice(1));
    }

    if (command === "finish") {
      return await handleFinish(args.slice(1));
    }

    if (command === "archive") {
      return await handleArchive(args.slice(1));
    }

    throw new UsageError(`Unknown command: ${command ?? "(none)"}`);
  } catch (error) {
    return reportError(error, json);
  }
}

async function handleOrient(args: string[]): Promise<number> {
  const options = parseOptions(
    args,
    new Set(["--host", "--session-id"]),
    new Set(["--json"]),
  );
  const host = oneOf(requiredOption(options, "--host"), ["codex", "claude"] as const, "--host");
  const summary = await orientWorkspace(resolveVineaPaths(process.cwd()), {
    host,
    sessionId: optionalValue(options, "--session-id"),
  });
  writeOutput(summary, options.has("--json"), renderOrient(summary));
  return summary.health.initialized && summary.health.supportedSchema ? 0 : 1;
}

async function handleContinue(args: string[]): Promise<number> {
  const taskId = requiredTaskId(args[0]);
  const options = parseOptions(
    args.slice(1),
    new Set(["--host", "--session-id", "--reason"]),
    new Set(["--confirmed", "--start", "--json"]),
  );
  if (!options.has("--confirmed")) {
    throw new UsageError("Continuation requires explicit --confirmed.");
  }
  const start = options.has("--start");
  const reason = optionalValue(options, "--reason");
  if (start && reason === undefined) {
    throw new UsageError("--start requires --reason.");
  }
  if (!start && reason !== undefined) {
    throw new UsageError("--reason requires --start.");
  }
  const host = oneOf(requiredOption(options, "--host"), ["codex", "claude"] as const, "--host");
  const result = await continueTask(resolveVineaPaths(process.cwd()), taskId, {
    host,
    sessionId: optionalValue(options, "--session-id"),
    confirmed: true,
    start,
    reason,
  });
  writeOutput(
    result,
    options.has("--json"),
    `Continued ${result.task.id} on ${host}; status: ${result.task.status}; binding: ${result.binding === null ? "none" : "saved"}.\n`,
  );
  return 0;
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
    if (to === "finished" || to === "archived") {
      throw new UsageError(`Use the confirmed ${to === "finished" ? "finish" : "archive"} command for ${to} transitions.`);
    }
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
      ? await setTaskPlan(paths, taskId, requiredOption(options, "--file"), "cli")
      : await setTaskBrief(paths, taskId, requiredOption(options, "--file"), "cli");
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
      actor: "cli",
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

async function handleLearning(args: string[]): Promise<number> {
  const subcommand = args[0];
  const taskId = requiredTaskId(args[1]);
  const paths = resolveVineaPaths(process.cwd());
  if (subcommand === "propose") {
    const options = parseOptions(
      args.slice(2),
      new Set(["--id", "--domain", "--text", "--rationale"]),
      new Set(["--json"]),
    );
    const task = await proposeLearning(paths, taskId, {
      id: requiredOption(options, "--id"),
      domain: requiredOption(options, "--domain"),
      text: requiredOption(options, "--text"),
      rationale: requiredOption(options, "--rationale"),
      actor: "cli",
    });
    writeOutput(task, options.has("--json"), renderTask(task));
    return 0;
  }
  if (subcommand === "accept") {
    const options = parseOptions(
      args.slice(2),
      new Set(["--id", "--confirmed-by"]),
      new Set(["--json"]),
    );
    const confirmedBy = oneOf(
      requiredOption(options, "--confirmed-by"),
      ["user"] as const,
      "--confirmed-by",
    );
    const task = await acceptLearning(paths, taskId, {
      id: requiredOption(options, "--id"),
      confirmedBy,
      actor: "cli",
    });
    writeOutput(task, options.has("--json"), renderTask(task));
    return 0;
  }
  if (subcommand === "archive") {
    const options = parseOptions(
      args.slice(2),
      new Set(["--id", "--reason"]),
      new Set(["--json"]),
    );
    const task = await archiveLearning(paths, taskId, {
      id: requiredOption(options, "--id"),
      reason: requiredOption(options, "--reason"),
      actor: "cli",
    });
    writeOutput(task, options.has("--json"), renderTask(task));
    return 0;
  }
  throw new UsageError(`Unknown learning command: ${subcommand ?? "(none)"}`);
}

async function handleCheck(args: string[]): Promise<number> {
  const paths = resolveVineaPaths(process.cwd());
  if (args[0] === "show") {
    const taskId = requiredTaskId(args[1]);
    const options = parseOptions(args.slice(2), new Set(), new Set(["--json"]));
    const summary = await showCheck(paths, taskId);
    writeOutput(summary, options.has("--json"), renderCheckSummary(summary));
    return 0;
  }

  const taskId = requiredTaskId(args[0]);
  const options = parseOptions(
    args.slice(1),
    new Set(["--requirement", "--plan-item", "--paths", "--evidence", "--result", "--summary"]),
    new Set(["--json"]),
  );
  const evidence = optionalValue(options, "--evidence");
  const summary = await upsertCheck(paths, taskId, {
    requirementId: requiredOption(options, "--requirement"),
    planItem: requiredOption(options, "--plan-item"),
    paths: commaList(requiredOption(options, "--paths"), "--paths"),
    evidenceIds: evidence === undefined ? [] : commaList(evidence, "--evidence"),
    result: oneOf(
      requiredOption(options, "--result"),
      ["pass", "fail", "uncovered"] as const,
      "--result",
    ),
    summary: requiredOption(options, "--summary"),
    actor: "cli",
  });
  writeOutput(summary, options.has("--json"), renderCheckSummary(summary));
  return 0;
}

async function handleFinish(args: string[]): Promise<number> {
  const taskId = requiredTaskId(args[0]);
  const options = parseOptions(args.slice(1), new Set(), new Set(["--confirmed", "--json"]));
  if (!options.has("--confirmed")) throw new UsageError("Finish requires explicit --confirmed.");
  const task = await finishTask(resolveVineaPaths(process.cwd()), taskId, {
    confirmed: true,
    actor: "cli",
  });
  writeOutput(task, options.has("--json"), renderTask(task));
  return 0;
}

async function handleArchive(args: string[]): Promise<number> {
  const taskId = requiredTaskId(args[0]);
  const options = parseOptions(args.slice(1), new Set(), new Set(["--confirmed", "--json"]));
  if (!options.has("--confirmed")) throw new UsageError("Archive requires explicit --confirmed.");
  const task = await archiveTask(resolveVineaPaths(process.cwd()), taskId, {
    confirmed: true,
    actor: "cli",
  });
  writeOutput(task, options.has("--json"), renderTask(task));
  return 0;
}

void main(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
