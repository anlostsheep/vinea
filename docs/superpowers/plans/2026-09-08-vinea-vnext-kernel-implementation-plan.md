# Vinea vNext Kernel Implementation Plan

> **Historical implementation plan, retained for traceability only.** Its steps and implementation choices are not workflow or skill-loading instructions for new tasks. Use the currently selected Vinea entry and current user authorization; reading this document does not authorize execution.
> **历史执行约束：** 当时未默认授权委派、创建 worktree、提交或推送；也未采用逐阶段审批和固定角色流水线。这些记录不替代新任务的授权决定。
> **状态：** 2026-09-08 任务 1-13 已落地；用户随后授权了任务 14 的真实验收与对照。本轮已实际执行并记录成功、首轮失败、修正和宿主阻塞，不宣称通用成功率或 token 优势。
> **修订：** Grok 提出的六项计划缺口已进入实现和回归。具体执行顺序、测试合并与证据边界见下方执行状态；不倒填未按原样执行的 RED 示例。

**Goal:** 整体替换旧阶段内核，交付显式进入、本机共享、可跨 Agent 接续且具备真实交付依据的 Vinea vNext。

**Architecture:** 新建 `src/kernel/`，以一份共享聚合状态、持久写入占用和不可变快照实现核心契约；薄应用层将其组合为逻辑入口。完成基础模块后一次性切换 CLI，旧 `.vinea` 仅由隔离的只读导入器处理，不形成双写或自动迁移。

**Tech Stack:** 保留 Node.js `>=18.18`、TypeScript strict/NodeNext、Vitest、esbuild；首版只使用现有依赖及 Node/Git 能力，不引入数据库、服务或新生产依赖。

**Spec:** `docs/superpowers/specs/2026-09-08-vinea-vnext-kernel-design.md`。执行者必须同时阅读定稿设计与本计划；下列任务实现设计，不重新定义用户协作流程。

## 执行状态

- [x] 任务 1-4：共享仓库定位、精确类型、原子状态、契约/入口上限、职责和实例恢复。
- [x] 任务 5-6：内容快照、显式交接、未知写入者 hold、隔离恢复及中断重试。
- [x] 任务 7-9：核验来源、贡献整合、验收/交付、debug 与交付后关联修复。
- [x] 任务 10-12：旧格式只读导入、公开 CLI 切换、九个显式技能、双宿主分发一致性。
- [x] 任务 13：本地进程/worktree 接续和公开 CLI 交付链路；独立进程竞争、发布失败、回执丢失、blob 未登记、Binding 失败和部分恢复故障注入。
- [x] 任务 14 文档：双语 README、CLI 参考、人工验收步骤、未发布变更说明及安全覆盖迁移表。
- [x] 任务 14 本轮实测：新会话技能加载、普通请求不激活、只读检查/规划、实际派发和交接、隔离恢复与交付后修复，以及单题 token/耗时试跑。
- [ ] 后续证据：指引修正后的全新无干预身份加入、Claude 分类器恢复后的接收实现、多任务重复效果对照。首轮失败与宿主阻塞仍保留，不归为通过。

实际证据：[执行记录](../../verification/vinea-vnext-execution.md)、[旧测试安全属性迁移](../../verification/vinea-vnext-safety-coverage.md)、[真实宿主状态](../../verification/vinea-vnext-host-acceptance.md)。

实施中的保守补充：Snapshot 保存 `scope` 以发现采集后新增文件；快照 scope 按字面路径处理；自定义限额只能收紧；可选 verifier 不保存可能含秘密的原始 stdout/stderr；列表分页及按 ID 只读查询避免加载全量历史。公开 CLI 端到端测试合并在 `tests/cli/kernel.test.ts`，相关故障和权限测试位于 `tests/kernel/`，未保留空的 `tests/e2e` 目录。

下文原始逐步测试示例是实现与核对参考，不是当前执行状态的第二份权威记录；未按原命令和顺序逐字运行的条目不伪记为已执行。最终未实施项以本节和证据记录为准。

## Global Constraints

- 普通编程请求不自动激活 Vinea，也不自动创建任务。
- 首版支持同一份本地 Git 仓库及其 worktree 之间的共享状态、跨宿主接力，以及隔离工作区内的受控并行实现。
- 权威状态位于 `<Git共同目录>/vinea/`。不进入 Git 跟踪，不自动提交、推送、导出或跨机器同步。
- 授权、分工和宿主能力互不替代。下级分工不能放宽上层约定。
- 首版对参与协议的 Agent 采用同一工作目录单写。并行实现使用隔离工作区。
- 无法确认停写时，不让新 Agent 在原目录直接接管写入。
- 不强制第二个 Agent，不设置“失败两三次必须询问”的固定次数门禁。
- 指纹不能独立证明测试仍有效；Agent 转述不能伪装成独立工具采集。
- 用户接受缺口不是验证通过；未提交是合法交付状态，无关 dirty 文件不能阻塞当前任务。
- 不静默迁移、删除或改写旧任务；不在真实非 Git 项目中自动执行 `git init`。
- 不新增 Hook、daemon、MCP server、云服务或常驻调度器。
- 本次实现建议测试先行，但不改变产品对用户任务的 TDD 可选契约。基线通过、功能 RED、功能 GREEN、回归和真实宿主证据分别记录。
- 不自动 commit；不使用 `git add .`。本计划没有默认提交步骤，不运行 `npm run release`。
- 全部文件路径相对仓库根目录；临时测试仓库使用 `mkdtemp`，仅 fixture 可初始化测试专用 Git 仓库。

---

## 1. 已核对的基线与切换策略

- 现有生产入口是 `src/cli.ts`，`scripts/build.mjs` 打包为 `dist/vinea.mjs`。
- 现有 `src/core/` 将 `.vinea` 定位到当前工作区，并使用 planning/ready/in_progress/checking 等阶段模型。
- `tests/helpers/fixture.ts` 的 CLI 测试调用已构建的 `dist/vinea.mjs`；CLI RED/GREEN 前必须重新构建，不能误测旧 bundle。
- `tests/plugin/package.test.ts` 的 `beforeAll` 会运行 `npm run package:plugin`，重写 `plugins/vinea/` 及 marketplace 生成文件。
- `scripts/check-public-plugin.mjs`、`tests/plugin/skills.test.ts` 和 `tests/plugin/package.test.ts` 写死当前八个技能及若干旧流程要求，必须与入口切换一起更新。
- 保留现有图标、双语安装说明、marketplace 渠道防冲突和版本单一来源。不得借内核重写顺带修改安装行为或版本号。
- 旧源码在新 CLI 切换前维持原状，新模块先由 `tests/kernel/` 直接导入验证。切换时删除生产路径对旧写入内核的依赖，不能提供“找不到新状态就回退旧写入”的路径。
- 旧 `tests/core/` 和旧 CLI 测试在切换时被新测试替代；先建立安全性质覆盖清单，再删除过时的阶段断言，不通过 skip 或整体排除掩盖缺口。

实施前记录 `git status --short --branch` 和 `git diff --binary` 的摘要；保留原有 `.vinea` 未提交内容和本次设计文档。计划编写阶段未运行 build、package 或功能测试。

## 2. 最小持久化与文件责任

首版选择一份可原子替换的聚合状态，避免跨任务写入占用需要多个可变文件事务：

```text
<Git共同目录>/vinea/
  tasks/state.json          # 唯一权威状态；包含任务、占用、代次和操作回执
  snapshots/<id>.json       # 不可变快照清单，包含实际捕获范围及基线
  blobs/<sha256>            # 必要文件内容；本机内容寻址，不进入 Git
  artifacts/<id>/           # 命令结果等有界证据文件
  runtime/bindings/         # 可重建绑定；不是写入授权来源
  runtime/store.lock/       # 仅短期元数据操作持有，不覆盖 Agent 生命周期
```

状态文件使用内核自己的 `kernelSchemaVersion: 1`，与旧 `.vinea` 的 schema 1/2 分开。一次元数据操作在共享短锁内读取、检查并原子发布整份状态；快照和证据文件先完整发布，状态再引用它们。崩溃可能留下未引用产物，但不能留下指向半写产物的有效交付。首版只诊断孤立产物，不自动清理用户数据。

此实现将同仓库元数据更新串行化，但不串行化隔离工作区里的模型执行。读取只返回必要视图，不把整个聚合文件注入模型。若实际容量或性能不满足验收，再提出存储优化，不预先引入数据库。

| 路径 | 职责 |
|---|---|
| `src/kernel/types.ts`, `schema.ts`, `errors.ts` | 新记录类型、精确校验、稳定错误码 |
| `src/kernel/repository.ts`, `io.ts`, `store.ts` | Git 共同目录、路径安全、原子状态与只读诊断 |
| `src/kernel/policy.ts`, `contracts.ts` | 入口上限、用户决定、版本化交付约定 |
| `src/kernel/ownership.ts`, `sessions.ts`, `continuation.ts` | 分工占用、实例绑定、交接和接续视图 |
| `src/kernel/snapshots.ts` | 内容快照、比较、受控恢复 |
| `src/kernel/evidence.ts`, `verification.ts` | 证据来源与实际命令采集 |
| `src/kernel/contributions.ts`, `delivery.ts` | 贡献、整合、核验集合和不可变交付回执 |
| `src/kernel/debug.ts` | 诊断事实及关联修复任务，不另建阶段状态机 |
| `src/legacy/read.ts`, `import.ts` | 只读读取旧格式，显式导入到新存储 |
| `src/application.ts`, `src/cli/commands.ts` | 组合入口和结构化输入，不调度 Agent |
| `src/cli.ts`, `src/cli/args.ts`, `src/cli/render.ts` | 参数边界、稳定 JSON、简洁人类视图 |
| `tests/helpers/kernel-fixture.ts`, `tests/kernel/` | 临时仓库和新契约测试 |
| `tests/cli/`, `tests/e2e/`, `tests/plugin/` | CLI、真实多进程/工作区和打包验收 |

## 3. 共享类型与接口约定

以下类型由任务 1 创建，之后只允许向它们补充实际任务需要的校验字段，不建立影子类型。内核资源 ID 由内核生成；操作幂等 ID 和验收项 ID 可以由调用者提供，但必须经过有界安全校验。`hostSessionId` 仅保存真实提供的值，不用 Vinea ID 冒充。

```typescript
export type Id = string;
export type Entry = "run" | "brainstorm" | "plan" | "continue" | "check"
  | "debug" | "finish" | "orient" | "doctor";
export interface Actor { instanceId: Id; host: string; hostSessionId?: string }
export interface ActorSelector {
  host: string; instanceId?: Id; hostSessionId?: string; newInstance?: boolean;
}
export interface Decision { summary: string; reference: string | null }
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
  diagnostics: Diagnostic[]; pendingContributionIds: Id[];
  evidenceIds: Id[]; missing: string[]; nextCursor: number; unchanged: boolean;
}
```

