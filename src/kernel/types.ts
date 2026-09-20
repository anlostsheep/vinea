export type Id = string;
export type Entry = "run" | "brainstorm" | "plan" | "continue" | "check"
  | "debug" | "finish" | "orient" | "doctor";
export interface Actor { instanceId: Id; host: string; hostSessionId?: string }
export interface ActorSelector {
  host: string; instanceId?: Id; hostSessionId?: string; newInstance?: boolean;
}
export interface Decision { summary: string; reference: string | null }
export interface ExecutionRequest {
  kind: "implementation-request" | "implementation-confirmation" | "continuation" | "plan-approval";
  userMessage: string; reference: string; action: string | null;
}
export interface PlanningArtifact {
  id: Id; kind: "brief" | "plan"; contractVersion: number;
  path: string; sha256: string;
}
export interface ExecutionAuthorization {
  id: Id; contractVersion: number; documentIds: Id[];
  request: ExecutionRequest; actor: Actor; recordedAt: string; revoked: Decision | null;
}
export interface TaskWorkflow {
  protocol: "planning-authorization-v1"; planningRequired: boolean;
  documents: PlanningArtifact[]; authorizations: ExecutionAuthorization[];
}
export interface Invocation {
  entry: Entry;
  activation: "named-entry" | "named-request" | "bound-followup" | "none";
  analysisOnly: boolean;
  persist: boolean;
}
export interface Meta { operationId: Id; actor: Actor; invocation: Invocation }
export interface Grant {
  businessWrite: boolean; delegate: boolean; commit: boolean; deploy: boolean;
  allowedPaths: string[];
}
export interface Criterion { id: Id; text: string }
export interface ContractDraft {
  goal: string; scope: string[]; constraints: string[]; acceptance: Criterion[];
  grant: Grant; quality: "standard" | "tdd";
}
export interface Contract extends ContractDraft { version: number; decision: Decision }
export interface RepositoryContext {
  worktreeRoot: string; commonGitDir: string; storeRoot: string; workspaceId: Id;
}
export interface Owner { instanceId: Id; epoch: number }
export interface Assignment {
  id: Id; outcome: string; dependsOn: Id[]; assignee: Id | null;
  businessWrite: boolean; status: "open" | "closed" | "cancelled";
}
export interface WriteToken {
  taskId: Id; assignmentId: Id | null; workspaceId: Id; instanceId: Id; epoch: number;
  contractVersion: number;
}
export interface RecoveryInfo { snapshotId: Id; operationId: Id }
export type Claim = WriteToken & (
  | { state: "writer" | "released"; recovery: null }
  | { state: "restore-target"; recovery: RecoveryInfo }
  | { state: "unknown-writer-hold"; recovery: RecoveryInfo | null }
);
export interface OccupancyRef {
  taskId: Id; assignmentId: Id | null; workspaceId: Id; instanceId: Id; epoch: number;
}
export interface OccupancySummary {
  ref: OccupancyRef; state: Claim["state"]; contractVersion: number;
}
export interface Binding {
  actor: Actor; workspaceId: Id; taskId: Id; assignmentId: Id | null;
}
export interface SnapshotEntry {
  path: string; kind: "file" | "deleted";
  sha256: string | null; mode: "100644" | "100755" | null;
}
export interface Snapshot {
  id: Id; fingerprint: string; baseCommit: string | null;
  scope: string[];
  entries: SnapshotEntry[]; workspaceId: Id; createdBy: Id; capturedAt: string;
}
export interface VerificationEnvironment {
  runtime: string; platform: string; labels: Record<string, string>;
}
export interface VerificationRequirement {
  evidenceId: Id; argv: string[] | null; environment: VerificationEnvironment;
}
export interface Evidence {
  id: Id; contractVersion: number; snapshotId: Id; actor: Actor;
  source: "command-runner" | "agent-report" | "user-observation";
  result: "pass" | "fail" | "unverified"; phase: "red" | "green" | null;
  argv: string[] | null; cwd: string; environment: VerificationEnvironment;
  exitCode: number | null; summary: string; artifactId: Id | null; sequence: number;
}
export interface CheckRow {
  acceptanceId: Id; result: "pass" | "fail" | "unverified" | "accepted-gap";
  evidenceIds: Id[]; summary: string; gapDecision: Decision | null;
}
export interface CheckSet {
  id: Id; contractVersion: number; snapshotId: Id; assessor: Actor;
  independent: boolean; rows: CheckRow[]; verification: VerificationRequirement[];
}
export interface Contribution {
  id: Id; kind: "analysis" | "change"; assignmentId: Id | null;
  contractVersion: number; submittedBy: Id; snapshotId: Id | null;
  evidenceIds: Id[]; summary: string; writeToken: WriteToken | null;
  integrated: { snapshotId: Id; owner: Owner; rationale: string } | null;
}
export interface Diagnostic {
  id: Id; kind: "fact" | "hypothesis" | "ruled-out" | "change" | "validation-gap";
  text: string; evidenceIds: Id[]; actor: Actor; createdAt: string;
}
export interface Delivery {
  id: Id; contractVersion: number; snapshotId: Id; checkSetIds: Id[];
  contributionIds: Id[]; exclusions: string[]; owner: Owner;
  acceptedGaps: Array<{ acceptanceId: Id; decision: Decision }>;
  createdAt: string;
}
export interface Task {
  id: Id; title: string; status: "active" | "delivered" | "archived";
  contracts: Contract[]; owner: Owner; assignments: Record<Id, Assignment>;
  contributions: Record<Id, Contribution>; evidence: Record<Id, Evidence>;
  checks: Record<Id, CheckSet>; diagnostics: Diagnostic[];
  deliveries: Record<Id, Delivery>;
  userAcceptances: Array<{ deliveryId: Id; decision: Decision; actor: Actor; recordedAt: string }>;
  relatedTo: { taskId: Id; deliveryId: Id } | null;
  legacySource: { path: string; fingerprint: string; originalStatus: string } | null;
  workflow?: TaskWorkflow;
}
export interface MutationReceipt {
  operationId: Id; requestHash: string; revision: number; resourceIds: Id[];
}
export interface RepositoryState {
  kernelSchemaVersion: 1; repositoryId: Id; revision: number;
  tasks: Record<Id, Task>; claims: Record<Id, Claim>;
  epochs: Record<string, number>; snapshots: Record<Id, Snapshot>;
  operations: Record<Id, MutationReceipt>;
}
export interface ContinuationView {
  taskId: Id; contract: Contract; owner: Owner; binding: Binding;
  writeToken: WriteToken | null; assignment: Assignment | null;
  occupiedWrites: OccupancySummary[];
  workflow: TaskWorkflow | null;
  diagnostics: Diagnostic[]; pendingContributionIds: Id[];
  evidenceIds: Id[]; missing: string[]; nextCursor: number; unchanged: boolean;
}
