# Vinea 0.2.0 插件发布设计

**日期：** 2026-08-04

**状态：** 设计已确认，等待用户审阅后实施

**范围：** 公共插件品牌标识、带版本的打包契约、本地 Codex／Claude Code 刷新流程，以及一条过期测试断言

## 预期结果

将既有的 schema v2 检查／返工能力以 **Vinea 0.2.0** 正式发布，并配套一套能够表达 Vinea 核心承诺的视觉标识：共享任务能够进入检查、暴露缺陷、安全回到实施，并以新的证据完成闭环，同时保留原有历史。

本次发布必须通过两个宿主各自的插件管理流程更新本地安装，而不是把文件复制到运行时缓存。今后凡是会进入分发插件的内容变更，都必须同时完成符合语义化版本规范的版本号递增。

## 视觉方向：Vine Loop

已确认的图标为紧凑的 **Vine Loop**：

- 近黑色、柔和圆角的方形底面，适配现有深色插件目录；
- 薄荷绿／青绿色的连续环线，表达可恢复的推进与被保留的历史；
- 中央小型白色 `V`，确保在 24–48 px 下仍能立即识别产品；
- 克制的色彩与构图，使其呈现工程工具标识，而非插画。

仓库保留可编辑的 SVG 母版 `assets/vinea-loop.svg`。打包流程会在公共插件树中生成透明 PNG，例如 `plugins/vinea/assets/vinea-loop.png`。Codex 模板通过相对于插件根目录的路径引用该文件，分别填入 `composerIcon`、`logo` 和 `logoDark`。

本次发布不会向 Claude Code manifest 添加图像字段：其字段兼容性尚未验证。共享图标仍会包含在插件包中，但 Claude 的 manifest 保持在已知、受支持的 schema 范围内。

## 版本与打包契约

`package.json` 继续作为唯一权威版本来源。打包脚本必须将完全相同的版本写入：

- Codex 插件 manifest；
- Claude Code 插件 manifest；
- 两份生成的 marketplace 记录；
- 构建后的公共插件树。

本次变更为 **0.1.0 → 0.2.0**。它属于 minor 版本，因为已开发完成且向后兼容的能力将首次以正确的公开版本发布。

今后每一次进入分发插件的修改，发布者都必须在同一变更中更新根语义化版本：

| 变更类型 | 必须递增 |
| --- | --- |
| 兼容的视觉、文档、打包或缺陷修复 | patch |
| 兼容的工作流或能力扩展 | minor |
| 不兼容的公开契约或迁移边界 | major |

不会成为分发产物的本地试验不需要版本递增。校验会确保唯一版本来源与所有生成 manifest 可测试且一致；它无法从任意 Git diff 推断某项修改是否有意不发布，因此版本规则仍应作为明确的仓库发布政策执行。

## 宿主刷新契约

### Codex

刷新脚本会构建公共插件，只替换已声明的本地 marketplace 源，运行本地 Codex 插件工具要求的 cache-buster，然后调用 Codex 的 marketplace／插件注册命令。它不得手工写入或同步运行时插件缓存。验证将执行 `codex plugin list`，并检查已安装包的 manifest、版本与图标资源路径。

### Claude Code

刷新脚本会构建公共插件，替换已声明的本地 marketplace 源，校验插件，刷新本地 marketplace，并执行 `claude plugin update vinea@vinea-local --scope user`。若插件尚未安装，才允许回退到受支持的安装命令。验证将执行 `claude plugin list`，并检查已安装包的 manifest、版本与图标资源路径。Claude Code 需要启动一个新会话，已加载的 skill 才会反映更新。

## 既有测试回归

返工生命周期发布已向 `doctor --json` 添加 `migration` 与 `rework` 信息。生产行为正确，但 `tests/core/schema.test.ts` 仍断言旧对象结构，因而造成一条基线测试失败。本次发布只做这条精确的断言修复，不改变 doctor 输出或生命周期行为。

## 测试优先的实施与验证

1. 扩展聚焦的插件打包／安装脚本测试，使图标、manifest、版本和宿主刷新契约在生产代码修改前先失败。
2. 将过期的 doctor JSON 断言更新为正确的基线契约，并确认相应聚焦测试转绿。
3. 以小步增量加入图标、打包、manifest 与刷新脚本实现；每一步都重新运行聚焦测试。
4. 执行 `npm run typecheck`、`npm test`、`npm run build`、`npm run package:plugin`、`npm run check:plugin` 和 `npm run check`。
5. 使用本地插件校验器验证产物，执行两个受支持的本地刷新流程，再通过两个宿主 CLI 与安装树核对实际版本和打包图标路径。

## 边界

- 本次发布不包含新的工作流行为、数据迁移、远程发布、GitHub 身份认证或浏览器交互。
- 不添加未经验证的 Claude manifest 扩展字段。
- 不手工复制到 Codex 或 Claude 的运行时缓存。
- 改动范围仅限图标资源、manifest、打包／校验／安装脚本、相关测试、生成的公共产物、发布文档与 Vinea 任务记录。