`claims` 按规范化工作目录 ID 索引，一个工作目录只能有一个当前占用记录；只有 `state="released"` 或无记录时才可作为空闲目录认领。`writer` 表示可按当前授权提交，`restore-target` 表示尚未完成恢复，`unknown-writer-hold` 表示旧执行者仍可能写入，必须继续封住原目录。这些是局部占用事实，不是新的任务阶段。

`epochs` 的键统一使用 `executionKey(taskId, assignmentId)`，实现为 `JSON.stringify([taskId, assignmentId])`，禁止无分隔符拼接。释放不清零，正常转交和接管增加代次。一个执行键至多有一个 `writer` 或 `restore-target`；允许它同时在其他工作目录保留 `unknown-writer-hold`。可提交者必须处于 writer 状态，且 token、占用、全局最大 epoch、当前契约版本全部匹配。旧目录 hold 不产生提交资格，也不会因新目录恢复成功而自动消失。

任务负责人代次独立于业务写入代次。`OccupancyRef` 是可公开读取的乐观并发引用，不是调用者的写入授权；接管在锁内查询并核对它，不要求加入者持有原执行者的 WriteToken。运行实例 ID 是协调标识，不是对同一用户下恶意进程的身份认证。

所有测试示例使用 Vitest 的 `test`/`expect`、Node `fs/promises` 的文件函数及 `node:path` 的 `join`，并从本计划标明的生产模块和 `tests/helpers/kernel-fixture.ts` 导入所用 API。下面的公共 fixture 约定需在首次所属任务实现，不能将示例中的期望返回值硬编码成 fixture 结果：

```typescript
export declare function testMeta(actor: Actor, entry: Entry, operationId?: Id): Meta;
export declare function testEnvironment(): VerificationEnvironment;
export declare function fingerprintFixtureTree(root: string): Promise<string>;
export declare function buildKernelWorker(outputDirectory: string): Promise<string>;
export declare function runKernelCli(cwd: string, args: string[], input?: unknown): Promise<{
  exitCode: number | null; stdout: string; stderr: string;
}>;
export declare function makeCliGoalFixture(): Promise<{
  root: string; linkedRoot: string; actor: Actor; taskId: Id; writeToken: WriteToken;
}>;
export declare function makeLegacyFixture(version: 1 | 2): Promise<{
  sourceRoot: string; context: RepositoryContext; meta: Meta; fingerprint: string;
}>;
export declare function runLocalCollaborationScenario(): Promise<{
  mainStoreRoot: string; linkedStoreRoot: string; deliveryWasUncommitted: boolean;
  repairRelatedDeliveryId: Id; originalDeliveryId: Id;
  originalDeliveryBytesAfterRepair: Buffer; originalDeliveryBytes: Buffer;
}>;
```

`testMeta` 未指定 operationId 时每次生成新值。`makeGoalFixture` 的 `meta` 必须实现为每次访问生成新 operationId 的 getter；需要测试幂等时，将一次读取保存为局部变量再复用。禁止把创建任务的 operationId 用于后续不同操作。`fingerprintFixtureTree` 由任务 2 实现，只对临时 fixture 的路径和文件内容取稳定指纹，缺失根有确定表示，不能创建目录。`makeCliGoalFixture` 在任务 11 通过实际 CLI 的 session resolve、init、task create、work claim 建立，不调用内核私有状态来伪造身份恢复。

## 4. 任务依赖与实施批次

```text
1  仓库定位、类型与 fixture
2  原子共享存储
3  入口授权与交付约定
4  分工、绑定与持久占用
5  不可变快照
6  Continue、交接与恢复
7  证据来源与命令采集
8  贡献、整合与交付
9  Debug 与关联修复
10 旧格式只读导入
11 CLI 一次性切换与旧写内核退役
12 技能、双宿主清单与分发
13 多进程、多 worktree 自动验收
14 真实宿主验收与交付文档
```

顺序是本次重写的依赖关系，不是产品用户必须经历的流程。任务 7 在任务 5 后可与任务 6 独立实现；任务 10 在任务 4 后可与 5-9 独立实现，以便直接验证导入后不能认领写入。仅获准委派时利用这些并行点。`types.ts`、CLI 切换和打包清单由一个集成者维护，避免并行修改公共接口。

### Task 1: 仓库定位、精确类型和临时 fixture

**Files:** 创建 `src/kernel/types.ts`、`schema.ts`、`errors.ts`、`repository.ts`、`tests/helpers/kernel-fixture.ts`、`tests/kernel/repository.test.ts`、`tests/kernel/schema.test.ts`。

**Interfaces:**

```typescript
export declare function discoverRepository(cwd: string): Promise<RepositoryContext>;
export declare function assertRepositoryState(value: unknown): asserts value is RepositoryState;
export declare function canonicalJson(value: unknown): string;
export declare function newActor(host: string, hostSessionId?: string): Actor;
// tests/helpers/kernel-fixture.ts
export declare function makeRepoFixture(): Promise<{
  root: string; linkedRoot: string; context: RepositoryContext;
}>;
```

- [ ] 写仓库定位 RED：fixture 创建一个有初始 commit 的临时仓库及 detached linked worktree，比较其共享根；另测非 Git、unborn HEAD、路径含空格和独立 clone 不共享。

```typescript
test("linked worktrees resolve one store without creating it", async () => {
  const f = await makeRepoFixture();
  const a = await discoverRepository(f.root);
  const b = await discoverRepository(f.linkedRoot);
  expect(a.storeRoot).toBe(b.storeRoot);
  expect(a.workspaceId).not.toBe(b.workspaceId);
  await expect(access(a.storeRoot)).rejects.toMatchObject({ code: "ENOENT" });
});
```

- [ ] 运行 `npm test -- tests/kernel/repository.test.ts tests/kernel/schema.test.ts`，记录缺少新模块或新行为导致的失败；不将 fixture 初始化失败当功能 RED。
- [ ] 实现类型与定位：分别调用 `git rev-parse --path-format=absolute --show-toplevel` 和 `git rev-parse --path-format=absolute --git-common-dir`，以工作目录为 cwd，检查退出状态并规范化 `realpath`；每次只移除 Git 输出的一个终止换行，不用按多行拆分来猜测含换行的路径。工作区 ID 从规范化根路径计算。CLI 不接受外部手填的 storeRoot。非 Git 返回 `NOT_GIT_REPOSITORY`，不调用 init；只读定位不创建状态。校验器拒绝未知 schema、非有限数值、缺少字段、重复 ID、坏引用、同一执行键的多个 writer/restore-target 和循环分工依赖；允许不同目录的历史 unknown-writer-hold，不将它们当成可提交者。占用 map 的键必须等于记录的 workspaceId，所有占用代次不得超过对应全局最大 epoch，不补默认权限。
- [ ] 实现可逆的临时 fixture：使用现有 `tests/helpers/fixture.ts` 的进程模式，测试身份仅通过单次 `git -c user.name=... -c user.email=...` 提供，不写全局配置。创建 `src/app.ts` 与 `.gitignore`，导出后续任务使用的真实根路径。
- [ ] 为失败路径实现稳定错误对象，后续模块使用 code 而不是匹配不稳定的 Git/Node 错误文本；用户输入 ID 必须拒绝 `__proto__`、`constructor`、`prototype`，并限制长度和路径分隔符：

```typescript
export class KernelError extends Error {
  constructor(readonly code: string, message: string,
    readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "KernelError";
  }
}
```

- [ ] GREEN：重新运行两个测试文件与 `npm run typecheck`。确保 `newActor` 的内核 ID 和传入的真实宿主 ID 分开；`canonicalJson` 对对象键排序，对数组保序，并拒绝函数、循环和非 JSON 值。

### Task 2: 单一共享状态、原子操作与只读诊断

**Depends on:** 1。

**Files:** 创建 `src/kernel/io.ts`、`store.ts`、`tests/kernel/store.test.ts`、`tests/kernel/store-process.test.ts`、`tests/fixtures/kernel-store-worker.ts`；扩展 `tests/helpers/kernel-fixture.ts`。

**Interfaces:**

```typescript
export declare function initializeStore(ctx: RepositoryContext, meta: Meta, decision: Decision): Promise<void>;
export declare function readState(ctx: RepositoryContext): Promise<RepositoryState>;
export declare function assertPersistence(meta: Pick<Meta, "invocation">): void;
export declare function mutateState(ctx: RepositoryContext, meta: Meta, request: unknown,
  change: (draft: RepositoryState) => Id[]): Promise<MutationReceipt>;
export declare function inspectStore(ctx: RepositoryContext): Promise<{
  status: "missing" | "ready" | "incomplete" | "invalid" | "locked";
  issues: Array<{ code: string; path: string; message: string }>;
}>;
```

- [ ] RED 覆盖同 operationId 重试一次、同 ID 不同负载拒绝、两个进程抢写、损坏状态不重建、锁超时不抢锁、写入失败前后只见旧版或完整新版；另测 persist=false 时连锁目录、临时文件和初始化根都不产生。fixture worker 仅在临时共同目录运行。

```typescript
test("retries one logical mutation without replaying its callback", async () => {
  const f = await makeRepoFixture();
  const actor = newActor("codex");
  const meta = testMeta(actor, "run", "op-initialize");
  await initializeStore(f.context, meta, { summary: "initialize fixture", reference: null });
  let calls = 0;
  const op = { ...meta, operationId: "op-retry" };
  const mutate = () => { calls += 1; return ["result-1"]; };
  const first = await mutateState(f.context, op, { action: "fixture" }, mutate);
  expect(await mutateState(f.context, op, { action: "fixture" }, mutate)).toEqual(first);
  expect(calls).toBe(1);
});
```

- [ ] 运行 `npm test -- tests/kernel/store.test.ts tests/kernel/store-process.test.ts` 记录 RED。`testMeta(actor, entry, operationId)` 在本任务加入 fixture，返回显式命名、允许状态持久化的 Meta，不伪造用户会话 ID。`buildKernelWorker` 使用已有 esbuild 将测试 worker 和新内核打包到临时目录，target=node18，再以独立 Node 进程运行；不让 Node 18 直接导入 `.ts`，也不依赖尚未切换的旧生产 bundle。
- [ ] 在 `io.ts` 实现统一的持久化门闩。`initializeStore`、`mutateState`、Binding 保存、快照/blob/artifact 发布、诊断/证据保存和文件恢复都必须在创建目录、锁、临时文件或启动有副作用的子进程前调用它。persist=false 的写命令返回 `PERSISTENCE_DISABLED`，不创建假持久对象或假回执；查询、比较和接续可返回内存视图，不能通过“只写 runtime”绕过限制。

```typescript
export function assertPersistence(meta: Pick<Meta, "invocation">): void {
  if (!meta.invocation.persist) {
    throw new KernelError("PERSISTENCE_DISABLED", "This invocation must not write files");
  }
}
```

- [ ] 实现共享短锁、锁内最新状态读取和同目录临时文件原子替换。`mutateState` 的固定顺序为：检查持久化上限、取得锁、读取并校验、查 operationId/负载哈希、克隆、执行纯 change、增加 revision、写入操作回执、完整校验、发布、释放锁。回执命中时先返回旧回执，不再调用 change。文件写完同步文件内容；按平台能力处理目录同步，不能夸大断电保证。

