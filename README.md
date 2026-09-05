# Vinea

[简体中文](README.md) | [English](README.en.md)

Vinea 是一个面向 AI 编程团队的轻量级、文件优先工作流。任务状态保存在
目标 Git 仓库中，因此 Codex 与 Claude Code 可以在新会话中明确地恢复并
继续同一项工作。

仓库中提交的公开插件位于 [`plugins/vinea`](plugins/vinea)。它包含一个已经
打包的 Node CLI，以及八个带宿主前缀的技能：`vinea:orient`、
`vinea:propose`、`vinea:brainstorm`、`vinea:plan`、`vinea:continue`、
`vinea:check`、`vinea:finish` 和 `vinea:doctor`。

## 通过 Git marketplace 安装

公开插件 ID 为 `vinea@vinea`。仓库同时提供两个宿主的清单和预构建 CLI，
用户无需克隆仓库，也无需运行 `npm install`。

### Codex

```sh
codex plugin marketplace add anlostsheep/vinea
codex plugin add vinea@vinea
```

如果要固定到某个精确版本而不是跟随 `main`，请使用带注释的 tag 注册
marketplace：

```sh
codex plugin marketplace add anlostsheep/vinea --ref v0.3.1
codex plugin add vinea@vinea
```

### Claude Code

```sh
claude plugin marketplace add anlostsheep/vinea
claude plugin install vinea@vinea --scope user
```

固定到精确版本：

```sh
claude plugin marketplace add anlostsheep/vinea@v0.3.1
claude plugin install vinea@vinea --scope user
```

无论使用哪种宿主，安装后都要完全重启宿主并开始一个**新会话**。插件文件
已经安装，并不能证明正在运行的旧会话已经加载了技能。请分别验证两种状态：
先运行 `codex plugin list` 或 `claude plugin list`，再确认新会话能够发现
`vinea:orient`。

### 升级、回滚或卸载

Codex 没有单独的插件升级命令。对于跟随 `main` 的 marketplace，请刷新快照
并重新安装插件：

```sh
codex plugin marketplace upgrade vinea
codex plugin remove vinea@vinea
codex plugin add vinea@vinea
```

对于固定版本的 Codex 安装，请先删除旧插件和 marketplace，再添加目标 tag；
要回滚时改用更早的 tag：

```sh
codex plugin remove vinea@vinea
codex plugin marketplace remove vinea
codex plugin marketplace add anlostsheep/vinea --ref v0.3.1
codex plugin add vinea@vinea
```

Claude Code 可以直接刷新 marketplace 和插件：

```sh
claude plugin marketplace update vinea
claude plugin update vinea@vinea --scope user
```

如果要切换 Claude Code 的固定版本，请删除插件和 marketplace，再添加目标
tag 并重新安装。完全卸载 Vinea：

```sh
# Codex
codex plugin remove vinea@vinea
codex plugin marketplace remove vinea

# Claude Code
claude plugin uninstall vinea@vinea --scope user
claude plugin marketplace remove vinea --scope user
```

每次升级、回滚或切换渠道后，都要重启宿主并使用新会话。

## 每个宿主只保留一个渠道

不要在同一个宿主中同时安装 Vinea 的公开插件和开发插件。迁移到公开渠道前，
先删除旧的开发插件：

```sh
# Codex 开发渠道
codex plugin remove vinea@personal

# Claude Code 开发渠道
claude plugin uninstall vinea@vinea-local --scope user
```

然后运行上面的公开安装命令。Vinea 的开发安装脚本会执行反向预检：如果发现
`vinea@vinea`，会在复制文件前停止并输出明确的迁移命令；它们绝不会自动
卸载或禁用插件。

## 本地开发安装

只有在开发 Vinea 或试用尚未发布的改动时，才从 Vinea 工作区运行这些脚本：

```sh
scripts/install-codex-plugin.sh
scripts/install-claude-plugin.sh
```

渠道冲突预检通过后，每个脚本都会运行 `npm run package:plugin`，并将公开
插件树复制到对应宿主的开发 marketplace：

| 宿主 | 公开插件副本 | Marketplace 操作 |
| --- | --- | --- |
| Codex | `~/.codex/plugins/vinea` | 验证已配置的 `personal` 源，添加一个 `+codex.` 构建元数据后缀，然后运行 `codex plugin add vinea@personal`。 |
| Claude Code | `~/.claude/plugins/marketplaces/vinea-local/plugins/vinea` | 校验并刷新 `vinea-local`；如果已经安装 `vinea@vinea-local` 就更新，否则安装。 |

