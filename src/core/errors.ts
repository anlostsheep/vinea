export type VineaErrorCode =
  | "VINEA_NOT_INITIALIZED"
  | "VINEA_SCHEMA_INVALID"
  | "VINEA_VALIDATION_INVALID"
  | "VINEA_TASK_AMBIGUOUS"
  | "VINEA_TRANSITION_INVALID"
  | "VINEA_FINISH_GATE_FAILED";

export class VineaError extends Error {
  constructor(
    readonly code: VineaErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "VineaError";
  }
}

export class NotInitializedError extends VineaError {
  constructor(message = "Vinea is not initialized in this repository.") {
    super("VINEA_NOT_INITIALIZED", message);
    this.name = "NotInitializedError";
  }
}

export class SchemaError extends VineaError {
  constructor(message: string, cause?: unknown) {
    super("VINEA_SCHEMA_INVALID", message, cause);
    this.name = "SchemaError";
  }
}

export class ValidationError extends VineaError {
  constructor(message: string, cause?: unknown) {
    super("VINEA_VALIDATION_INVALID", message, cause);
    this.name = "ValidationError";
  }
}

export class AmbiguousTaskError extends VineaError {
  constructor(message: string) {
    super("VINEA_TASK_AMBIGUOUS", message);
    this.name = "AmbiguousTaskError";
  }
}

export class TransitionError extends VineaError {
  constructor(message: string) {
    super("VINEA_TRANSITION_INVALID", message);
    this.name = "TransitionError";
  }
}

export class FinishGateError extends VineaError {
  constructor(message: string) {
    super("VINEA_FINISH_GATE_FAILED", message);
    this.name = "FinishGateError";
  }
}