```typescript
// store.ts 的锁内纯变换；锁和文件发布仍由 mutateState 负责。
function applyMutation(before: RepositoryState, meta: Meta, requestHash: string,
  change: (draft: RepositoryState) => Id[]) {
  assertPersistence(meta);
  const previous = before.operations[meta.operationId];
  if (previous) {
    if (previous.requestHash !== requestHash) {
      throw new KernelError("OPERATION_ID_REUSED", "Operation payload differs");
    }
    return { state: before, receipt: previous, publish: false };
  }
  const state = structuredClone(before);
  const resourceIds = change(state);
  state.revision = before.revision + 1;
  const receipt: MutationReceipt = {
    operationId: meta.operationId, requestHash, revision: state.revision, resourceIds,
  };
  state.operations[meta.operationId] = receipt;
  assertRepositoryState(state);
  return { state, receipt, publish: true };
}
```

- [ ] `io.ts` 拒绝状态路径中的符号链接逃逸、相对路径穿越和非普通目标。读/doctor 不修复。存在根但缺少有效 state 时报告 `INCOMPLETE_INITIALIZATION`；显式初始化恢复只允许检查未发布任务的初始化残留，禁止将损坏 state 当空仓库覆盖。
- [ ] 增加存储级无写入断言，不能仅检查 revision：

```typescript
test("persistence denial happens before creating a lock or store", async () => {
  const f = await makeRepoFixture();
  const base = testMeta(newActor("codex"), "run");
  const meta = { ...base, invocation: { ...base.invocation, persist: false } };
  await expect(initializeStore(f.context, meta, {
    summary: "denied fixture init", reference: null,
  })).rejects.toMatchObject({ code: "PERSISTENCE_DISABLED" });
  await expect(access(f.context.storeRoot)).rejects.toMatchObject({ code: "ENOENT" });
});
```

- [ ] GREEN：多进程仅一个原子变更成功占用指定资源，另一方得到稳定冲突；故障注入涵盖临时文件写入、发布前和发布后。未引用临时产物可以保留诊断，不自动删除锁或用户文件。

### Task 3: 入口上限、用户决定和版本化交付约定

**Depends on:** 2。

**Files:** 创建 `src/kernel/policy.ts`、`contracts.ts`、`tests/kernel/policy.test.ts`、`tests/kernel/contracts.test.ts`；扩展 `tests/helpers/kernel-fixture.ts`。

**Interfaces:**

```typescript
export declare function assertEntry(meta: Meta, boundTask: Task | null,
  capability: "state-write" | "business-write" | "delegate"): void;
export declare function createGoal(ctx: RepositoryContext, meta: Meta, input: {
  title: string; contract: ContractDraft; decision: Decision;
}): Promise<Task>;
export declare function reviseContract(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; expectedVersion: number; ownerEpoch: number;
  contract: ContractDraft; decision: Decision;
}): Promise<Contract>;
// Fixture 返回已初始化的标准任务；测试辅助函数不是公共产品 API。
export declare function makeGoalFixture(): Promise<{
  root: string; linkedRoot: string; context: RepositoryContext;
  task: Task; actorA: Actor; actorB: Actor; meta: Meta;
}>;
```

- [ ] RED：activation none 不创建状态；brainstorm/plan/check 不获得业务写入；persist=false 不写元数据或业务文件；bound-followup 必须有有效任务关联；契约更新拒绝旧版本、非负责人和缺少用户决定；`allowedPaths: []` 明确表示没有可写路径，不能当作通配符。

```typescript
test("check cannot acquire business write through an existing grant", async () => {
  const f = await makeGoalFixture();
  const meta = { ...f.meta, invocation: { ...f.meta.invocation, entry: "check" as const } };
  expect(() => assertEntry(meta, f.task, "business-write")).toThrowError(
    expect.objectContaining({ code: "ENTRY_SCOPE_DENIED" }),
  );
});
```

- [ ] 运行 `npm test -- tests/kernel/policy.test.ts tests/kernel/contracts.test.ts` 记录 RED。
- [ ] 实现 `effectiveGrant = taskGrant ∩ assignmentGrant ∩ entryCeiling` 的检查，宿主实际能力另由适配层报告，不能用 grant 代替能力。创建任务只在具备明确执行授权时进行；纯 brainstorm/plan 允许不持久化讨论，不要求伪造完整任务。
- [ ] 入口禁止返回 `ENTRY_SCOPE_DENIED`，任务或分工没有业务写入 grant、或者 allowedPaths 为空时返回 `BUSINESS_WRITE_NOT_GRANTED`。元数据保管者/负责人身份不能绕过 grant；持久化关闭时，先按任务 2 的统一门闩拒绝任何落盘。

```typescript
// assertEntry 的入口上限分支；仍须执行激活、绑定及当前 grant 检查。
const businessEntries = new Set<Entry>(["run", "continue", "debug"]);
if (capability === "business-write"
  && (!businessEntries.has(meta.invocation.entry) || meta.invocation.analysisOnly)) {
  throw new KernelError("ENTRY_SCOPE_DENIED", "This invocation cannot edit business files");
}
```

- [ ] 契约追加版本而不覆盖历史；版本号由存储计算。用户明确的新反馈可直接作为 Decision；不是根据固定关键词把“OK”推导为写入授权。记录来源缺失时保持 null，不制造消息 ID。`makeGoalFixture` 采用可写 `src/`、禁止提交部署、standard 质量、验收项 `A1` 的确定 fixture，并按公共约定提供每次生成新操作 ID 的 meta getter。
- [ ] 契约升版不会释放仍可能有进程写入的工作区。旧 contractVersion 的 token 立即失去提交资格；同一 holder 阅读新约定后，仅在新 grant 仍允许时通过 `claimWork` 换取新版本及新 epoch，不要求重复确认已批准的约定。被收紧为无写权时不能换 token，但仍可声明停写并释放本人的目录占用。
- [ ] GREEN：验证明确 TDD 和冻结约束不能被贡献者放宽；新版本不改旧版本或旧证据；相同决定的操作重试不产生第二个版本。

### Task 4: 分工、真实实例绑定和持久写入占用

**Depends on:** 3。

**Files:** 创建 `src/kernel/ownership.ts`、`sessions.ts`、`tests/kernel/ownership.test.ts`、`tests/kernel/sessions.test.ts`；扩展 fixture。

**Interfaces:**

```typescript
export declare function addAssignment(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; ownerEpoch: number; assignment: Omit<Assignment, "id" | "status">;
}): Promise<Assignment>;
export declare function bindSession(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; assignmentId: Id | null;
}): Promise<Binding>;
export declare function resolveActor(ctx: RepositoryContext, selector: ActorSelector): Promise<Actor>;
export declare function claimWork(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; assignmentId: Id | null; contractVersion: number;
}): Promise<WriteToken>;
export declare function releaseWork(ctx: RepositoryContext, meta: Meta,
  token: WriteToken): Promise<void>;
export declare function assertWriteToken(ctx: RepositoryContext, state: RepositoryState,
  meta: Meta, token: WriteToken): void;
export declare function executionKey(taskId: Id, assignmentId: Id | null): string;
export declare function assertWorkspaceClaimable(state: RepositoryState, workspaceId: Id): void;
export declare function claimFixture(f: Awaited<ReturnType<typeof makeGoalFixture>>): Promise<WriteToken>;
```

- [ ] RED：同 worktree 两个 Agent/两个任务不能同时写；不同隔离目录可分别写；删除 runtime 绑定不释放占用；释放后代次不归零；unknown-writer-hold 对任何新认领保持阻塞；旧全局 epoch 和旧契约版本都不能提交；无宿主 ID 时只在明确 newInstance 下生成 Vinea 实例，不补造外部 ID。

```typescript
test("removing a runtime binding does not release a writer", async () => {
  const f = await makeGoalFixture();
  const token = await claimFixture(f);
  await rm(join(f.context.storeRoot, "runtime", "bindings"), { recursive: true, force: true });
  const other = { ...f.meta, actor: f.actorB, operationId: "claim-b" };
  await expect(claimWork(f.context, other, {
    taskId: f.task.id, assignmentId: null, contractVersion: 1,
  })).rejects.toMatchObject({ code: "WORKSPACE_OCCUPIED" });
  expect((await readState(f.context)).claims[token.workspaceId]?.state).toBe("writer");
});
```

- [ ] 运行 `npm test -- tests/kernel/ownership.test.ts tests/kernel/sessions.test.ts` 记录 RED。
- [ ] 在聚合状态中原子检查 workspace 与执行键占用，增加持久 epoch，产生带当前 contractVersion 的 WriteToken；正常认领写入 `state="writer", recovery=null`。同一 holder 对有效 writer 的恢复可复用原 token；跨契约续做需重新验证新 grant 并增加 epoch。restore-target、unknown-writer-hold 都不是可直接认领的空位，不能覆盖为新 writer。默认任务直接使用 assignmentId=null，不为单 Agent自动创建固定角色。
- [ ] `resolveActor` 是无写入的身份解析：提供 instanceId 时原样复用并核对可用 Binding 的 host/session 一致性；未提供 instanceId 但真实 hostSessionId 匹配唯一 Binding 时恢复同一 Actor；只有明确 `newInstance=true` 才分配新 Actor。缺少两种身份依据且未要求新实例时返回 `ACTOR_RESOLUTION_REQUIRED`，冲突时返回 `ACTOR_IDENTITY_MISMATCH`。不得按任务 owner、时间或名称猜本人身份，也不因 Binding 缺失静默 newActor。新实例 ID 由调用方保存并在后续请求原样传回；无状态的新实例分配本身不产生写权。
- [ ] 绑定只做任务关联，保存仍要通过 persist 检查；身份恢复后再读取持久 Claim 判断权限。`releaseWork` 核对 holder、工作区和占用代次，但不要求被撤销的业务 grant 重新变成可写。它只能释放当前 writer；restore-target 需完成或明确处置恢复，unknown-writer-hold 由任务 6 的明确停写依据解除，不自动随新目录成功而消失。

```typescript
export function executionKey(taskId: Id, assignmentId: Id | null): string {
  return JSON.stringify([taskId, assignmentId]);
}
export function assertWorkspaceClaimable(state: RepositoryState, workspaceId: Id): void {
  const occupied = state.claims[workspaceId];
  if (occupied && occupied.state !== "released") {
    throw new KernelError("WORKSPACE_OCCUPIED", "Workspace is held, restoring, or being written");
  }
}
```

```typescript
// assertWriteToken 的代次与工作区检查；授权上限不能因此被省略。
const claim = state.claims[ctx.workspaceId];
const task = state.tasks[token.taskId];
const currentContract = task?.contracts[task.contracts.length - 1];
if (!claim || claim.state !== "writer" || token.workspaceId !== ctx.workspaceId
  || claim.instanceId !== meta.actor.instanceId || token.instanceId !== claim.instanceId
  || token.epoch !== claim.epoch || token.taskId !== claim.taskId
  || token.assignmentId !== claim.assignmentId
  || token.epoch !== state.epochs[executionKey(token.taskId, token.assignmentId)]) {
  throw new KernelError("STALE_WRITE_TOKEN", "Write ownership is absent, stale, or restoring");
}
if (!currentContract || token.contractVersion !== currentContract.version
  || claim.contractVersion !== currentContract.version) {
  throw new KernelError("CONTRACT_VERSION_CHANGED", "Read the current contract before submitting");
}
```

