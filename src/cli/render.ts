import type { CheckSummary } from "../core/check.js";
import type { ContextManifest } from "../core/context.js";
import type { DoctorReport } from "../core/doctor.js";
import { VineaError } from "../core/errors.js";
import type { ValidationReport } from "../core/validate.js";
import { incompleteRequirements, nextGate } from "../core/workflow.js";
import type {
  EvidenceRecord,
  CheckRow,
  ExecutionMode,
  OrientSummary,
  QualityMode,
  RiskLevel,
  TaskRecord,
} from "../core/types.js";
import { UsageError } from "./args.js";

export const helpText = `Usage: vinea <command>

Commands:
  init
  orient
  propose
  continue
  check
  check show
  finish
  archive
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
  learning propose
  learning accept
  learning archive
`;

export interface Proposal {
  title: string;
  description: string;
  risk: { level: RiskLevel; reasons: string[] };
  qualityMode: QualityMode;
  executionMode: ExecutionMode;
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

interface NormalizedError {
  code: string;
  message: string;
  details?: unknown;
  exitCode: 1 | 2;
}

export function writeOutput(value: unknown, json: boolean, human: string): void {
  process.stdout.write(json ? `${JSON.stringify(value)}\n` : human);
}

export function reportError(error: unknown, json: boolean): number {
  const normalized = normalizeError(error);
  if (json) {
    const envelope: ErrorEnvelope = {
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details === undefined ? {} : { details: normalized.details }),
      },
    };
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
  } else {
    process.stderr.write(`${normalized.code}: ${normalized.message}\n`);
  }
  return normalized.exitCode;
}

export function renderProposal(proposal: Proposal): string {
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

export function renderInlineAudit(record: {
  timestamp: string;
  requestSummary: string;
  reason: string;
}): string {
  return [
    "Inline skip recorded.",
    `timestamp: ${record.timestamp}`,
    `request: ${record.requestSummary}`,
    `reason: ${record.reason}`,
    "",
  ].join("\n");
}

export function renderTask(task: TaskRecord, checkRows: CheckRow[] = []): string {
  const incomplete = incompleteRequirements(task, checkRows);
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

export function renderContextManifest(manifest: ContextManifest): string {
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

export function renderEvidence(evidence: EvidenceRecord): string {
  return [
    `Evidence: ${evidence.id}`,
    `kind: ${evidence.kind}`,
    `result: ${evidence.result}`,
    `summary: ${evidence.summary}`,
    "",
  ].join("\n");
}

export function renderCheckSummary(summary: CheckSummary): string {
  const lines = summary.rows.map((row) =>
    `${row.requirementId}: ${row.result}; paths: ${row.paths.join(", ")}; evidence: ${row.evidenceIds.join(", ") || "none"}; ${row.summary}`
  );
  lines.push(
    `Totals: ${summary.totals.total} rows; ${summary.totals.pass} pass; ${summary.totals.fail} fail; ${summary.totals.uncovered} uncovered.`,
    "",
  );
  return lines.join("\n");
}

export function renderOrient(summary: OrientSummary): string {
  const lines = [
    `workspace healthy: ${summary.health.healthy}`,
    `git available: ${summary.gitStatus.available}`,
    `git status: ${summary.gitStatus.porcelain === "" ? "clean" : summary.gitStatus.porcelain.trimEnd()}`,
    `binding: ${summary.binding === null ? "none" : summary.binding.status}`,
    `recommendation: ${summary.recommendation}`,
  ];
  for (const candidate of summary.candidates) {
    lines.push(
      `${candidate.id}: ${candidate.title} [${candidate.status}; ${candidate.qualityMode}; ${candidate.executionMode}]`,
      `  requirements not covered: ${candidate.requirementsNotCovered.length ? candidate.requirementsNotCovered.join(", ") : "none"}`,
      `  context references: ${candidate.contextReferences.length ? candidate.contextReferences.map(({ path }) => path).join(", ") : "none"}`,
      `  latest evidence: ${candidate.latestEvidence?.id ?? "none"}`,
      `  latest check event: ${String(candidate.latestCheckEvent?.type ?? "none")}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderDoctorReport(report: DoctorReport): string {
  const lines = [
    `initialized: ${report.initialized}`,
    `config schema: ${report.configSchemaVersion ?? "missing"}`,
    `supported schema: ${report.supportedSchema}`,
    `missing directories: ${report.missingRequiredDirectories.length ? report.missingRequiredDirectories.join(", ") : "none"}`,
    `git available: ${report.gitStatus.available}`,
    `healthy: ${report.healthy}`,
  ];
  if (report.migrationGuidance) lines.push(`guidance: ${report.migrationGuidance}`);
  if (report.gitStatus.error) lines.push(`git guidance: ${report.gitStatus.error}`);
  return `${lines.join("\n")}\n`;
}

export function renderValidationReport(report: ValidationReport): string {
  if (report.issues.length === 0) return "Vinea state is valid.\n";
  return `${report.issues.map(
    (issue) => `[${issue.code}] ${issue.path}: ${issue.message}`,
  ).join("\n")}\n`;
}

function normalizeError(error: unknown): NormalizedError {
  if (error instanceof UsageError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      exitCode: error.exitCode,
    };
  }
  if (error instanceof VineaError) {
    return { code: error.code, message: error.message, exitCode: 1 };
  }
  return {
    code: "VINEA_SCHEMA_INVALID",
    message: "Unexpected Vinea failure.",
    exitCode: 1,
  };
}
