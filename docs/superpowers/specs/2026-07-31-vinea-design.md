# Vinea：轻量跨宿主 AI Coding 操作框架设计

> 日期：2026-07-31
> 状态：设计已确认，待实现计划
> 交付物：Codex 与 Claude Code 的可安装插件，以及独立 Node CLI

## 1. 目标

Vinea 是受 Trellis 启发、面向小团队长期 AI Coding 的轻量操作框架。它不替代 Git、CI、代码审查、Issue 系统或人工产品决策；它为多个 AI 会话和两个宿主提供稳定的任务状态、相关上下文、质量模式、回归检查与经验沉淀。

首期交付可从 Git marketplace 安装的 Codex 与 Claude Code 插件。两端必须在同一 Git 仓库中读取同一套 Vinea 状态，并能在新会话中确认、恢复和继续同一个共享 task。

### 1.1 成功标准

1. Codex 与 Claude Code 均提供同语义的 Vinea skill。
2. 一个宿主创建或推进的 task，可由另一个宿主的新会话定位、确认和接续。
3. 中高风险变更由 agent 说明依据、用户确认后创建 task；用户显式 inline 跳过时保存简短理由。
4. task 可选 qualityMode：standard 或 tdd；可选 executionMode：single-agent 或 delegated。
5. 完成前存在需求、task 项、变更、测试和核验证据的回归矩阵。
6. 仅经用户确认且可复用的经验进入长期规范，其余 task 材料归档。
7. 缺 hook、缺 session ID、多 task 歧义、schema 不兼容时，框架清晰降级或停止，不伪造自动化。
8. 无需 agent 参与的 vinea validate 可在 CI 或本地验证 schema、状态、manifest 引用和上下文预算。

### 1.2 非目标

- 首期不做多人并发认领、分支协调、Git 冲突处理、PR 自动化或 Jira 同步。
- 首期不做 MCP server、常驻 daemon、云端数据库或聊天记录上传。
- 首期不自动提交业务代码，也不宣称能阻止用户绕过流程。
- 首期只支持 Codex 与 Claude Code；其它宿主仅预留 adapter contract。
- 首期不把所有改动 task 化：问答、只读分析和可快速验证的微小修改保留直接路径。

## 2. 设计原则

1. **仓库文件优先。** 团队事实可 Git review、diff 和归档；本机 session 指针可删除和重建。
2. **单一状态写入接口。** 人和 agent 均通过 Vinea CLI 改变 task 状态；skill 不直接编辑状态 JSON。
3. **adapter 最薄。** 宿主差异仅限 manifest、hook、插件路径和 session ID；共享状态机必须一致。
4. **按风险增加流程。** agent 先解释为何建议 task，用户确认后才创建。
5. **证据优先。** 测试、核验和验收记录命令、结果或明确的人类结论，而非只接受 agent 自述。
6. **上下文按需加载。** 新会话获取紧凑摘要；实施和检查只读取 task manifest 引用的资料。
7. **规范少而准。** task 保存一次性事实；长期 spec 只保存经确认、可复用、仍有效的约束。

## 3. 公开命名空间

项目、插件、CLI 和状态目录均使用 Vinea。公开接口不使用 Trellis 名称，也不提供无前缀的通用命令。

| 类型 | 名称 |
|---|---|
| 项目与插件 | vinea |
| CLI binary | vinea |
| 仓库状态目录 | .vinea/ |
| agent skill 前缀 | vinea: |
| 不提供的裸别名 | start、check、continue、finish 等 |

首期 public skills：

- vinea:orient
- vinea:propose
- vinea:brainstorm
- vinea:plan
- vinea:continue
- vinea:check
- vinea:finish
- vinea:doctor

统一前缀避免与宿主原生能力或第三方插件的同名 skill 冲突。CLI 子命令是内部实现，不要求用户背诵。

## 4. 架构与职责

    Codex plugin ─────┐
                      ├─ adapter skills / optional hooks ──> vinea CLI
    Claude Code plugin┘                                      │
                                                               ├─ .vinea/ shared Git facts
                                                               └─ .vinea/.runtime/ local pointers

### 4.1 Vinea CLI

CLI 是唯一状态管理层，负责初始化、schema migration、风险建议、task 创建与转移、orient/status 摘要、测试证据、需求回归矩阵、归档、doctor 与可在 CI 运行的 validate。

CLI 不生成业务代码，不代替 agent 进行语义判断，也不执行未在 task 中明确声明的任意项目命令。

### 4.2 Codex 与 Claude Code adapter

