export type ParsedOptions = ReadonlyMap<string, string | true>;

export class UsageError extends Error {
  readonly exitCode = 2 as const;
  readonly code = "VINEA_VALIDATION_INVALID" as const;

  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseOptions(
  args: string[],
  valueOptions: ReadonlySet<string>,
  booleanOptions: ReadonlySet<string>,
): ParsedOptions {
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
    if (value === undefined || value.startsWith("--")) {
      throw new UsageError(`Missing value for ${argument}.`);
    }
    parsed.set(argument, value);
    index += 1;
  }
  return parsed;
}

export function requiredOption(options: ParsedOptions, name: string): string {
  const value = options.get(name);
  if (typeof value !== "string" || value.trim() === "") {
    throw new UsageError(`Missing required option: ${name}.`);
  }
  return value;
}

export function optionalValue(options: ParsedOptions, name: string): string | undefined {
  const value = options.get(name);
  return typeof value === "string" ? value : undefined;
}

export function requiredTaskId(value: string | undefined): string {
  if (value === undefined || value.startsWith("--") || value.trim() === "") {
    throw new UsageError("Missing task ID.");
  }
  return value;
}

export function oneOf<const T extends readonly string[]>(
  value: string,
  allowed: T,
  option: string,
): T[number] {
  if (!allowed.includes(value)) {
    throw new UsageError(`Invalid ${option} value: ${value}. Expected ${allowed.join("|")}.`);
  }
  return value as T[number];
}

export function parseExitCode(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new UsageError(`Invalid --exit-code value: ${value}. Expected a non-negative integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new UsageError(`Invalid --exit-code value: ${value}. Expected a non-negative integer.`);
  }
  return parsed;
}

export function commaList(value: string, option: string): string[] {
  const values = value.split(",").map((item) => item.trim());
  if (values.some((item) => item === "")) {
    throw new UsageError(`${option} must be a comma-separated list of nonempty values.`);
  }
  return values;
}

export function requestsJson(args: readonly string[]): boolean {
  return args.includes("--json");
}