- [ ] GREEN：旧 token 在 release/reclaim、契约升版或异目录接管后不能提交；历史 hold 不能通过新认领或伪 writer 状态绕过全局 epoch。增加身份解析单测：保存的 instanceId 可在新进程请求中复用、真实 Binding 可找回同一 Actor、无身份依据明确失败；实际 CLI 验证在任务 11/13 进行，不用共享内存 Actor 代替。

### Task 5: 内容快照、指纹和受控恢复

**Depends on:** 4。

**Files:** 创建 `src/kernel/snapshots.ts`、`tests/kernel/snapshots.test.ts`、`tests/kernel/snapshot-safety.test.ts`。

**Interfaces:**

```typescript
export interface SnapshotLimits { maxFiles: number; maxTotalBytes: number; maxFileBytes: number }
export declare function captureSnapshot(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; paths: string[]; token: WriteToken | null; limits?: SnapshotLimits;
}): Promise<Snapshot>;
export declare function compareSnapshot(ctx: RepositoryContext, snapshot: Snapshot): Promise<{
  matches: boolean; changedPaths: string[]; missingInputs: string[];
}>;
export declare function restoreSnapshot(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; snapshotId: Id; token: WriteToken; expectedTargetBase: string | null;
}): Promise<void>;
```

- [ ] RED 覆盖已修改/已删除/新增文件、可执行位、未提交交付、缺 blob、坏 hash、基线缺失、读取中变化、目标已有额外改动、符号链接与敏感文件排除；persist=false 的 capture/restore 必须在锁、blob、清单、临时文件和业务写入发生前拒绝，整个 fixture 树的指纹保持不变。

```typescript
test("snapshot keeps uncommitted new file content rather than only its hash", async () => {
  const f = await makeGoalFixture();
  const token = await claimFixture(f);
  await writeFile(join(f.root, "src", "new.ts"), "export const value = 2;\n");
  const snapshot = await captureSnapshot(f.context, f.meta, {
    taskId: f.task.id, paths: ["src"], token,
  });
  const entry = snapshot.entries.find(item => item.path === "src/new.ts")!;
  expect(await readFile(join(f.context.storeRoot, "blobs", entry.sha256!), "utf8"))
    .toBe("export const value = 2;\n");
});
```

- [ ] 运行 `npm test -- tests/kernel/snapshots.test.ts tests/kernel/snapshot-safety.test.ts` 记录 RED。
- [ ] `captureSnapshot`、`restoreSnapshot` 和底层不可变文件发布均调用 `assertPersistence`，不能只依赖最终 state 写入的检查。`compareSnapshot` 仍是无写入的查询；不允许先生成 blob 再发现 persist=false。
- [ ] 用 Git 的 NUL 分隔 tracked/untracked 枚举配合实际文件读取，保留删除项；基线为存在时的 HEAD，否则为 null。指纹只取稳定的基线与排序后的内容清单，不加入时间或执行者；每次捕获仍有独立 snapshotId 和来源。blob 以 sha256 命名、不可覆盖；清单最后发布，状态再引用。

```typescript
// snapshots.ts；createHash 从 node:crypto 导入。
function fingerprintSnapshot(baseCommit: string | null, entries: SnapshotEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return createHash("sha256").update(canonicalJson({ baseCommit, entries: sorted })).digest("hex");
}
```

- [ ] 只捕获明确的输入范围，不默认遍历 `.git`、旧 `.vinea`、凭据目录或环境密钥文件。首版对选择范围内的符号链接、特殊文件和超出快照容量明确拒绝，不静默漏掉。`SnapshotLimits` 默认 2000 个文件、64 MiB 总内容、8 MiB 单文件，可在已经授权的资源范围内显式调整；测试传入小限额。环境以非敏感声明表示，不复制原始密钥。读取前后复核内容和 claim 代次，变化返回 `SNAPSHOT_CHANGED`。
- [ ] 恢复要求已有合法目标 worktree、目标占用、匹配基线及没有未确认改动；CLI 不自动创建工作区。先完整验证 blob/清单，再将合法目标置为 `state="restore-target"`，附带 snapshotId 与原始 operationId。恢复路径只接受对应恢复凭据、当前全局 epoch 和当前契约，不调用仅允许 writer 的普通提交守卫；同一 token 不能用于提交业务贡献。重试只接受目标文件处于已验证基线或本次已写入的快照内容，遇到第三种内容立即停止。完成后以稳定派生操作 ID 原子设置 `state="writer", recovery=null`，不额外转移代次，不解除其他目录的 unknown-writer-hold。失败保留诊断和恢复占用，不声称成功、不自动回滚用户文件。无基线/内容时返回 `SNAPSHOT_UNAVAILABLE`，不使用当前文件替代。
- [ ] GREEN：验证恢复后的内容和权限位，确认工作区仍可 dirty；缺失、超限和逃逸用例不得产生有效快照引用。测试中容量用小注入值模拟，不创建巨型数据。

### Task 6: Continue、正常交接和异常恢复

**Depends on:** 5。

**Files:** 创建 `src/kernel/continuation.ts`、`tests/kernel/continuation.test.ts`、`tests/kernel/takeover.test.ts`；修改 `ownership.ts`、`sessions.ts`。

**Interfaces:**

```typescript
export declare function continueGoal(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; assignmentId: Id | null; afterRevision?: number;
}): Promise<ContinuationView>;
export declare function handoffWork(ctx: RepositoryContext, meta: Meta, input: {
  from: OccupancyRef; to: Actor; contractVersion: number;
  transferOwner: boolean; ownerEpoch: number | null; decision: Decision | null;
}): Promise<WriteToken>;
export declare function takeoverWork(ctx: RepositoryContext, meta: Meta, input: {
  from: OccupancyRef; to: Actor; contractVersion: number;
  transferOwner: boolean; ownerEpoch: number | null; decision: Decision;
  stopBasis: "holder-release" | "host-stop-receipt" | "user-declared-stop" | "unknown";
  stopReference: string | null; baselineSnapshotId: Id | null;
}): Promise<WriteToken>;
export declare function clearWorkspaceHold(ctx: RepositoryContext, meta: Meta, input: {
  from: OccupancyRef;
  stopBasis: "holder-release" | "host-stop-receipt" | "user-declared-stop";
  stopReference: string | null; decision: Decision | null;
}): Promise<void>;
```

- [ ] RED：同实例恢复保留写权；陌生实例仅加入但可读 OccupancyRef；负责人转交不夺取其他分工；旧 token 被拒绝；unknown 同目录接管被拒绝；unknown 异目录恢复成功或失败后，原目录对同任务和其他任务都不可重新认领；当前目标只允许一个可提交代次。

```typescript
test("continue joins without stealing an active claim", async () => {
  const f = await makeGoalFixture();
  const token = await claimFixture(f);
  const view = await continueGoal(f.context, { ...f.meta, actor: f.actorB }, {
    taskId: f.task.id, assignmentId: null,
  });
  expect(view.writeToken).toBeNull();
  expect(view.occupiedWrites).toContainEqual(expect.objectContaining({
    state: "writer", ref: expect.objectContaining({ workspaceId: token.workspaceId, epoch: token.epoch }),
  }));
  expect((await readState(f.context)).claims[token.workspaceId]?.instanceId)
    .toBe(f.actorA.instanceId);
});
```

- [ ] 运行 `npm test -- tests/kernel/continuation.test.ts tests/kernel/takeover.test.ts` 记录 RED。
- [ ] 实现接续视图：当前契约、本人分工、职责、相关诊断/贡献/证据 ID 与缺口，以及相关非 released 占用的 occupiedWrites。加入者的 writeToken 仍为 null，但可从 `occupiedWrites[].ref` 提交接管所需的只读引用；该引用不赋予本人写权限。引用中的 task/assignment/workspace/instance/epoch 在锁内逐项比较，不匹配返回 `OCCUPANCY_CHANGED`，不得用“取最新”覆盖并发变化。
- [ ] afterRevision 与共享状态 revision 比较，nextCursor 返回当前 revision。状态未变时标记 unchanged；变化后重建精简当前视图，不在首版实现细粒度事件订阅。大历史返回入口和截断说明，不丢掉当前阻塞项。restore-target 和 unknown-writer-hold 不给可实施 token，分别返回恢复缺口和原目录待停写信息。persist=false 返回内存视图，不保存 Binding。
- [ ] 正常 handoff 核对当前用户/持有者决定、当前契约、原占用与全局 epoch；仅原执行者已明确停写时允许把原目录设为 released，或在同目录直接转交。transferOwner=true 时必须提供匹配的 ownerEpoch，false 时 ownerEpoch 为 null 且负责人不变。只读 OccupancyRef 不能替代这些授权和并发检查。
- [ ] unknown takeover 仅允许不同工作目录、同一共同 Git 目录、明确决定与完整快照。先验证来源是当前 writer/restore-target、引用和全局代次匹配，目标可用且新 grant 允许，再在同一原子变更中：W1 置为 unknown-writer-hold，保留原实例/代次及已有恢复信息；全局执行代次增加；W2 置为新代次的 restore-target。W1 不释放，也不授予任何人新的写入资格。恢复完成只把 W2 改成 writer；恢复失败 W1 仍 hold、W2 仍可按原 operationId 重试，不能重复增加代次或出现两个提交者。
- [ ] `clearWorkspaceHold` 是带停写依据的元数据操作，不是接管后的必经用户步骤。原 holder 明确释放可使用 holder-release；合法负责人依据真实宿主停止回执或用户明确确认停写时可解除 hold。仅“允许在 W2 接管”不等于确认 W1 已停止；unknown 不能解除。清理只影响指定旧目录，不降低全局 epoch，不修改新 holder 的 Claim，也不自动验收、合入或删除原目录改动。

```typescript
// takeoverWork 在产生任何状态或业务变更前执行此分支。
if (input.stopBasis === "unknown"
  && (ctx.workspaceId === input.from.workspaceId || input.baselineSnapshotId === null)) {
  throw new KernelError("ISOLATED_RECOVERY_REQUIRED", "Unknown writer requires isolated snapshot recovery");
}
```

- [ ] 用公开接续视图取得 from 引用，增加以下 P1 回归示例；不得从 `state.claims` 偷取原 token 来构造接管输入：

