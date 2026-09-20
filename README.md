# Vinea

[简体中文](README.md) | [English](README.en.md)

Vinea 是面向 AI 编程的轻量协作内核：用户确定目标、约束和交付标准，agent
选择执行路径。任务状态只保存在 Git 共同目录中，在本机多个 worktree 和
agent 间共享，不进入 Git 跟踪、提交或推送。

仓库中提交的公开插件位于 [`plugins/vinea`](plugins/vinea)。它包含一个已经
打包的 Node CLI，以及九个带宿主前缀的技能：`vinea:run`、
`vinea:brainstorm`、`vinea:plan`、`vinea:continue`、`vinea:check`、
`vinea:debug`、`vinea:finish`、`vinea:orient` 和 `vinea:doctor`。

`v1.0.0` 引入本内核重写，与 `v0.3.x` 的阶段命令和任务存储不兼容。
升级不会自动迁移旧 `.vinea`；旧数据保持只读，显式导入也不会继承执行权限。

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
codex plugin marketplace add anlostsheep/vinea --ref v1.0.1
codex plugin add vinea@vinea
```

### Claude Code

```sh
claude plugin marketplace add anlostsheep/vinea
claude plugin install vinea@vinea --scope user
```

固定到精确版本：

```sh
claude plugin marketplace add anlostsheep/vinea@v1.0.1
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
npm run release -- 1.0.2
```

该命令会运行完整检查，只暂存发布产物，创建 release commit 和带注释的
`vX.Y.Z` tag，并且刻意**不会**推送。发布仍是一个需要单独明确批准的操作。
发布说明见 [`CHANGELOG.md`](CHANGELOG.md)。

## 工作流

明确调用 `vinea:run`，或直接说“使用 Vinea 完成这个目标”进入流程。普通
编程请求不自动创建 Vinea 任务。可以直接选择 brainstorm、plan、check 或
debug；这些入口不是必须按顺序经过的阶段。裸 `/vinea` 只是设计中的逻辑
称呼，本包没有注册这一别名。

- `brainstorm` 先查事实，再挑战关键假设；独立决策集中问，有依赖的决策根据
  反馈追问。没有实质决策阻塞就停止，不机械穷尽问题。
- `plan` 交付适量的实现与验证计划。认可方案不等于授权实现。
- `run` 在授权范围内实现、内部调试和验证。TDD、独立 reviewer、分工都按需。
- `continue` 读取当前契约、职责和必要证据。加入不等于接管，更不自动取得
  写权。实例 ID 由 CLI 回显并跨进程复用，不伪造宿主 session ID。
- `check` 独立核验时不修改业务代码；明确委托修复后再用 `debug`。开发中的
  内部自检失败可在原授权内继续修复。
- `debug` 支持只定位或定位并修复。交付后的缺陷建立关联修复任务，不改写
  原交付记录。事实、假设和未验证结论分别保存。
- `finish` 按当前快照、契约和验收证据交付。未提交改动可以交付；提交、部署、
  用户接受与归档是独立操作，学习沉淀不是门禁。

同一物理 worktree 只允许一个业务写入者，多个 worktree 可承担独立分工。
真实派发、等待和取消由宿主完成，Vinea 记录分工、贡献和负责人整合。宿主
能力缺失时明确说明并使用接力，不把状态记录当成已派发 agent。不能确认
旧写入者停止时，仅在授权的隔离 worktree 恢复，旧目录保留 hold。

## 仓库状态与验证

未发布的授权协议 `planning-authorization-v1` 将任务约定与执行权限分开。
持久化 brainstorm/plan 通过 `task document` 保存当前合同版本的 brief/plan；
聊天计划不代替文件。`task authorize` 单独记录用户的明确实施请求、原话和
真实来源，`run` 标签及 `businessWrite` 字段本身不能取得写权。
已有有效授权可以直接接续；明确授权的小任务不强制经过规划阶段。

用户叫停后使用 `task suspend` 撤销授权并使旧令牌失效，只释放本实例当前
工作区的写权，其他未确认停止的写入者保留 hold；代码变更另行核对。
旧任务可读但不自动迁移或补授权，不能换旧 CLI 规避限制。新旧活动状态并存
会被诊断为冲突。授权来源仍由调用方提供，不是宿主认证或文件写入沙箱。

内核恢复写盘与暂停、合同修订使用同一把锁。暂停成功返回才表示撤销生效；
占锁超时不能当作已停止。部分恢复需保持原合同重试，或明确暂停后按中止恢复
处理。缓存令牌参与贡献、快照及交付时仍校验规划文件，旧协议活动任务的
`validate` 返回非零状态，不把“能读取”当作“可以执行”。

运行 `git rev-parse --git-common-dir` 可定位共同目录，状态存储在其中的
`vinea/`。普通仓库通常是 `.git/vinea/`；关联 worktree 的 `.git` 是指向
同一共同目录的文件。本地 Binding 可重建，但删除它不会释放职责。Git
clone 不携带这些状态，不提供跨机器同步。

快照保存所选输入的真实内容，包括新增、删除和未提交文件，排除敏感路径。
证据区分工具采集、agent 报告和用户观察。仅快照相同不能证明命令或环境
相同；旧契约、旧 epoch、缺失 blob 或核验条件不匹配都会拒绝相关操作。

旧 `.vinea` 只经 `legacy inspect` 读取，显式 `legacy import` 导入历史引用；
不修改来源，不继承执行权限或通过结论。历史原始材料仍需保留在来源目录。

检查本机共享状态：

```sh
node plugins/vinea/bin/vinea.mjs validate --json
```

`validate` 只读检查内核状态，缺失、损坏、未完成初始化或占锁时退出非零。
它不替代业务测试，也不把 CI 新 clone 中缺失本地状态当成自动初始化信号。
协议约束合作的 agent，不是阻止任意本地进程写文件的安全沙箱。

完整命令载荷见 [CLI 参考](hosts/public-plugin/CLI.md)，验证边界见
[执行证据](docs/verification/vinea-vnext-execution.md) 与
[真实宿主验收](docs/verification/vinea-vnext-host-acceptance.md)。
宿主拒绝访问共享状态目录时，参见 [最小权限接入说明](hosts/public-plugin/HOSTS.md)；
不要关闭沙箱或另建权威状态。单题实测见 [token/耗时对照](docs/verification/vinea-vnext-benchmark-2026-09-08.md)，当前没有普遍节省 token 的结论。

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
