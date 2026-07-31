export const SCHEMA_VERSION = 1 as const;

export type IsoTimestamp = string;
export type Host = "codex" | "claude";
export type TaskStatus =
  | "planning"
  | "ready"
  | "in_progress"
  | "checking"
  | "finished"
  | "archived"
  | "blocked";
export type RiskLevel = "low" | "medium" | "high";
export type QualityMode = "standard" | "tdd";
export type ExecutionMode = "single-agent" | "delegated";

export interface VineaConfig {
  schemaVersion: typeof SCHEMA_VERSION;
  riskRules: {
    medium: string[];
    high: string[];
  };
  context: {
    maxFiles: number;
    maxEstimatedBytes: number;
  };
}

export interface Requirement {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  text: string;
  createdAt: IsoTimestamp;
}

export interface CommitMetadata {
  sha: string;
  message?: string;
}

export interface TaskRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  status: TaskStatus;
  risk: { level: RiskLevel; reasons: string[] };
  qualityMode: QualityMode;
  executionMode: ExecutionMode;
  requirements: Requirement[];
  acceptanceCriteria: Requirement[];
  commit: CommitMetadata | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface RiskSuggestion {
  level: RiskLevel;
  reasons: string[];
}

export interface JournalCreationEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  type: "created";
  timestamp: IsoTimestamp;
  actor: string;
  confirmation: "user";
  status: "planning";
}

export interface JournalTransitionEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  type: "transition";
  timestamp: IsoTimestamp;
  actor: string;
  reason: string;
  oldStatus: TaskStatus;
  newStatus: TaskStatus;
}

export type JournalEvent = JournalCreationEvent | JournalTransitionEvent;

export interface InlineAuditRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  timestamp: IsoTimestamp;
  requestSummary: string;
  proposedRisk: RiskSuggestion;
  reason: string;
}

export interface ContextReference {
  schemaVersion: typeof SCHEMA_VERSION;
  path: string;
  purpose: string;
  estimatedBytes: number;
  addedAt: IsoTimestamp;
}

export interface EvidenceRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  kind: "command" | "manual" | "tdd-red" | "tdd-green";
  summary: string;
  result: "pass" | "fail";
  recordedAt: IsoTimestamp;
  command?: string;
  exitCode?: number;
  actor?: string;
}

export interface CheckRow {
  schemaVersion: typeof SCHEMA_VERSION;
  requirementId: string;
  planItem: string;
  paths: string[];
  evidenceIds: string[];
  result: "pass" | "fail" | "uncovered";
  summary: string;
  checkedAt: IsoTimestamp;
}

export interface LearningCandidate {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  domain: string;
  text: string;
  rationale: string;
  status: "proposed" | "accepted" | "archived";
  proposedAt: IsoTimestamp;
  acceptedAt?: IsoTimestamp;
  confirmedBy?: "user";
  archivedAt?: IsoTimestamp;
  archiveReason?: string;
}