```typescript
test("unknown takeover keeps the original workspace unavailable", async () => {
  const f = await makeGoalFixture();
  const oldToken = await claimFixture(f);
  const snapshot = await captureSnapshot(f.context, f.meta, {
    taskId: f.task.id, paths: ["src"], token: oldToken,
  });
  const target = await discoverRepository(f.linkedRoot);
  const metaB = { ...f.meta, actor: f.actorB };
  const view = await continueGoal(target, metaB, { taskId: f.task.id, assignmentId: null });
  const occupied = view.occupiedWrites.find(row => row.state === "writer")!;
  const tokenB = await takeoverWork(target, { ...metaB, operationId: "takeover-b" }, {
    from: occupied.ref, to: f.actorB, contractVersion: 1,
    transferOwner: false, ownerEpoch: null,
    decision: { summary: "recover in the isolated workspace", reference: null },
    stopBasis: "unknown", stopReference: null, baselineSnapshotId: snapshot.id,
  });
  const state = await readState(target);
  expect(state.claims[f.context.workspaceId]?.state).toBe("unknown-writer-hold");
  expect(() => assertWorkspaceClaimable(state, f.context.workspaceId))
    .toThrowError(expect.objectContaining({ code: "WORKSPACE_OCCUPIED" }));
  expect(() => assertWriteToken(f.context, state, f.meta, oldToken))
    .toThrowError(expect.objectContaining({ code: "STALE_WRITE_TOKEN" }));
  expect(tokenB.epoch).toBe(oldToken.epoch + 1);
});
```

- [ ] GREEN：并发 handoff/takeover 至多一个成功；unknown 接管后 W1 对同任务和其他任务的真实 claimWork 都失败，恢复失败也保留两处不同性质的占用；明确停写后解除 W1 hold 不影响 W2 和最大 epoch。接管全过程可由公共 CLI 返回值组合完成，旧执行者不能提交，不增加固定用户阶段审批。

### Task 7: 来源明确的证据与可选命令采集

**Depends on:** 5；与 6 的写集独立。

**Files:** 创建 `src/kernel/evidence.ts`、`verification.ts`、`tests/kernel/evidence.test.ts`、`tests/kernel/verification.test.ts`。

**Interfaces:**

```typescript
export declare function recordReportedEvidence(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; contractVersion: number; snapshotId: Id;
  result: Evidence["result"]; phase: Evidence["phase"]; argv: string[] | null;
  exitCode: number | null; summary: string; environment: VerificationEnvironment;
}): Promise<Evidence>;
export declare function recordUserObservation(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; contractVersion: number; snapshotId: Id; decision: Decision;
  environment: VerificationEnvironment;
}): Promise<Evidence>;
export declare function runVerification(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; contractVersion: number; snapshotId: Id; argv: string[];
  phase: Evidence["phase"]; timeoutMs: number; environment: VerificationEnvironment;
  commandAuthorization: Decision;
}): Promise<Evidence>;
```

- [ ] RED：reported 输入不能指定 command-runner；真实采集记录进程结果；非零退出不能 pass；超时/启动失败/输入变更不能产生绿色证据；命令元字符按 argv 原样传递，不默认启动 shell；persist=false 的所有 evidence 写入口拒绝且 store/blob/artifact 不变，verify 甚至不能启动会写文件的子进程。

```typescript
test("runner records the actual failing exit code", async () => {
  const f = await makeGoalFixture();
  const snapshot = await captureSnapshot(f.context, f.meta, {
    taskId: f.task.id, paths: ["src"], token: null,
  });
  const result = await runVerification(f.context, f.meta, {
    taskId: f.task.id, contractVersion: 1, snapshotId: snapshot.id,
    argv: [process.execPath, "-e", "process.exit(7)"], phase: "red", timeoutMs: 5000,
    environment: testEnvironment(),
    commandAuthorization: { summary: "run fixture command", reference: null },
  });
  expect(result).toMatchObject({ source: "command-runner", result: "fail", exitCode: 7 });
});
```

- [ ] 在 fixture 定义 `testEnvironment()`，仅返回 Node 版本、平台和非敏感 labels。运行 `npm test -- tests/kernel/evidence.test.ts tests/kernel/verification.test.ts` 记录 RED。
- [ ] `recordReportedEvidence` 固定来源为 agent-report，真实来源只能由采集路径产生；人工观察独立记录，不伪造 command exitCode。公开 CLI 不暴露可填写 `source=command-runner` 的入口。
- [ ] 在任何 artifact 目录、临时日志、锁或子进程创建前执行 `assertPersistence`。persist=false 不执行可选 runner，不声称可以沙箱化任意验证命令；应用层可返回已有证据或内存分析，不能临时把 persist 改成 true。来源声明、当前契约和目标 snapshot 在采集开始前核对，结果入库时再次在锁内核对；期间契约变化返回 `CONTRACT_VERSION_CHANGED`，不发布当前通过记录，已有未引用 artifact 仅作为未完成采集诊断。
- [ ] 可选 runner 使用 `spawn(argv[0], argv.slice(1), { cwd: ctx.worktreeRoot, shell: false })`，记录真实终态，输出文件有界且返回 artifact ID；命令实际副作用仍依赖授权和宿主能力，不宣称只读沙箱。开始前/结束后比较快照；执行中输入变化返回未验证记录和明确原因。

```typescript
// verification.ts；spawn 从 node:child_process 导入，先校验授权和快照。
const [command, ...args] = input.argv;
if (!command) throw new KernelError("COMMAND_REQUIRED", "Verification argv is empty");
assertPersistence(meta);
const child = spawn(command, args, {
  cwd: ctx.worktreeRoot, shell: false, stdio: ["ignore", "pipe", "pipe"],
});
```

- [ ] 添加无落盘和禁止子进程副作用的具体断言：

```typescript
test("persist false does not spawn a verifier or write evidence artifacts", async () => {
  const f = await makeGoalFixture();
  const snapshot = await captureSnapshot(f.context, f.meta, {
    taskId: f.task.id, paths: ["src"], token: null,
  });
  const before = await fingerprintFixtureTree(f.context.storeRoot);
  const marker = join(f.root, "verifier-must-not-run.txt");
  const base = f.meta;
  const meta = { ...base, invocation: { ...base.invocation, persist: false } };
  await expect(runVerification(f.context, meta, {
    taskId: f.task.id, contractVersion: 1, snapshotId: snapshot.id,
    argv: [process.execPath, "-e", "require('node:fs').writeFileSync(process.argv[1], 'bad')", marker],
    phase: null, timeoutMs: 5000, environment: testEnvironment(),
    commandAuthorization: { summary: "fixture invocation forbids writes", reference: null },
  })).rejects.toMatchObject({ code: "PERSISTENCE_DISABLED" });
  await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
});
```

- [ ] GREEN：验证输出截断标识、敏感信息不回显、超时不误记成功、证据序列真实排序。记录首次环境告警原文；不得把关闭所有 Node warnings 当产品功能 GREEN 的前提。

### Task 8: 贡献、整合、核验集合和交付回执

**Depends on:** 6、7。

**Files:** 创建 `src/kernel/contributions.ts`、`delivery.ts`、`tests/kernel/contributions.test.ts`、`tests/kernel/delivery.test.ts`。

**Interfaces:**

```typescript
export declare function submitContribution(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; contribution: Omit<Contribution, "id" | "submittedBy" | "integrated">;
}): Promise<Contribution>;
export declare function integrateContribution(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; contributionId: Id; contractVersion: number;
  ownerEpoch: number; snapshotId: Id; rationale: string;
}): Promise<Contribution>;
export declare function recordCheckSet(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; contractVersion: number; snapshotId: Id; independent: boolean;
  rows: CheckRow[]; verification: VerificationRequirement[];
}): Promise<CheckSet>;
export declare function finishGoal(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; contractVersion: number; ownerEpoch: number; snapshotId: Id;
  checkSetIds: Id[]; contributionIds: Id[]; exclusions: string[];
  verification: VerificationRequirement[];
}): Promise<Delivery>;
export declare function acceptDelivery(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; deliveryId: Id; decision: Decision;
}): Promise<void>;
export declare function archiveGoal(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; decision: Decision;
}): Promise<void>;
```

- [ ] RED：过期 token 不能提交变更贡献；仅 submitted 不能算已整合；工作区 B 的通过证据不能伪装为集成树证据；无关 dirty 和未提交成果不阻塞；独立 check 不覆盖旧核验集合。必须另测契约升版后的旧 token/旧 contribution/旧 evidence 被拒绝、声明新版本但旧 token 仍被拒绝，以及 snapshot 不变但 argv 或环境变化时旧 pass 不能支持当前核验或 finish。

```typescript
test("an accepted gap remains a gap rather than becoming pass", async () => {
  const f = await makeGoalFixture();
  const snapshot = await captureSnapshot(f.context, f.meta, {
    taskId: f.task.id, paths: ["src"], token: null,
  });
  const checks = await recordCheckSet(f.context, f.meta, {
    taskId: f.task.id, contractVersion: 1, snapshotId: snapshot.id, independent: false,
    verification: [],
    rows: [{ acceptanceId: "A1", result: "accepted-gap", evidenceIds: [],
      summary: "external E2E not available", gapDecision: { summary: "accept local-only delivery", reference: null } }],
  });
  expect(checks.rows[0]?.result).toBe("accepted-gap");
});
```

- [ ] 运行 `npm test -- tests/kernel/contributions.test.ts tests/kernel/delivery.test.ts` 记录 RED。
- [ ] `submitContribution` 锁内检查变更贡献的 WriteToken、token.contractVersion、contribution.contractVersion 与当前约定一致；`integrateContribution` 和 `finishGoal` 也要求请求 contractVersion 与当前值一致，不能用“读取最新”掩盖调用者仍按旧约定操作。契约变化不删除旧记录，也不自动解除旧工作区占用。
- [ ] `recordCheckSet` 的 verification 声明本次实际期望的命令及环境，按 evidenceId 覆盖所有 pass 行引用，禁止重复冲突或省略。逐项检查证据 result、contractVersion、snapshotId、argv 和 environment；snapshot 还需对应当前实际输入。只核对 ID 存在或数组非空不合格。finish 使用重新确认的当前 verification 再比较，而不是从旧 Evidence 反向复制期待值。环境标签只表达已知范围，匹配不意味着未记录环境也被证明。
- [ ] 核验集合追加而不覆盖；independent 显式记录 assessor 和本次证据，不把实现者旧矩阵复制成新审核。standard 不强制 RED 或第二个 Agent；显式 TDD 需要有效顺序、失败与通过语义，保留来源限制，不伪装外部转述为工具采集。
- [ ] `finishGoal` 在最终快照上复核覆盖、契约版本、证据范围、整合成果及相关占用，原子形成 Delivery 并处理本次写入职责。不调用旧 `inspectBusinessGitStatus` 的全仓 dirty 门禁。未纳入成果写入 exclusions；相关正在写入而未处理时拒绝交付。用户接受缺口保留 Decision，不修改原证据结果。
- [ ] 保留不同版本的检查和交付。跨契约复用不能直接把旧 evidence ID 标为当前通过，需明确当前范围的复核记录及来源；改动范围不明确时要求重新验证或缩小结论。首版不做自动影响图、不自动合并代码。
- [ ] 错配统一返回 `EVIDENCE_VERSION_MISMATCH` 或 `VERIFICATION_CONDITIONS_MISMATCH`，不替调用者篡改 pass。调用者可重新验证，或明确记录 unverified/accepted-gap；跨版本人工复核只能作为带来源的当前复核记录，不能改写旧 runner 证据的版本、环境或采集来源。加入以下环境变化 RED，并以同一结构测试 argv 变化：

