# Vinea

[简体中文](README.md) | [English](README.en.md)

Vinea 是面向 Codex、Claude Code 和 Grok Build 的轻量协作内核。用户确定目标和约束，agent 选择执行
路径。本机 worktree 在 Git 共同目录的 `vinea/` 共享状态，不进入 Git 跟踪。

`v1.0.0` 引入本内核重写，与 `v0.3.x` 的阶段命令和任务存储不兼容。
安装或升级不自动迁移旧 `.vinea`；显式导入旧资料不会继承执行权限。

**2.0.0 是不兼容升级。** 新任务固定执行授权协议；1.0.x 活动任务保持可读，
但缺少该协议时不会获得写权，验证会返回 blocked。升级不迁移任务，也不
继承旧授权。升级前停止或完成旧执行，核对占用；不要换旧 CLI 绕过门禁。

## 为宿主安装

公开插件 ID 为 `vinea@vinea`。

Codex：

```sh
codex plugin marketplace add anlostsheep/vinea
codex plugin add vinea@vinea
```

固定到 2.0.1：

```sh
codex plugin marketplace add anlostsheep/vinea --ref v2.0.1
codex plugin add vinea@vinea
```

Claude Code：

```sh
claude plugin marketplace add anlostsheep/vinea
claude plugin install vinea@vinea --scope user
```

固定到 2.0.1：

```sh
claude plugin marketplace add anlostsheep/vinea@v2.0.1
claude plugin install vinea@vinea --scope user
```

Grok Build 可读取本包的 Claude 兼容清单，添加源后再显式安装：

```sh
grok plugin marketplace add anlostsheep/vinea
grok plugin install vinea --trust
```

`--trust` 只用于可信来源；仅添加 marketplace 不会安装或启用插件。

## 升级、回滚或卸载

对于跟随 `main` 的 Codex marketplace，请刷新并重新安装：

```sh
codex plugin marketplace upgrade vinea
codex plugin add vinea@vinea
```

对于固定版本的 Codex 安装，请将 marketplace 替换为目标 tag；要回滚时改用
更早的 tag：

```sh
codex plugin remove vinea@vinea
codex plugin marketplace remove vinea
codex plugin marketplace add anlostsheep/vinea --ref v1.0.1
codex plugin add vinea@vinea
```

Claude Code 可以直接更新跟随 marketplace 的安装：

```sh
claude plugin marketplace update vinea
claude plugin update vinea@vinea --scope user
```

Grok Build 更新对应源与插件：

```sh
grok plugin marketplace update vinea
grok plugin update vinea
grok plugin list
```

更新版本不等于启用插件，应保留用户原来的启用/禁用选择。
回滚代码不回滚任务状态，不能让旧 writer 操作新协议数据。

对于固定版本的 Claude Code 安装，请删除插件和 marketplace，添加目标 tag
后重新安装。完全卸载 Vinea：

```sh
# Codex
codex plugin remove vinea@vinea
codex plugin marketplace remove vinea

# Claude Code
claude plugin uninstall vinea@vinea --scope user
claude plugin marketplace remove vinea --scope user
```

## 从开发渠道迁移

每个宿主只保留一个 Vinea 渠道。使用公开渠道前，先删除对应的开发插件：

```sh
# Codex 开发渠道
codex plugin remove vinea@personal

# Claude Code 开发渠道
claude plugin uninstall vinea@vinea-local --scope user
```

然后运行上面的公开安装命令。Vinea 绝不会自动卸载或禁用其他插件。

## 验证安装与加载

每次安装、升级、回滚或切换渠道后，都要完全重启宿主，并在目标 Git 仓库中
开始一个**新会话**。先验证安装状态：

```sh
codex plugin list
claude plugin list
grok plugin list
```

然后再单独确认新会话能够发现 `vinea:orient`。插件文件已经安装，并不能
证明正在运行的旧会话已经加载了技能。

完整生命周期和本地开发说明见仓库 README：
<https://github.com/anlostsheep/vinea#readme>。

## 开始或恢复工作

明确使用 `vinea:run` 或说“使用 Vinea 完成目标”。普通请求不会自动进入。
九个入口为 run、brainstorm、plan、continue、check、debug、finish、orient、
doctor，均带 `vinea:` 前缀；没有注册裸 `/vinea` 别名。

可以只讨论、只规划、只检查或只定位问题；认可方案不自动授权实现。
`continue` 支持跨 agent 只读加入和明确交接，加入不等于取得写权。一个
物理 worktree 只有一个业务写入者，不确定旧写入者停止时必须隔离恢复，
旧目录保留 hold。真实派发和等待由宿主提供，Vinea 不伪造这些能力。

`check` 不自动修复业务代码；`debug` 按委托定位或修复，交付后建立关联
修复任务，不改写旧交付。`finish` 允许未提交代码，证据必须匹配当前输入
和核验条件，接受的缺口仍是缺口。提交、部署、用户接受和归档分别处理。

新任务固定授权协议；持久规划通过 `task document` 保存 brief/plan，
`task authorize` 单独记录明确实施请求与真实来源，再申请 claim。
“继续下一步”及认可计划不自动授权业务写入。叫停后用 `task suspend`
撤销授权并核对代码与其他 writer，不能用旧 `planning` 状态冒充恢复。
旧任务不自动迁移；不要更换旧 CLI。来源记录不是宿主认证或物理写入拦截。

这些技能使用插件内置的 CLI。从插件根目录可直接运行：

```sh
node bin/vinea.mjs --help
node bin/vinea.mjs orient --json
```

业务命令从目标 Git worktree 运行，使用插件 CLI 的绝对路径；完整结构化
载荷见 [CLI 参考](CLI.md)。Actor ID 从 CLI 回显中复用，不伪造宿主 ID。
快照保存真实文件内容，旧格式只读检查后显式导入，导入不授予执行权限。
Vinea 不提供跨机器同步、MCP server、daemon、hook、app 或云服务。

如果宿主拒绝写入共享状态，按 [宿主接入说明](HOSTS.md) 为实际状态目录取得
明确授权；不要关闭沙箱、借用他人身份或静默离开 Vinea 继续修改业务代码。
