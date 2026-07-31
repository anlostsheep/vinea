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
  learningCandidates?: LearningCandidate[];
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

export interface JournalTransitionDetails {
  schemaVersion: typeof SCHEMA_VERSION;
  timestamp: IsoTimestamp;
  actor: string;
  reason: string;
  oldStatus: TaskStatus;
  newStatus: TaskStatus;
}

export interface JournalTransitionIntentEvent extends JournalTransitionDetails {
  type: "transition_intent";
  operationId: string;
}

export interface JournalContinuationEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  type: "continued";
  timestamp: IsoTimestamp;
  actor: string;
  confirmation: "user";
  host: Host;
  sessionBound: boolean;
  started: boolean;
  status: TaskStatus;
}

export type TaskMutationKind =
  | "requirement_added"
  | "acceptance_criterion_added"
  | "brief_set"
  | "plan_set"
  | "context_added"
  | "evidence_recorded"
  | "learning_proposed"
  | "learning_accepted"
  | "learning_archived";

export interface TaskMutationJournalEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  type: TaskMutationKind;
  mutationKind: TaskMutationKind;
  operationId: string;
  timestamp: IsoTimestamp;
  actor: string;
  requirementId?: string;
  artifact?: "brief.md" | "plan.md";
  path?: string;
  evidenceId?: string;
  evidenceKind?: EvidenceRecord["kind"];
  learningCandidateId?: string;
  confirmedBy?: "user";
}

export type JournalEvent =
  | JournalCreationEvent
  | JournalTransitionIntentEvent
  | JournalContinuationEvent
  | TaskMutationJournalEvent;

export interface SessionBinding {
  schemaVersion: typeof SCHEMA_VERSION;
  taskId: string;
  boundAt: IsoTimestamp;
}

export type OrientBinding =
  | {
      status: "bound" | "stale";
      taskId: string;
      boundAt: IsoTimestamp;
    }
  | {
      status: "malformed";
      message: string;
    };

export interface GitStatusSummary {
  available: boolean;
  porcelain: string;
  error: string | null;
}

export interface RepositoryHealthSummary {
  initialized: boolean;
  configSchemaVersion: number | null;
  missingRequiredDirectories: string[];
  supportedSchema: boolean;
  migrationGuidance: string | null;
  healthy: boolean;
}

export interface OrientCandidate {
  id: string;
  title: string;
  status: TaskStatus;
  qualityMode: QualityMode;
  executionMode: ExecutionMode;
  requirementsNotCovered: string[];
  contextReferences: ContextReference[];
  latestEvidence: EvidenceRecord | null;
  latestCheckEvent: Record<string, unknown> | null;
}

export type OrientRecommendation =
  | "resume-bound"
  | "confirm-single"
  | "choose-task"
  | "no-active-task";

export interface OrientSummary {
  health: RepositoryHealthSummary;
  gitStatus: GitStatusSummary;
  binding: OrientBinding | null;
  candidates: OrientCandidate[];
  recommendation: OrientRecommendation;
}

export interface ContinuationResult {
  task: TaskRecord;
  binding: SessionBinding | null;
}

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
  actor: string;
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