```typescript
test("unchanged files do not make old environment evidence current", async () => {
  const f = await makeGoalFixture();
  const snapshot = await captureSnapshot(f.context, f.meta, {
    taskId: f.task.id, paths: ["src"], token: null,
  });
  const argv = [process.execPath, "-e", "process.exit(0)"];
  const previousEnvironment = testEnvironment();
  const evidence = await runVerification(f.context, f.meta, {
    taskId: f.task.id, contractVersion: 1, snapshotId: snapshot.id,
    argv, phase: null, timeoutMs: 5000, environment: previousEnvironment,
    commandAuthorization: { summary: "verify fixture", reference: null },
  });
  const currentEnvironment = { ...previousEnvironment,
    labels: { ...previousEnvironment.labels, serviceRevision: "changed" } };
  await expect(recordCheckSet(f.context, f.meta, {
    taskId: f.task.id, contractVersion: 1, snapshotId: snapshot.id, independent: false,
    rows: [{ acceptanceId: "A1", result: "pass", evidenceIds: [evidence.id],
      summary: "attempted stale reuse", gapDecision: null }],
    verification: [{ evidenceId: evidence.id, argv, environment: currentEnvironment }],
  })).rejects.toMatchObject({ code: "VERIFICATION_CONDITIONS_MISMATCH" });
});
```

- [ ] `acceptDelivery` 追加 Task.userAcceptances，不改写不可变的 Delivery。`recordCheckSet` 与 finish 的行语义必须至少执行以下检查，再核对覆盖、来源和实际快照：

```typescript
for (const row of rows) {
  if (row.result === "pass" && row.evidenceIds.length === 0) {
    throw new KernelError("PASS_REQUIRES_EVIDENCE", "A pass row requires evidence");
  }
  if (row.result === "accepted-gap" && row.gapDecision === null) {
    throw new KernelError("GAP_REQUIRES_DECISION", "An accepted gap needs a user decision");
  }
}
```

- [ ] GREEN：真实未提交、新增文件、旧证据、独立核验、接管后的旧 owner、同 Agent 实现与验收、交付快照后续不可变全部通过。

### Task 9: Debug 事实和交付后关联修复

**Depends on:** 8。

**Files:** 创建 `src/kernel/debug.ts`、`tests/kernel/debug.test.ts`；修改 `continuation.ts` 的诊断视图。

**Interfaces:**

```typescript
export declare function recordDiagnostic(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; kind: Diagnostic["kind"]; text: string; evidenceIds: Id[];
}): Promise<Diagnostic>;
export declare function openRepair(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; deliveryId: Id | null; title: string; expected: string; actual: string;
  decision: Decision;
}): Promise<Task>;
```

- [ ] RED：只定位不能认领写入；活跃任务内部修复不重新创建完整流程；已交付任务修复建立 relatedTo，原 Delivery/证据不变；接续视图区分事实与假设；persist=false 的诊断保存和修复任务创建都在任何落盘前拒绝。

```typescript
test("continuation preserves a hypothesis as unconfirmed", async () => {
  const f = await makeGoalFixture();
  await recordDiagnostic(f.context, f.meta, {
    taskId: f.task.id, kind: "hypothesis", text: "request entry may be reentrant", evidenceIds: [],
  });
  const view = await continueGoal(f.context, { ...f.meta, actor: f.actorB }, {
    taskId: f.task.id, assignmentId: null,
  });
  expect(view.diagnostics[0]?.kind).toBe("hypothesis");
});
```

- [ ] 运行 `npm test -- tests/kernel/debug.test.ts` 记录 RED。
- [ ] 活跃任务的 openRepair 保存 expected/actual 为诊断事实并返回原 Task；已有交付时创建新 Task，关联指定原 Delivery，继承约束上限，不继承旧 claim 或旧通过结论。已归档来源允许只读引用，不解封写入历史。
- [ ] 为交付后修复生成新的本次授权；不能仅凭上一任务允许写入就替代本次 debug 的意图。未指定 deliveryId 且来源有多个交付时返回候选，不按时间猜选；只定位仍无业务写权。只继承关联信息，不复用原 Task 的可变集合：

```typescript
// 新修复 Task 的集合必须重新创建，关联指向冻结的原交付。
const relatedTo = { taskId: source.id, deliveryId: originalDelivery.id };
const diagnostics: Diagnostic[] = [];
const evidence: Record<Id, Evidence> = {};
const contributions: Record<Id, Contribution> = {};
```

- [ ] 诊断只保存必要结论和证据入口，不记录内部推理。事实、假设、已排除、改动和未验证分别表达；新需求或放宽契约必须 reviseContract 对应用户决定。没有进展/触及预算时提示重新评估，不增加固定重试计数门禁。
- [ ] `recordDiagnostic`、`openRepair` 是持久操作，必须执行 `assertPersistence`；不持久化的 debug/brainstorm 由应用层输出内存分析或现有记录投影，不调用这些写接口后再撤销。用 `fingerprintFixtureTree` 验证 task、runtime、blob 和 artifact 均未改变。
- [ ] GREEN：修复任务普通调用即可进入既有执行能力；完整开发内部自检失败不要求新授权；显式只读 check 到 debug 写入必须有新的修复委托。

### Task 10: 旧格式只读扫描与显式导入

**Depends on:** 4；可与 5-9 独立开发。

**Files:** 创建 `src/legacy/read.ts`、`import.ts`、`tests/legacy/read.test.ts`、`tests/legacy/import.test.ts`；创建 `tests/fixtures/legacy-v1/task.json`、`evidence.jsonl`、`check.md` 和 `tests/fixtures/legacy-v2/task.json`、`evidence.jsonl`、`check.md`，由 fixture builder 生成对应临时 `.vinea` 的配置和任务目录。

**Interfaces:**

```typescript
export interface LegacyRecord {
  path: string; fingerprint: string; originalId: string; originalStatus: string;
  title: string; goal: string; constraints: string[]; historicalEvidence: unknown[];
}
export declare function inspectLegacy(sourceRoot: string): Promise<{
  records: LegacyRecord[]; fingerprint: string; issues: Array<{ path: string; code: string }>;
}>;
export declare function importLegacy(ctx: RepositoryContext, meta: Meta, input: {
  sourceRoot: string; expectedFingerprint: string; decision: Decision;
}): Promise<Id[]>;
```

- [ ] RED：支持旧 schema 1/2 的 active/archive；未知版本、损坏 JSON、符号链接和未完成旧迁移不自动修复；同来源重复导入不重复建任务；导入前后源文件字节相同；确认导入后 claimWork 与变更贡献提交仍失败；persist=false 导入不创建新状态。扫描返回整体 fingerprint，调用者原样回传 import，不自行猜测或拼接单条记录的哈希。

```typescript
test("legacy inspection never creates the vNext store", async () => {
  const f = await makeRepoFixture();
  const result = await inspectLegacy(join(f.root, ".vinea"));
  expect(Array.isArray(result.issues)).toBe(true);
  await expect(access(f.context.storeRoot)).rejects.toMatchObject({ code: "ENOENT" });
});
```

- [ ] 运行 `npm test -- tests/legacy/read.test.ts tests/legacy/import.test.ts` 记录 RED。
- [ ] 将旧格式所需的纯解析和枚举逻辑隔离到 `src/legacy`，不调用旧 `findTask`、`orient` 或 recovery 路径，因为这些路径可能恢复并写入历史状态。扫描只报告，不触发真实仓库导入。

```typescript
// read.ts 的旧格式版本分支；之后仍须校验该版本的必要字段与路径。
const value: unknown = JSON.parse(contents);
if (typeof value !== "object" || value === null || !("schemaVersion" in value)
  || (value.schemaVersion !== 1 && value.schemaVersion !== 2)) {
  throw new KernelError("LEGACY_SCHEMA_UNSUPPORTED", "Only legacy schema 1 and 2 are importable");
}
```

- [ ] 显式导入根据来源规范化路径和内容 fingerprint 去重；来源变更要求重新预览和确认。新任务记录 legacySource，历史材料保留原身份和状态标签；不继承写权限、负责人声明、宿主 session ID 或“已验证”语义。执行权限需新的有效用户决定；不删除旧目录、不改 `.gitignore`、不取消旧文件的 Git 跟踪。
- [ ] 将导入结果的默认值写死为零执行权限。新 owner 可以是执行导入的资料保管者，但 owner 身份不能替代 grant；旧 TDD/冻结约束仍保留为历史约束，不转成新证据。导入接口没有可填写 execution grant 的参数，也不内部调用 reviseContract 升权；实际执行需另一次明确授权的契约修订，再按新 grant 认领。空 allowedPaths 表示无可写路径。

```typescript
const importedGrant: Grant = {
  businessWrite: false, delegate: false, commit: false, deploy: false, allowedPaths: [],
};
const importedOwner: Owner = { instanceId: meta.actor.instanceId, epoch: 1 };
```

- [ ] 本任务实现 `makeLegacyFixture(version)`：只在临时仓库铺设对应旧格式，初始化空的新存储，调用 inspectLegacy 取得整体 fingerprint，返回准备好的 Meta，不从真实 `.vinea` 取样。增加授权隔离断言：

```typescript
test("import approval does not authorize business execution", async () => {
  const f = await makeLegacyFixture(2);
  const before = await fingerprintFixtureTree(f.sourceRoot);
  const ids = await importLegacy(f.context, f.meta, {
    sourceRoot: f.sourceRoot, expectedFingerprint: f.fingerprint,
    decision: { summary: "import history only", reference: null },
  });
  const imported = (await readState(f.context)).tasks[ids[0]!]!;
  expect(imported.contracts[0]?.grant).toEqual({
    businessWrite: false, delegate: false, commit: false, deploy: false, allowedPaths: [],
  });
  await expect(claimWork(f.context, { ...f.meta, operationId: "claim-imported" }, {
    taskId: imported.id, assignmentId: null, contractVersion: imported.contracts[0]!.version,
  })).rejects.toMatchObject({ code: "BUSINESS_WRITE_NOT_GRANTED" });
  expect(await fingerprintFixtureTree(f.sourceRoot)).toBe(before);
});
```

- [ ] GREEN：两个旧版本的 fixture 均能导入；任何失败不改来源，不产生部分有效授权；旧 archived 历史保持只读引用。

### Task 11: 结构化 CLI 与生产入口一次性切换

**Depends on:** 6-10。

**Files:** 创建 `src/application.ts`、`src/cli/commands.ts`；修改 `src/cli.ts`、`src/cli/args.ts`、`src/cli/render.ts`、`scripts/build.mjs`；替换旧 `tests/cli/*.test.ts` 为 `entry.test.ts`、`continuation.test.ts`、`verification.test.ts`、`delivery.test.ts`、`legacy.test.ts`、`errors.test.ts`；旧 `src/core/` 写入实现和已被覆盖的旧 `tests/core/` 在本任务退役。

**Interfaces:**