两个插件提供同名 Vinea skills，并将宿主能力映射到同一 CLI：

- 支持 SessionStart/hook 且能可靠取得 session ID 时，启动调用 orient 并注入紧凑上下文。
- hook 缺失、未批准或不可用时，vinea:orient 是可靠的显式入口。
- adapter 不实现第二套 task 状态机。
- delegated 模式仅在当前宿主具备所需 sub-agent 能力时可启动。

### 4.3 发行方式

发行方式沿用 Grokodex 已验证的双宿主模式：根 package version 是唯一版本来源；打包得到一份预构建公共插件树，其中同时包含 Codex 与 Claude Code manifest、预构建 CLI 和 skills；发布检查确保版本一致且不含机器绝对路径。

插件不要求用户先全局安装 npm binary，也不以 MCP 承载 CLI。公共插件树内含 `bin/vinea.mjs`：Claude Code skills 通过 `${CLAUDE_PLUGIN_ROOT}/bin/vinea.mjs` 调用；Codex skills 从宿主显示的绝对 `skills/<skill>/SKILL.md` 路径反推出插件根目录后，调用同一文件。两端再将当前 Git 工作目录作为 CLI 的项目根解析起点。这使 CLI 的实际版本随插件安装版本固定，并避免相对路径被误解为会话工作目录。

## 5. 受管仓库的数据模型

    .vinea/
      config.json
      .gitignore
      specs/
        index.md
        <domain>.md
      tasks/
        active/
          <task-id>-<slug>/
            task.json
            brief.md
            plan.md
            context.jsonl
            evidence.jsonl
            check.md
            journal.md
        archive/
          <task-id>-<slug>/
      .runtime/
        sessions/
          <host>-<session>.json

除 .runtime/ 外，.vinea/ 均纳入 Git。nested .gitignore 只忽略 .runtime/，因此 init 不必覆盖已有 AGENTS.md、CLAUDE.md 或根 .gitignore。config.json 还定义风险规则，以及单个 context manifest 可引用的最大文件数和估算字节数，防止任务上下文无界膨胀。

task.json 至少保存 schemaVersion、task ID、标题、状态、风险等级与建议依据、qualityMode、executionMode、需求 ID、验收状态、可选提交元数据和 inline 跳过理由。

### 5.1 task 状态机

    planning → ready → in_progress → checking → finished → archived
                      ↘ blocked

- planning：正在澄清、brainstorm、写 brief 和 context，不写业务代码。
- ready：brief、plan、context manifest 和模式均已确认。
- in_progress：实施进行中。
- checking：任务项完成，正在回归需求、测试和证据。
- finished：check 已通过、业务 Git 工作流已处理、长期规范候选已决定。
- archived：移入 archive，不再作为新会话默认上下文。
- blocked：记录外部阻塞与下一步，不能伪装为 finished。

CLI 只允许有前置证据的相邻状态转移。错误 schema、缺文档、多 active task、超出 context 预算或不满足 finish 门槛时返回可操作错误，不擅自修复。

## 6. 工作流

### 6.1 路由与 task 确认

agent 区分三类请求：

- 只读问答、解释与技术查证：直接回答。
- 明确且低风险的小修改：可 inline。
- 行为变更、bug 修复、跨文件或跨模块、外部副作用、安全、数据或部署相关变更：说明风险依据并建议 task。

仅当用户确认后，vinea:propose 创建 task。用户明确要求 inline 时，Vinea 写入简短绕过理由；这是审计信号，不视作失败。

vinea validate 不依赖宿主或模型，可在本地或 CI 检查 schema、状态转移、manifest 路径、重复引用、文件数与上下文预算。它不运行项目测试，也不替代 vinea:check。

### 6.2 Brainstorming

vinea:brainstorm 保留 Superpowers brainstorming 的高价值行为，但不强制套用于所有任务：

1. 读取当前 task 相关代码和长期规范。
2. 每次只询问一个会改变方向的关键问题。
3. 产出 2–3 个方案与取舍。
4. 分节呈现设计，获批准前不实施。
5. 将已确认结果写入本 task 的 brief.md 与 plan.md，而非污染长期 spec。

对需求明确且低风险的任务，Vinea 不制造无意义的澄清环节。

### 6.3 新会话恢复

启动或显式运行 vinea:orient 时：

