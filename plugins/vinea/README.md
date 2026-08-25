# Vinea

[简体中文](README.md) | [English](README.en.md)

Vinea 是一个面向 AI 编程的共享、文件优先任务工作流。Codex 与 Claude Code
从目标 Git 仓库读取同一份 `.vinea/` 状态，因此新会话可以明确地定位、确认
并继续同一项任务。

## 为宿主安装

公开插件 ID 为 `vinea@vinea`。

Codex：

```sh
codex plugin marketplace add anlostsheep/vinea
codex plugin add vinea@vinea
```

固定到 0.3.1：

```sh
codex plugin marketplace add anlostsheep/vinea --ref v0.3.1
codex plugin add vinea@vinea
```

Claude Code：

```sh
claude plugin marketplace add anlostsheep/vinea
claude plugin install vinea@vinea --scope user
```

固定到 0.3.1：

```sh
claude plugin marketplace add anlostsheep/vinea@v0.3.1
claude plugin install vinea@vinea --scope user
```

## 升级、回滚或卸载

对于跟随 `main` 的 Codex marketplace，请刷新并重新安装：

```sh
codex plugin marketplace upgrade vinea
codex plugin remove vinea@vinea
codex plugin add vinea@vinea
```

对于固定版本的 Codex 安装，请将 marketplace 替换为目标 tag；要回滚时改用
更早的 tag：

```sh
codex plugin remove vinea@vinea
codex plugin marketplace remove vinea
codex plugin marketplace add anlostsheep/vinea --ref v0.3.1
codex plugin add vinea@vinea
```

Claude Code 可以直接更新跟随 marketplace 的安装：

```sh
claude plugin marketplace update vinea
claude plugin update vinea@vinea --scope user
```

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
```

然后再单独确认新会话能够发现 `vinea:orient`。插件文件已经安装，并不能
证明正在运行的旧会话已经加载了技能。

完整生命周期和本地开发说明见仓库 README：
<https://github.com/anlostsheep/vinea#readme>。

## 开始或恢复工作

新会话开始时使用 `vinea:orient`。它以只读方式检查状态，并在继续前要求
确认。中高风险变更使用 `vinea:propose`；只有存在重要设计选择时才使用
`vinea:brainstorm`；完成前使用 `vinea:check`；使用 `vinea:finish` 执行
完成和学习门禁。

这些技能使用插件内置的 CLI。从插件根目录可直接运行：

```sh
node bin/vinea.mjs --help
node bin/vinea.mjs orient --host codex --json
```

CLI 只在目标仓库中保存状态。Vinea 不提供 MCP server、daemon、hook、app
或云服务。
