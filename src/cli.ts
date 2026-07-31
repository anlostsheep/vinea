import packageJson from "../package.json" with { type: "json" };

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

export function main(args: string[]): number {
  const command = args[0];

  if (command === "--help" || command === "-h") {
    process.stdout.write(helpText);
    return 0;
  }

  if (command === "--version" || command === "-V") {
    process.stdout.write(`${packageJson.version}\n`);
    return 0;
  }

  const usageError = new UsageError(`Unknown command: ${command ?? "(none)"}`);
  process.stderr.write(`${usageError.message}\n`);
  return usageError.exitCode;
}

process.exitCode = main(process.argv.slice(2));