1. adapter 调用 CLI 获取 Git 状态、schema 健康度、session 指针与 active task 候选。
2. 已绑定 session 显示 task 阶段、目标、未决项、required context 与最近 check 状态。
3. 没有绑定且只有一个共享 active task 时，建议用户接续；仍需用户确认后绑定。
4. 有多个候选时列出摘要，等待用户选择；不得按名称或修改时间猜测自动附着。
5. 将确认结果写入本机 .runtime/sessions，随后加载 compact journal 与 context manifest。

恢复的是可审查的任务摘要和文件引用，不是聊天记录重放。

### 6.4 质量与执行模式

对行为变更和 bug 修复，agent 建议用户启用 TDD：

- standard：按计划实施，执行相关验证并记录结果。
- tdd：实现前声明并实际运行预期失败的相关测试；实现后重新运行并记录通过证据。无法合理形成先失败测试时，task 必须记明原因，由用户选择降级或 blocked。

sub-agent 同样是建议后确认：

- single-agent：主 agent 按 context manifest 执行。
- delegated：research、implement、check 三个目的明确的角色。research 和 check 默认只读；implement 是唯一业务代码写入者。

当前宿主不支持 delegated 所需能力时，Vinea 停止并要求用户选择 single-agent 或切换宿主，不静默降级。

### 6.5 Check、finish 与经验沉淀

vinea:check 生成需求回归矩阵：

| 需求 ID | task 项 | 实现或变更路径 | 测试或核验证据 | 结果 |
|---|---|---|---|---|

每条验收条件必须有明确证据或未覆盖结论。check 可以发现 task 打勾但未满足需求、TDD 证据缺失、失败测试、未运行验证和 manifest 遗漏；它不能取代人工产品验收或线上运行核验。

vinea:finish 的顺序：

1. 确认业务改动已按项目 Git 工作流处理，且没有未处理的业务 dirty files。
2. 确认 check matrix 没有失败或未覆盖项。
3. 提议符合长期规范标准的经验：稳定、跨 task 复用、可验证且不重复。
4. 用户确认后更新相应 spec；其它经验保留在 task。
5. 写入 journal，标记 finished 并归档。

Vinea 永不自动把所有任务总结写入长期规范。

## 7. 错误处理与降级

| 情况 | Vinea 行为 |
|---|---|
| 未初始化或 schema 不匹配 | doctor 报告准确版本与 migration 指引，不改业务文件 |
| hook 不可用 | 要求显式运行 vinea:orient，不声称已自动恢复 |
| 多个 active task | 列出候选，等待用户选择 |
| TDD 缺失败测试证据 | 阻止 finish，要求补证据、确认降级或标记 blocked |
| delegated 无宿主能力 | 阻止开始，要求改为 single-agent 或换宿主 |
| manifest 文件缺失 | 阻止执行或检查，报告缺失路径 |
| 工作区有业务 dirty files | finish 停止，要求按项目 Git 约定处理 |
| spec 候选重复或过宽 | 提醒合并或拒绝，不自动扩写规则库 |

## 8. 验证策略

### 8.1 自动化

- core 单元测试：schema、migration、状态转移、风险建议、归档、inline 审计。
- CLI 集成测试：fixture 中创建 task、记录 TDD red/green、生成 check matrix、finish/archive。
- adapter contract 测试：Codex 和 Claude 对同一 fixture 产生等价 orient、status、check 结构化输出。
- 发布测试：公共 plugin tree 具有两套 manifest、预构建 CLI 和所有 Vinea skills；版本一致；无机器绝对路径。

### 8.2 人工端到端

1. 在 fixture 仓库安装两个插件。
2. Codex 中接受行为变更的 task 建议，确认 tdd 加 single-agent。
3. 记录失败测试、实现和通过测试，停在 in_progress 或 checking。
4. 新 Claude Code 会话运行或触发 vinea:orient，确认并继续同一 task。
5. 执行 vinea:check，验证需求矩阵与 TDD 证据。
6. 按项目流程处理业务提交后 finish，选择一条稳定经验写回 spec，确认其它材料归档。
7. 验证 no-hook/manual-orient 及 delegated 不可用时的提示。

## 9. 首期后的候选能力

不进入首期实现，但保持演进空间：

- 多人 assignee、分支和 PR 元数据、并发 task 协调；
- 其它宿主 adapter；
- CI 中按团队 policy 将 vinea validate 设为强制门禁；
- 可共享的风险 policy profile；
- 与 Issue、ADR、项目管理系统的单向引用或导入；
- 更丰富的规范索引和可视化任务浏览。

仅当 Vinea 已证明能降低跨会话恢复、返工和 review 成本后，再扩展这些能力。
