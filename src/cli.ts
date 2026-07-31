import packageJson from "../package.json" with { type: "json" };
import { initializeWorkspace } from "./core/config.js";
import { VineaError } from "./core/errors.js";
import { resolveVineaPaths } from "./core/paths.js";
import { inspectWorkspace } from "./core/schema.js";

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
`;

class UsageError extends Error {
  readonly exitCode = 2;
}

export async function main(args: string[]): Promise<number> {
  const command = args[0];

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
      return reportError(error);
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

  if (command === "--version" || command === "-V") {
    process.stdout.write(`${packageJson.version}\n`);
    return 0;
  }

  const usageError = new UsageError(`Unknown command: ${command ?? "(none)"}`);
  process.stderr.write(`${usageError.message}\n`);
  return usageError.exitCode;
}

function reportError(error: unknown): number {
  if (error instanceof VineaError) {
    process.stderr.write(`${error.code}: ${error.message}\n`);
  } else {
    process.stderr.write(`VINEA_SCHEMA_INVALID: ${error instanceof Error ? error.message : "Unknown failure"}\n`);
  }
  return 1;
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
