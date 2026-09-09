export class KernelError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "KernelError";
  }
}
export function requireThat(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new KernelError(code, message);
}