这些脚本不会写入外部凭据或宿主运行时缓存。如果对应 CLI 不存在，脚本只会
准备并打印准确的本地文件和手动命令，不会宣称插件已经激活。无论在哪个宿主，
安装或更新后都要开始一个**新会话**：已经安装的技能和插件不会热加载。

如果只想在一个 Claude Code 会话中试用而不安装，也可以使用宿主自身提供的
`--plugin-dir` 选项；这是宿主功能，不是 Vinea 的安装渠道。

## 发布版本策略

根目录 `package.json` 是发布版本的唯一来源。两个宿主的插件清单和 Codex
marketplace 都携带生成后的版本。Claude marketplace 的插件条目会刻意省略
重复的 `version`，因此 Claude Code 从 `.claude-plugin/plugin.json` 解析
版本；目录元数据仍可以展示发布版本。

兼容性修复和文档使用 patch 版本，兼容性能力使用 minor 版本，不兼容契约
使用 major 版本。在干净的 `main` 工作区中创建本地发布（允许存在未暂存的
`.vinea/` 任务状态）：

```sh
npm run release -- patch|minor|major
npm run release -- 0.3.1
```

该命令会运行完整检查，只暂存发布产物，创建 release commit 和带注释的
`vX.Y.Z` tag，并且刻意**不会**推送。发布仍是一个需要单独明确批准的操作。
发布说明见 [`CHANGELOG.md`](CHANGELOG.md)。

## 工作流

每次开始新会话或对上下文不确定时，先使用 `vinea:orient`。首次发布的恢复
流程刻意保持显式：没有 hook 会在后台自动绑定任务。只有当 Codex 确实提供
非空 `CODEX_THREAD_ID` 时，技能才会将其作为 `--session-id` 传入并创建
会话绑定。没有这个值时，Codex 与 Claude Code 一样，都会显示候选任务并
要求用户明确确认。此版本中 Claude 没有 Vinea 会话 ID 的环境变量回退。

一个精简的中风险生命周期如下：

1. 使用 `vinea:propose`，审阅风险和执行模式选项，只有在用户确认后才创建
   任务。
2. 只在确实存在重要设计选择时使用 `vinea:brainstorm`。它把当前所有阻塞
   决策放在同一轮，每项给出 2–3 个选项、推荐和取舍，批准后再写 brief/plan。
   使用 `vinea:plan` 记录实现和质量选择；未定的 TDD 与执行模式也并进一轮。
3. 对用户确认采用 TDD 的任务，先记录一次真实失败的 `tdd-red`，实现后再
   记录通过的 `tdd-green`。TDD 是可选项，不是默认要求。
4. 使用 `vinea:check`，以观察到的证据覆盖每项需求。在执行
   `vinea:finish` 和 `vinea:archive` 前，先按仓库自身工作流提交或妥善处理
   业务 Git 改动。
5. `vinea:finish` 可以提出学习候选，但不会自行推广。可复用学习必须由用户
   明确接受，否则随任务归档。

委派同样是可选项。它需要用户确认，并要求宿主确实能够提供所需角色：研究和
检查 agent 保持只读，只由一个实现者写业务文件。如果宿主无法支持，Vinea
会请求改用单 agent 或其他宿主，不会静默替换执行模式。

## 仓库状态与验证

Vinea 只写入目标仓库的 `.vinea/` 目录。工作区、任务记录、产物和运行时指针
都带有明确的 schema 版本；遇到尚不支持的新版本时会报告错误，不会静默改写。
活动任务位于 `.vinea/tasks/active/<task-id>/`，完成后的任务记录会移动到
`.vinea/tasks/archive/<task-id>/`。只有用户明确接受后，可复用规则才会写入
`.vinea/specs/`。

如果要在 CI 中检查 Vinea 状态，请使用与宿主无关的校验器：

```sh
node plugins/vinea/bin/vinea.mjs validate --json
```

`validate` 只读取版本化的 Vinea 状态和本地会话指针，不写入文件，也不依赖
AI 宿主。它不能替代使用方项目自己的单元测试、集成测试、lint、构建或部署
检查；这些检查需要单独配置。

Vinea 刻意不提供 MCP server、daemon、hook、app 或云服务。

## 开发与分发检查

```sh
npm install
npm run check
npm run package:plugin
npm run check:plugin
```

直接运行开发版或打包后的 CLI：

```sh
node dist/vinea.mjs --help
node plugins/vinea/bin/vinea.mjs --help
```