```typescript
export interface CommandEnvelope {
  meta: Omit<Meta, "actor"> & { actor: ActorSelector }; payload: unknown;
}
export interface CommandResponse {
  operationId: Id | null; actor: Actor | null; workspaceId: Id | null; data: unknown;
  error?: { code: string; message: string; details: Record<string, unknown> };
}
export declare function executeCommand(ctx: RepositoryContext, command: string,
  envelope: CommandEnvelope): Promise<CommandResponse>;
export declare function main(argv: string[], io?: {
  stdin: NodeJS.ReadableStream; stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream;
}): Promise<number>;
```

每个 command 的 payload 精确映射到上面已定义函数的 input，并用专属校验器拒绝未知字段；unknown 只存在于 JSON 边界，不能进入内核。应用层先解析 ActorSelector，再用已解析的 Actor 构造内核 Meta；参与者命令的 JSON 结果必须回显完整 actor、workspaceId 和 operationId。参数解析前就失败或无需身份的纯查询可返回 actor=null，不能伪造已恢复身份。

| CLI 命令 | 映射 | 限制 |
|---|---|---|
| `session resolve` | resolveActor | 无写入分配或恢复实例，回显 Actor，不产生职责 |
| `init` | initializeStore | 显式初始化，不因 read 自动执行 |
| `task create`, `task revise` | createGoal, reviseContract | 用户决定与版本检查 |
| `task show`, `task list` | readState 的有界投影 | 不返回全部历史和原始证据 |
| `assignment add` | addAssignment | 合法负责人及分工权限 |
| `continue` | continueGoal | 恢复/加入，不自动抢占 |
| `work claim`, `work release` | claimWork, releaseWork | 内部职责操作，不是用户必经命令 |
| `work handoff`, `work takeover` | handoffWork, takeoverWork | 代次与接管依据检查 |
| `work clear-hold` | clearWorkspaceHold | 只在明确停写后解除指定旧目录 hold |
| `snapshot capture`, `snapshot restore` | captureSnapshot, restoreSnapshot | 捕获不等于任意恢复授权 |
| `evidence report`, `evidence observe` | recordReportedEvidence, recordUserObservation | 不允许指定工具采集来源 |
| `verify` | runVerification | 可选真实采集，必须有命令授权 |
| `contribution submit`, `contribution integrate` | submitContribution, integrateContribution | 不自动合并业务文件 |
| `check record` | recordCheckSet | 记录指定来源与快照的核验 |
| `debug open`, `debug record` | openRepair, recordDiagnostic | 分析/修复范围不能混用 |
| `finish`, `delivery accept`, `archive` | finishGoal, acceptDelivery, archiveGoal | 交付、接受、归档分开 |
| `legacy inspect`, `legacy import` | inspectLegacy, importLegacy | 不隐式迁移 |
| `orient`, `doctor`, `validate` | 有界视图、inspectStore、assertRepositoryState | 只读，不自动修复 |

- [ ] 写 CLI RED：所有变更请求从 `--input -` 读取 stdin JSON；读取类命令允许最少只读定位参数；`--json` stdout 只有一个完整 JSON，诊断走 stderr。测试 no activation、坏版本、占用冲突、旧命令误用和不存在任务；再测试两个真正独立 CLI 进程通过回显 actor 连续执行，不传同一内存 Actor 对象或私有 claims。

```typescript
test("new CLI rejects legacy transition without mutating either store", async () => {
  const f = await makeRepoFixture();
  const result = await runKernelCli(f.root, ["task", "transition", "old-id", "--to", "checking", "--json"]);
  expect(result.exitCode).not.toBe(0);
  expect(JSON.parse(result.stdout).error.code).toBe("LEGACY_COMMAND_REMOVED");
  await expect(access(f.context.storeRoot)).rejects.toMatchObject({ code: "ENOENT" });
});
```

- [ ] 在 fixture 定义 `runKernelCli(cwd, args, input?)`，以 argv 和管道 stdin 调用新 bundle。先 `npm run build`，再运行 `npm test -- tests/cli`，确认 RED 测到的是本次构建。
- [ ] 明确实例生命周期：首次新执行先 `session resolve`，用 `newInstance=true` 取得 Actor；后续 init/create/claim/continue 等命令原样回传该 Actor，或提供可命中唯一 Binding 的真实 hostSessionId。只有 session resolve 允许主动 newInstance，其他参与者命令不得为了通过解析而静默创建新 Actor。有 instanceId 和 Binding 时核对 host/session 一致性，冲突不覆盖；无身份依据时返回 `ACTOR_RESOLUTION_REQUIRED`。这个分配步骤由技能管理，不增加用户审批，也不是安全认证。
- [ ] `session resolve` 的新分配无持久副作用；拿到回执后才发送有副作用的命令，持久命令重试必须复用原 Actor 和 operationId。persist=false 的身份查询或内存分配不写 Binding、不建 store。清理 Binding 后，持有原回显 Actor 的调用者仍可按持久 Claim 恢复；两种身份依据都丢失时只能明确加入或交接，不能按 owner 名称“认出本人”。
- [ ] 实现 `makeCliGoalFixture`，仅用临时 Git fixture 和公共 CLI 完成 session resolve、init、task create、work claim；通过 stdout 的 actor/data 保存实际 ID。增加 A04 的进程边界断言：

```typescript
test("a fresh CLI process resumes the echoed instance instead of creating another", async () => {
  const f = await makeCliGoalFixture();
  const next = await runKernelCli(f.root, ["continue", "--input", "-", "--json"], {
    meta: { ...testMeta(f.actor, "continue"),
      actor: { host: f.actor.host, instanceId: f.actor.instanceId,
        ...(f.actor.hostSessionId ? { hostSessionId: f.actor.hostSessionId } : {}) } },
    payload: { taskId: f.taskId, assignmentId: null },
  });
  const result = JSON.parse(next.stdout);
  expect(next.exitCode).toBe(0);
  expect(result.actor.instanceId).toBe(f.actor.instanceId);
  expect(result.data.writeToken).toMatchObject({
    instanceId: f.actor.instanceId, epoch: f.writeToken.epoch,
  });
});
```

- [ ] 补充进程用例：有真实 hostSessionId 的 Binding 找回同一 ID；删除 Binding 后回传原 Actor 仍恢复；不回传 ID 且无 Binding 时明确失败；明确新实例只加入、不抢占。A06 使用 continue 返回的 occupiedWrites.ref 构造 takeover，再从原目录的公共 work claim 验证 hold，禁止读 state.json 绕开协议。
- [ ] 切换 `src/cli.ts` 仅依赖新 application/kernel/legacy 只读解析。组合命令必须经过对应内核函数，不让入口的短路径绕过权限、代次或快照检查。未知旧写命令只返回迁移说明，不保留旧 CLI fallback。

```typescript
// commands.ts 的注册项示例；每个 payload 经对应校验器后再调用目标函数。
const kernelCommands = {
  "task create": createGoal,
  "task revise": reviseContract,
  "continue": continueGoal,
  "debug open": openRepair,
  "finish": finishGoal,
} as const;
```

- [ ] 从旧测试迁移路径安全、版本拒绝、失败恢复、幂等、多进程、非法来源和错误输出这些安全性质；用新契约测试替代 planning/ready、全仓 dirty、固定八技能和旧 rework 序列。删除不再使用的 `tests/cli/task-lock-contention-preload.cjs`，使用新测试 worker。然后删除生产不可达的旧内核文件，不把旧写实现藏进 legacy；测试覆盖迁移必须先于旧文件删除。
- [ ] 保留 `dist/vinea.mjs` 产物位置；build 显式 target 为 Node 18。GREEN 顺序是 `npm run build`、`npm run typecheck`、`npm test -- tests/kernel tests/legacy tests/cli`。静态确认生产依赖图不存在 `src/core/workflow.ts`、旧 `.vinea/tasks` 写入路径或自动 Git 命令。

### Task 12: 显式技能、双宿主清单和分发一致性

**Depends on:** 11。

**Files:** 创建 `skills/run/SKILL.md`、`skills/debug/SKILL.md`；重写 `skills/brainstorm/`、`plan/`、`continue/`、`check/`、`finish/`、`orient/`、`doctor/` 下的 SKILL.md；移除已替换的 `skills/propose/SKILL.md`；修改 `hosts/codex/.codex-plugin/plugin.json`、`hosts/claude/.claude-plugin/plugin.json`、`scripts/check-public-plugin.mjs`、`tests/plugin/skills.test.ts`、`tests/plugin/package.test.ts`。

**Produces:** 九个实际命名空间技能 `vinea:run/brainstorm/plan/continue/check/debug/finish/orient/doctor`。设计中的 `/vinea` 是主入口的逻辑称呼；没有经过真实宿主验证，不伪造裸别名已注册。用户明确说使用 Vinea 仍是有效激活意图。

- [ ] RED：技能 inventory 改为九个；测试显式进入守卫、只读上限、debug 闭环、无固定三角色、无重复确认、无全仓 dirty 门禁、无伪造 session ID，以及 public/source parity。

```typescript
test("published entries include run and debug rather than the global proposer", async () => {
  const names = (await readdir(join(process.cwd(), "skills"))).sort();
  expect(names).toEqual([
    "brainstorm", "check", "continue", "debug", "doctor", "finish", "orient", "plan", "run",
  ]);
  const source = await readFile(join(process.cwd(), "skills", "check", "SKILL.md"), "utf8");
  expect(source).toContain("Do not modify business code");
});
```

- [ ] 运行 `npm test -- tests/plugin/skills.test.ts` 记录 RED。不要先运行会覆盖生成目录的 package 测试来代替源技能 RED。
- [ ] 技能采用短的入口契约；共用 CLI 定位规则，不能把整份设计复制进技能。描述限定用户点名 Vinea 或调用该入口，技能正文在没有有效激活/任务绑定时停止状态变更。示例前置模板为：

```markdown
---
name: debug
description: Use only when the user explicitly invokes Vinea debugging or requests repair within an authorized Vinea task.
---

Respect the current task grant and any analysis-only request. Investigate, repair, and verify only within that scope. Preserve facts, hypotheses, evidence, and unresolved validation in the shared task; do not add a mandatory phase sequence.
```

- [ ] 在 run/continue/debug 及核验技能中明确复用上一次 CLI 回显的 Actor，只有明确开始新的 Vinea 执行实例才调用 session resolve 的 newInstance。真实宿主 session ID 仅在确实提供时使用；缺 Binding 不构造新 ID 假装恢复，换宿主/换执行者不借用前任 instanceId。接管从 occupiedWrites 读取 OccupancyRef，不把只读摘要当成本人的写权。
- [ ] 区分宿主技能加载与流程激活。Codex 的 `policy.allow_implicit_invocation: false` 和 Claude 的 `disable-model-invocation: true` 会限制模型自动加载；不能未经测试直接启用而破坏已认可的“明确说使用 Vinea”入口。本次默认采用精确描述与内核激活守卫，真实宿主测试确认普通请求不建任务、命名自然语言可进入。它是协作边界，不冒充平台沙箱。
- [ ] 更新检查脚本与测试中的技能数量、help 命令、默认 prompt 和描述语义；保留双宿主 manifest、图标、安装/卸载/渠道防冲突约束，不添加新服务器或权限配置。
- [ ] GREEN：`npm test -- tests/plugin/skills.test.ts`，随后 `npm run package:plugin`、`npm run check:plugin`、`npm test -- tests/plugin`。生成目录只由脚本产生，不手改 `plugins/vinea/skills/`。

实现时核对的官方资料：OpenAI《Build skills》（`https://learn.chatgpt.com/docs/build-skills`）与 Claude Code《Extend Claude with skills》（`https://code.claude.com/docs/en/skills`），本计划编写时于 2026-09-08 查询。文档支持命名与触发机制，不代替本机真实插件验证。

### Task 13: 多进程、多 worktree 与恢复自动验收

**Depends on:** 12。

**Files:** 创建 `tests/e2e/local-collaboration.test.ts`、`handoff-recovery.test.ts`、`debug-delivery.test.ts`；扩展 `tests/helpers/kernel-fixture.ts` 和测试专用进程脚本；必要时仅调整 `vitest.config.ts` 的测试超时，不通过全局跳过消除失败。

**Interfaces:** 仅使用新公共 CLI、公开内核 API 和上述 fixture，不读取私有临时对象来绕过真实入口。

- [ ] RED：同一 fixture 启动两个 Node 进程，在两个真实 worktree 执行；分别覆盖主入口、claim、快照、贡献、整合、finish 和交付后 debug。实例 ID 来自 session resolve 的 stdout，并跨后续进程回传；接管引用来自 occupiedWrites，不读内部 state。模拟 host 字符串不等于真实宿主验收，测试名称必须写 local-cli。

```typescript
test("local-cli processes share one store and preserve the old delivery", async () => {
  const run = await runLocalCollaborationScenario();
  expect(run.mainStoreRoot).toBe(run.linkedStoreRoot);
  expect(run.deliveryWasUncommitted).toBe(true);
  expect(run.repairRelatedDeliveryId).toBe(run.originalDeliveryId);
  expect(run.originalDeliveryBytesAfterRepair).toEqual(run.originalDeliveryBytes);
});
```

- [ ] 本任务在 fixture 实现 `runLocalCollaborationScenario()`：创建任务，A/B 在隔离目录贡献；负责人整合到指定快照并验证；保存交付字节；新建关联修复任务并再次读取旧交付。返回测试中的六项实际观察，不返回硬编码成功布尔。
- [ ] 运行 `npm run build` 与 `npm test -- tests/e2e` 记录真正缺失的端到端行为。故障测试在隔离进程注入退出点：状态发布前、blob 发布后状态引用前、交接提交后绑定写入前、恢复部分写入后。
- [ ] 修复跨模块连接问题，保持单一权威源；读-only模式不得自动修复；旧 actor 不能凭残留 Binding 提交当前贡献。覆盖新 Agent 加入、原实例恢复、正常交接和 unknown 接管四条不同路径。unknown 接管成功及恢复失败两种分支都要从 W1 再执行公共 claim，分别尝试同任务与另一任务，均应拒绝；明确解除旧 hold 后只恢复 W1 的可认领状态，不能修改 W2 的 token 或全局最大代次。
- [ ] 扩展跨模块负向场景：persist=false 前后整个 fixture 树不变且 verifier 未启动；契约升版后旧 token、旧 contribution、旧 evidence 不得通过；同 snapshot 下 argv/runtime labels 变化使旧核验不可直接复用；旧格式 import 后没有任何执行权限。所有预期拒绝应留下稳定错误，不把未执行命令伪记为 fail/pass 证据。
- [ ] GREEN：`npm run typecheck`、`npm run build`、`npm test -- tests/kernel tests/legacy tests/cli tests/e2e`，再运行 `npm run check`。记录构建/打包带来的文件变化，核验仅为预期新内核和生成产物，不触碰真实 `.vinea`。

### Task 14: 真实宿主验收、双语文档与实现交付

**Depends on:** 13；真实宿主安装或配置变更需对应用户授权。

**Files:** 修改 `README.md`、`README.en.md`、`hosts/public-plugin/README.md`、`hosts/public-plugin/README.en.md`、`docs/manual-e2e.md`、`CHANGELOG.md`；新增 `docs/verification/vinea-vnext-host-acceptance.md`；随后重生成 `plugins/vinea/` 和 marketplace。

**Produces:** 真正观察到的宿主证据和诚实的未覆盖清单，不修改 release 版本，不自动安装到用户宿主、不运行 release/commit/push。

- [ ] 写文档/分发 RED：双语操作说明必须有真实注册的 run/debug/continue/check 范围、本地状态路径、非 Git 跟踪、旧数据只读导入、未提交交付，以及“不提供跨机器同步”的说明。先运行 `npm test -- tests/plugin/package.test.ts`，记录缺失新说明的失败。

```typescript
test("public docs describe the local store and uncommitted delivery", async () => {
  const root = process.cwd();
  const zh = await readFile(join(root, "hosts", "public-plugin", "README.md"), "utf8");
  const en = await readFile(join(root, "hosts", "public-plugin", "README.en.md"), "utf8");
  expect(zh).toContain("<Git共同目录>/vinea/");
  expect(zh).toContain("未提交");
  expect(zh).toContain("vinea:debug");
  expect(en).toContain("shared Git directory");
  expect(en).toContain("uncommitted");
  expect(en).toContain("vinea:debug");
});
```

- [ ] 更新四份 README 和 manual-e2e，保留用户仍需要的安装、升级、回滚及单渠道说明；不要继续把八个旧技能或多次确认写成必经流程。`CHANGELOG.md` 使用未发布条目，最终版本与发布时点另行决定。
- [ ] 在用户授权的隔离测试仓库和真实新宿主会话验收：Codex 创建并验证未提交成果，另一个宿主只读加入；正常交接后继续；明确 check 不改代码；debug 修复并保留原交付；若有已授权派发能力，执行真正的派发、等待、回收和整合。缺能力时展示显式接力，不用脚本扮演另一宿主。
- [ ] `docs/verification/vinea-vnext-host-acceptance.md` 逐项记录日期、宿主和模型、真实任务/执行 ID、共同目录、代码与快照版本、命令结果、授权边界、未覆盖项。不得只以插件已安装、manifest 正确或两个 host 字符串证明新会话技能已激活。
- [ ] 若权限或宿主条件不具备，标记对应人工验收未执行，不伪称全量完成。静态/本地 CLI 验证与真实适配证据分开，预算对照未做时不宣称更省 token。
- [ ] GREEN：重新打包后运行 `npm run check:plugin` 和完整测试；最后展示实际 diff、未提交状态、验收矩阵及已知限制。不要借任务完成自动迁移其他项目、修改生产环境或提交 Git。

## 5. 需求覆盖矩阵

| Spec | 实现任务 | 自动证据 | 真实宿主补充 |
|---|---|---|---|
| A01 显式进入 | 3、11、12 | policy/CLI/skills | 普通请求与命名自然语言对照 |
| A02 讨论与规划上限 | 3、12 | policy/skills | 确认方案但未授权实现不写代码 |
| A03 共享权威源 | 1、2、13 | repository/store/e2e | 两宿主同共同目录 |
| A04 原实例恢复 | 4、6、11、13 | session resolve 回显 ID，跨 CLI 进程复用 | 新会话恢复实际任务 |
| A05 加入与交接 | 4、6、13 | ownership/continuation | 只读加入与明确接续区别 |
| A06 旧代次与接管 | 4、6、11、13 | 公开占用引用、旧目录 hold、全局 epoch | 停止能力不足时不能假成功 |
| A07 并行贡献整合 | 4、8、13 | contributions/e2e | 真派发、回收和负责人整合 |
| A08 未提交与快照 | 5、8、13 | snapshots/delivery | 实际未提交代码交接 |
| A09 证据与独立检查 | 7、8、13 | 契约、snapshot、argv、环境错配拒绝 | 真实核验来源与范围 |
| A10 内部修复与只读 | 2、3、5、7、9、11、13 | persist 全路径、禁止 verifier 副作用 | 同一任务的两种授权场景 |
| A11 Debug 接续 | 6、9、13 | continuation/debug | 假设与事实在新 Agent 中保真 |
| A12 交付后修复 | 8、9、13 | debug-delivery | 不改写旧交付记录 |
| A13 宿主能力缺失 | 12、14 | skills/documentation | 真实缺失能力提示 |
| A14 兼容与恢复 | 2、4、10、13 | legacy 零执行权限与故障注入 | 不在真实旧数据上自动试迁移 |

## 6. 本轮审核修订映射

以下仅表示意见已转成计划中的类型、接口和验收要求，不表示新内核已经修复或测试通过。Spec 保持不变，本轮没有追加 Grok 复审。

| 审核项 | 修订位置 | 必须证明的拒绝行为 |
|---|---|---|
| R1 未知接管释放原目录 | Claim 状态、任务 1/4/5/6/13 | 原目录 hold 不能被任何新任务认领，旧全局 epoch 不能提交 |
| R2 persist 未覆盖全部写路径 | 统一 assertPersistence、任务 2/3/5/7/9/13 | 不建锁/临时文件/blob/artifact，不启动 verifier |
| R3 升版/环境变化沿用旧证据 | token.contractVersion、核验条件、任务 3/7/8/13 | 旧版本提交、旧 snapshot、旧 argv/环境不能直接支持当前通过 |
| R4 接管缺少公开输入 | OccupancyRef/occupiedWrites、任务 6/11/13 | 不需要持有原写 token，引用变更必须拒绝而非自动取最新 |
| R5 实例身份跨进程不连续 | ActorSelector/回显、任务 4/11/12/13 | 不静默 newActor，不用同一内存 Actor 代替进程恢复 |
| R6 导入决定被当作执行授权 | 零 Grant、任务 3/4/10/13 | 导入 owner 不能认领写入或提交变更贡献 |

## 7. 计划自检与实现授权边界

以下是计划文档的自检项目，不是已执行的实现任务：

- 接口自检：所有任务使用共享类型，新增输入类型和 fixture 函数均在首次使用任务明确声明，不出现两个 owner/claim 权威字段。
- 覆盖自检：A01-A14 均有自动或人工验收位置；隐私、路径、版本、幂等、失败恢复和占用冲突不因退役旧测试而丢失。
- 轻量自检：没有强制固定角色、阶段审批、重试次数、全部测试必须 Vinea 执行或每次交付先 commit 的要求。
- 副作用自检：区分计划编写、fixture 测试、实际插件安装、真实旧数据迁移和发布；后面三项不能由前两项隐式授权。
- 交付自检：未执行的复选框不勾选；基线、RED、GREEN、回归、打包、真实宿主和效果对照分开汇报。

用户已授权执行计划，并随后授权继续真实宿主验收和对照。后者使用隔离安装/会话内插件和真实子任务，不修改默认插件安装。仍未授权真实数据迁移、提交、推送或发布；也不能将流程改回 Git 跟踪任务、自动抢占或固定阶段工作流。
