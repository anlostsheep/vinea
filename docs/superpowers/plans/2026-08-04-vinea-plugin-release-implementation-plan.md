# Vinea 0.2.0 插件发布实施计划

> **面向 agentic 执行者：** 必须使用 `superpowers:executing-plans` 按任务逐项实施；所有步骤使用复选框追踪。当前 Vinea 任务已确认 `tdd` 与 `single-agent`，不得切换为委派执行，除非用户明确修改该选择。

**目标：** 以 0.2.0 发布 Vinea 的既有返工闭环能力，加入已批准的 Vine Loop 图标，并将 Codex／Claude Code 的本地插件刷新收敛到各宿主支持的更新路径。

**架构：** `package.json` 是唯一发布版本来源；打包脚本从宿主模板和静态资源生成 `plugins/vinea` 与两份 marketplace 元数据。Codex 的本地更新通过已配置个人 marketplace 的 source、单一 cache-buster 与 `codex plugin add` 重新安装；Claude Code 通过 marketplace refresh 后优先 `claude plugin update`，只在未安装时回退 install。图标保留 SVG 母版，并向公共插件包复制 PNG 产物。

**技术栈：** Node.js 18.18+、TypeScript、Vitest、Bash、SVG、macOS `sips`、Codex CLI、Claude Code CLI。

## 全局约束

- 根 `package.json` 的版本必须从 `0.1.0` 更新为精确的 `0.2.0`；打包后的 Codex manifest、Claude manifest 与两份 marketplace 元数据必须等于 `0.2.0`。
- Codex 已安装副本允许带一个由 `update_plugin_cachebuster.py` 生成的 `+codex.` build metadata 后缀；它只用于让 Codex 重新加载，不得改变根发布版本或公共插件包版本。
- Codex manifest 只能把 `composerIcon`、`logo`、`logoDark` 都指向 `./assets/vinea-loop.png`；Claude Code manifest 不新增未经验证的图像字段。
- 不新增 npm 或系统依赖；PNG 由仓库内 SVG 使用现有 macOS `sips` 生成并提交。
- 不使用浏览器、GitHub 身份认证、远程发布或手工同步宿主运行时缓存。允许原子替换已声明的本地 marketplace source。
- Codex 的默认个人 marketplace 不调用 `codex plugin marketplace add`，也不在更新路径中改写其 marketplace JSON；当前已确认的更新命令是 cache-buster 后的 `codex plugin add vinea@personal`。
- Claude Code 已安装 Vinea 时必须先使用 `claude plugin update vinea@vinea-local --scope user`；只有 `claude plugin list` 证明确实未安装时才使用 install 回退。
- 先让聚焦测试失败，再写最小实现；记录一条 `tdd-red` 与一条 `tdd-green` Vinea 证据。任何没有合理失败测试的步骤必须停止并说明原因，不能静默降级。
- 只提交当前任务的源文件、测试、生成的公共插件产物、文档与 Vinea 任务记录；不提交本机 marketplace、缓存、凭据或临时文件。

---

## 文件结构与职责

| 路径 | 操作 | 职责 |
| --- | --- | --- |
| `tests/core/schema.test.ts` | 修改 | 将健康 workspace 的 doctor JSON 契约更新为 schema v2 已有字段。 |
| `assets/vinea-loop.svg` | 新建 | 可编辑的 1024×1024 Vine Loop 图标母版。 |
| `assets/vinea-loop.png` | 新建 | 由 SVG 生成、供宿主 manifest 消费的 PNG。 |
| `package.json` | 修改 | 将唯一发布版本设为 `0.2.0`。 |
| `hosts/codex/.codex-plugin/plugin.json` | 修改 | 声明三个有效的相对 PNG 图标路径。 |
| `scripts/package-public-plugin.mjs` | 修改 | 把 PNG 复制到公共插件的 `assets/` 目录。 |
| `scripts/check-public-plugin.mjs` | 修改 | 校验 Codex 图标字段与真实文件，并把二进制 PNG 排除在 UTF-8 文本扫描之外。 |
| `tests/plugin/package.test.ts` | 修改 | 以测试约束 0.2.0、图标源文件、PNG 魔数、已打包图标及三个 manifest 字段。 |
| `scripts/install-codex-plugin.sh` | 修改 | 从已有个人 marketplace source 刷新 Vinea、加 cache-buster 并重装，不改 marketplace 条目。 |
| `scripts/install-claude-plugin.sh` | 修改 | 通过 marketplace update 后优先更新已安装插件，并仅对未安装情形回退 install。 |
| `tests/plugin/install-scripts.test.ts` | 修改 | 静态约束两份脚本的宿主更新行为与无凭据原则。 |
| `README.md` | 修改 | 说明版本递增政策、两条刷新路径与新会话要求。 |
| `plugins/vinea/**`、`.agents/plugins/marketplace.json`、`.claude-plugin/marketplace.json` | 生成并提交 | 可分发的 0.2.0 公共插件及与根版本一致的元数据。 |
| `.vinea/tasks/active/t-20260804-070507-release-vinea-0-2-0-icon-and-host-update-workflow/**` | 由 CLI 修改 | 保存需求、TDD、命令证据、回归矩阵和后续检查记录。 |

### Task 1：修复既有 doctor JSON 基线断言

**Files:**

- Modify: `tests/core/schema.test.ts:22-34`
- Test: `tests/core/schema.test.ts:14-35`

**Interfaces:**

- Consumes: `diagnoseWorkspace()` 已返回的 `DoctorReport.rework: ReworkDiagnostic[]` 与 `DoctorReport.migration: { status: "none" | "pending" | "completed" | "invalid" }`。
- Produces: 对健康 schema-v2 workspace 的完整 JSON 契约；不触碰 `src/core/doctor.ts`。

- [x] **Step 1：先复现当前基线失败**

  Run:

  ```bash
  npx vitest run tests/core/schema.test.ts
  ```

  Expected: 第一个测试失败，实际 JSON 比期望值多出 `rework: []` 与 `migration: { status: "none" }`；其余 doctor schema 测试保持通过。

- [x] **Step 2：只修正过期的期望对象**

  在 `taskLocks` 后、`gitStatus` 前加入已由生产代码输出的两个字段：

  ```ts
  taskLocks: [],
  rework: [],
  migration: {
    status: "none",
  },
  gitStatus: {
    available: true,
    error: null,
  },
  ```

  不修改 `src/core/doctor.ts`、schema 类型或 CLI 输出顺序。

- [x] **Step 3：确认聚焦测试转绿**

  Run:

  ```bash
  npx vitest run tests/core/schema.test.ts
  ```

  Expected: 3 个测试全部 PASS。

- [x] **Step 4：提交独立的测试契约修复**

  ```bash
  git add tests/core/schema.test.ts
  git diff --staged --check
  git commit -m "test: repair doctor JSON contract"
  ```

### Task 2：以测试优先方式实现 0.2.0 图标、打包和校验契约

**Files:**

- Create: `assets/vinea-loop.svg`
- Create: `assets/vinea-loop.png`
- Modify: `package.json:1-21`
- Modify: `hosts/codex/.codex-plugin/plugin.json:11-24`
- Modify: `scripts/package-public-plugin.mjs:18-27`
- Modify: `scripts/check-public-plugin.mjs:21-25,49-58,87-110`
- Modify: `tests/plugin/package.test.ts:1-102`
- Generated: `plugins/vinea/.codex-plugin/plugin.json`, `plugins/vinea/assets/vinea-loop.png`, both generated marketplace JSON files

**Interfaces:**

- Consumes: root `package.json.version`, source icon `assets/vinea-loop.png`, and the Codex `interface` object.
- Produces: public package path `./assets/vinea-loop.png`; every consumer of the three Codex icon fields uses that exact string.

- [x] **Step 1：先为 0.2.0 和图标输出写失败测试**

  扩展 `tests/plugin/package.test.ts`。在读取根 `package.json` 后加入精确版本断言；在已打包 manifest 断言后加入三个图标字段、源 SVG、打包 PNG 和 PNG signature 的断言：

  ```ts
  const expectedReleaseVersion = "0.2.0";
  const iconRelativePath = "./assets/vinea-loop.png";
  const iconSourcePath = join(repositoryRoot, "assets", "vinea-loop.svg");
  const packagedIconPath = join(publicRoot, "assets", "vinea-loop.png");

  expect(rootPackage.version).toBe(expectedReleaseVersion);
  expect(codexManifest.interface).toMatchObject({
    composerIcon: iconRelativePath,
    logo: iconRelativePath,
    logoDark: iconRelativePath,
  });
  expect(await readFile(iconSourcePath, "utf8")).toContain('viewBox="0 0 1024 1024"');
  expect((await readFile(packagedIconPath)).subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  ```

- [x] **Step 2：运行测试，确认新契约确实先失败**

  Run:

  ```bash
  npx vitest run tests/plugin/package.test.ts
  ```

  Expected: FAIL，至少显示根版本仍是 `0.1.0`，且 `assets/vinea-loop.svg`／公共 PNG 尚不存在；不要在失败前创建任何图标或改 manifest。

- [x] **Step 3：更新版本、创建 Vine Loop SVG 并生成 PNG**

  将 `package.json` 的 `version` 设为 `0.2.0`。创建如下 1024×1024 SVG 母版，使用深色圆角底面、青绿色闭环和白色 V：

  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">
    <defs>
      <linearGradient id="loop" x1="250" y1="230" x2="790" y2="790" gradientUnits="userSpaceOnUse">
        <stop stop-color="#94F6D8"/>
        <stop offset="1" stop-color="#27B6A4"/>
      </linearGradient>
    </defs>
    <rect x="40" y="40" width="944" height="944" rx="240" fill="#101B22"/>
    <rect x="64" y="64" width="896" height="896" rx="216" stroke="#263A45" stroke-width="8"/>
    <path d="M512 220C361 220 238 341 238 490C238 639 361 760 512 760C663 760 786 639 786 490C786 341 663 220 512 220Z" stroke="url(#loop)" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M398 420L512 638L626 420" stroke="#F7FCFC" stroke-width="68" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  ```

  从仓库根执行：

  ```bash
  mkdir -p assets
  sips -s format png assets/vinea-loop.svg --out assets/vinea-loop.png
  sips -g pixelWidth -g pixelHeight assets/vinea-loop.png
  ```

  Expected: PNG 的 `pixelWidth` 与 `pixelHeight` 都是 `1024`。

- [x] **Step 4：实现最小的 manifest、打包与公共检查改动**

  在 Codex 模板的 `interface` 中加入：

  ```json
  "composerIcon": "./assets/vinea-loop.png",
  "logo": "./assets/vinea-loop.png",
  "logoDark": "./assets/vinea-loop.png"
  ```

  在 `scripts/package-public-plugin.mjs` 创建公共 `assets/` 目录并复制 PNG：

  ```js
  await mkdir(join(publicRoot, "assets"), { recursive: true });
  await cp(join(projectRoot, "assets", "vinea-loop.png"), join(publicRoot, "assets", "vinea-loop.png"));
  ```

  将调用点改为 `await assertCodexInterface(codexManifest.interface, publicRoot)`，并把 `assertCodexInterface` 改为接收 `publicRoot` 的异步函数。它对三个字段执行同一个固定路径与存在性校验：

  ```js
  const iconRelativePath = "./assets/vinea-loop.png";
  for (const field of ["composerIcon", "logo", "logoDark"]) {
    if (interfaceMetadata[field] !== iconRelativePath) {
      throw new Error(`Codex interface ${field} must be ${iconRelativePath}.`);
    }
  }
  await access(join(publicRoot, "assets", "vinea-loop.png"));
  ```

  保留本地路径／未解析脚手架标记扫描，但只对 `.json`、`.md`、`.mjs` 与 `LICENSE` 执行 UTF-8 `readFile`；PNG 只由独立存在性检查处理。例如：

  ```js
  import { basename, join } from "node:path";

  const publicTextPaths = (await walkFiles(publicRoot)).filter((path) =>
    [".json", ".md", ".mjs"].some((extension) => path.endsWith(extension)) || basename(path) === "LICENSE",
  );
  ```

- [x] **Step 5：验证聚焦测试和发布校验均转绿**

  Run:

  ```bash
  npx vitest run tests/plugin/package.test.ts
  npm run package:plugin
  npm run check:plugin
  python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/vinea
  ```

  Expected: package 测试 PASS，公共包含 PNG、两份 public manifest 为 `0.2.0`，`check:plugin` 与插件校验器均 PASS。

- [x] **Step 6：记录 TDD red/green 并提交图标与打包契约**

  在 Step 2 的失败命令后记录 `tdd-red`；在 Step 5 的成功命令后记录 `tdd-green`。使用当前任务 ID，不记录完整命令输出或任何凭据：

  ```bash
  node plugins/vinea/bin/vinea.mjs evidence record t-20260804-070507-release-vinea-0-2-0-icon-and-host-update-workflow --kind tdd-red --summary "Vinea 0.2.0 package icon contract failed before implementation." --command "npx vitest run tests/plugin/package.test.ts" --exit-code 1 --result fail --json
  node plugins/vinea/bin/vinea.mjs evidence record t-20260804-070507-release-vinea-0-2-0-icon-and-host-update-workflow --kind tdd-green --summary "Vinea 0.2.0 package icon contract passed after implementation." --command "npx vitest run tests/plugin/package.test.ts" --exit-code 0 --result pass --json
  git add package.json assets/vinea-loop.svg assets/vinea-loop.png hosts/codex/.codex-plugin/plugin.json scripts/package-public-plugin.mjs scripts/check-public-plugin.mjs tests/plugin/package.test.ts plugins/vinea .agents/plugins/marketplace.json .claude-plugin/marketplace.json
  git diff --staged --check
  git commit -m "feat: add Vinea release icon"
  ```

### Task 3：改用宿主支持的更新路径，并文档化版本规则

**Files:**

- Modify: `scripts/install-codex-plugin.sh:5-95`
- Modify: `scripts/install-claude-plugin.sh:5-78`
- Modify: `tests/plugin/install-scripts.test.ts:16-55`
- Modify: `README.md:12-35,94-107`

**Interfaces:**

- Consumes: 当前用户已安装的 `vinea@personal` source `~/.codex/plugins/vinea` 与当前 Claude `vinea-local` marketplace。
- Produces: Codex 重装时带一个 `0.2.0+codex.` build metadata 后缀的本地 manifest；Claude 更新后的 `0.2.0` manifest；两份脚本都要求启动新会话。

- [x] **Step 1：先扩展安装脚本静态测试**

  将 Codex 测试改为要求 cache-buster 和重装、禁止默认个人 marketplace 的 add／手工 entry 写入：

  ```ts
  expect(source).toContain("update_plugin_cachebuster.py");
  expect(source).toContain("codex plugin add");
  expect(source).not.toContain("codex plugin marketplace add");
  expect(source).not.toContain("marketplace.plugins = marketplace.plugins.filter");
  ```

  将 Claude 测试改为要求已安装时的 update 和明确的 install fallback：

  ```ts
  expect(source).toContain("claude plugin list");
  expect(source).toContain("claude plugin update vinea@vinea-local --scope user");
  expect(source).toContain("claude plugin install vinea@vinea-local --scope user");
  ```

- [x] **Step 2：运行脚本测试，确认旧实现失败**

  Run:

  ```bash
  npx vitest run tests/plugin/install-scripts.test.ts
  ```

  Expected: FAIL；现有 Codex 脚本仍调用 `codex plugin marketplace add` 并改写个人 marketplace，现有 Claude 脚本仍直接 install。

- [x] **Step 3：实现 Codex 的 cache-buster + 重装路径**

  保留将 `plugins/vinea` 原子复制到 `$home_dir/.codex/plugins/vinea` 的步骤，因为它是已配置个人 marketplace 的 source，不是运行时缓存同步。删除写入 `$home_dir/.agents/plugins/marketplace.json` 的内嵌 Node 程序，改为只读验证：文件存在、包含 name 为 `vinea` 的 local entry，且其 source path 是 `./.codex/plugins/vinea`；输出已有 `marketplace.name`。

  定义并验证本机插件工具脚本，然后在重装前调用：

  ```bash
  cachebuster_script="$home_dir/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py"
  if [[ ! -f "$cachebuster_script" ]]; then
    printf 'Codex plugin cachebuster helper is unavailable at %s.\n' "$cachebuster_script" >&2
    exit 1
  fi
  python3 "$cachebuster_script" "$plugin_root"
  codex plugin add "vinea@$marketplace_name"
  ```

  CLI 不可用时打印同样两条手动命令，且不打印 `codex plugin marketplace add`。不要以递增 `package.json` patch 版本代替 cache-buster。

- [x] **Step 4：实现 Claude Code 的 update-first 路径**

  保留专用 `vinea-local` marketplace 的构建、插件校验与 `claude plugin marketplace update vinea-local`。在此之后用已安装插件列表决定操作：

  ```bash
  if claude plugin list | grep -Fq "vinea@vinea-local"; then
    claude plugin update vinea@vinea-local --scope user
  else
    claude plugin install vinea@vinea-local --scope user
  fi
  ```

  不要将 update 失败一概吞掉后直接 install：只有列表确认未安装时才能走 fallback。保留 `claude plugin validate "$plugin_root"` 与新会话提示。

- [x] **Step 5：更新根 README 的发布与刷新说明**

  在 “Install locally” 前加入 `## 发布版本规则`：所有会进入 `plugins/vinea` 的内容变更必须在同一提交更新根 semver；兼容修复／视觉或文档变更递增 patch，兼容能力递增 minor，不兼容契约递增 major；本次为 `0.2.0`。

  将安装表更新为下列行为，避免描述过时的 `marketplace add` 或每次直接 install：

  | Host | 已配置本地源 | 刷新动作 |
  | --- | --- | --- |
  | Codex | `~/.codex/plugins/vinea` | 更新 source、加单一 `+codex.` build metadata，执行 `codex plugin add vinea@personal`。 |
  | Claude Code | `~/.claude/plugins/marketplaces/vinea-local/plugins/vinea` | 校验并刷新 marketplace；已安装时执行 `claude plugin update vinea@vinea-local --scope user`，否则 install。 |

  明确两端都需要新的会话，且脚本从不写入凭据或运行时 cache。

- [x] **Step 6：验证脚本语法与聚焦测试转绿**

  Run:

  ```bash
  bash -n scripts/install-codex-plugin.sh
  bash -n scripts/install-claude-plugin.sh
  npx vitest run tests/plugin/install-scripts.test.ts
  ```

  Expected: 两份 Bash 脚本语法正确；2 个安装脚本测试 PASS。

- [x] **Step 7：提交宿主刷新和文档改动**

  ```bash
  git add scripts/install-codex-plugin.sh scripts/install-claude-plugin.sh tests/plugin/install-scripts.test.ts README.md
  git diff --staged --check
  git commit -m "fix: refresh Vinea through host plugin workflows"
  ```

### Task 4：构建发布产物、执行双宿主刷新并形成回归证据

**Files:**

- Modify/generated: `plugins/vinea/**`, `.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json`
- Modify via CLI: `.vinea/tasks/active/t-20260804-070507-release-vinea-0-2-0-icon-and-host-update-workflow/{evidence.jsonl,check.md,journal.md,task.json}`

**Interfaces:**

- Consumes: Task 1–3 的已提交源变更、当前个人 Codex marketplace 和现有 `vinea-local` Claude marketplace。
- Produces: 通过完整检查的公共 Vinea 0.2.0 产物；Codex 本机显示带 cache-buster 的 0.2.0、Claude Code 本机显示 0.2.0；按 R1–R5 覆盖的 Vinea 检查矩阵。

- [x] **Step 1：重新生成并检查所有分发元数据**

  Run:

  ```bash
  npm run package:plugin
  node --input-type=module -e 'import { access, readFile } from "node:fs/promises"; const files = ["plugins/vinea/.codex-plugin/plugin.json", "plugins/vinea/.claude-plugin/plugin.json", ".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json"]; for (const file of files) { const value = JSON.parse(await readFile(file, "utf8")); const version = value.version ?? value.metadata?.version ?? value.plugins?.[0]?.version; if (version !== "0.2.0") throw new Error(`${file} is ${version}`); } await access("plugins/vinea/assets/vinea-loop.png");'
  npm run check:plugin
  python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/vinea
  ```

  Expected: 四份发布元数据都报告 `0.2.0`，公共 PNG 存在，两个校验命令 PASS。

  若本机系统 `python3` 缺少 PyYAML，可仅为本次校验将
  `VINEA_PLUGIN_VALIDATOR_PYTHON` 指向 Codex workspace 自带的 Python；不要安装、提交或分发该环境依赖。

- [x] **Step 2：运行全量代码与发布检查**

  Run:

  ```bash
  npm run typecheck
  npm test
  npm run build
  npm run package:plugin
  npm run check:plugin
  npm run check
  ```

  Expected: 全部 PASS；`npm test` 不再有 doctor JSON 基线失败。

- [x] **Step 3：执行已获用户授权的本机刷新**

  Run:

  ```bash
  scripts/install-codex-plugin.sh
  scripts/install-claude-plugin.sh
  ```

  Expected: Codex 脚本只对已声明 source 应用一个 cache-buster 后调用 `codex plugin add`；Claude Code 脚本在已安装的 Vinea 上调用 `plugin update`；两者均提示新会话。

- [x] **Step 4：核对真实宿主状态和已安装资源**

  Run:

  ```bash
  codex plugin list | rg 'vinea@personal.*0\.2\.0\+codex\.[a-z0-9-]+'
  claude plugin list | rg -A 3 'vinea@vinea-local'
  node --input-type=module -e 'import { access, readFile } from "node:fs/promises"; import { homedir } from "node:os"; import { join } from "node:path"; const home = homedir(); const codexRoot = join(home, ".codex", "plugins", "vinea"); const claudeRoot = join(home, ".claude", "plugins", "marketplaces", "vinea-local", "plugins", "vinea"); const codex = JSON.parse(await readFile(join(codexRoot, ".codex-plugin", "plugin.json"), "utf8")); const claude = JSON.parse(await readFile(join(claudeRoot, ".claude-plugin", "plugin.json"), "utf8")); if (!/^0\.2\.0\+codex\.[a-z0-9-]+$/.test(codex.version)) throw new Error(`unexpected Codex version ${codex.version}`); if (claude.version !== "0.2.0") throw new Error(`unexpected Claude version ${claude.version}`); await access(join(codexRoot, "assets", "vinea-loop.png")); await access(join(claudeRoot, "assets", "vinea-loop.png"));'
  ```

  Expected: Codex 列表显示 `vinea@personal` 已安装并启用，其版本是单个 `0.2.0+codex.*`；Claude Code 列表显示 `vinea@vinea-local` 版本 `0.2.0`、已启用；两份安装树均有 PNG。

- [x] **Step 5：记录命令证据并生成 R1–R5 与 AC1–AC5 检查矩阵**

  记录每个验证集的 `command` 证据：公共插件校验、全量 `npm run check`、Codex 刷新与列表核对、Claude 刷新与列表核对。每条证据都带实际 command、exit code 和 pass 结果。随后为 R1–R5 与 AC1–AC5 各写一行 `vinea check`，分别引用对应证据 ID，所有结果为 `pass`；R1／AC1 引用打包／图标证据，R2／AC2 引用版本元数据证据，R3／AC3 引用双宿主刷新证据，R4／AC4 引用 Task 1 聚焦测试证据，R5／AC5 引用 `npm run check`、插件校验与列表核对证据。Vinea 的完成门槛将 requirements 和 acceptance criteria 都视为必须覆盖的声明行。

  使用 `node plugins/vinea/bin/vinea.mjs check` 写入每行，并将同一轮 `evidence record --json` 返回的真实 `id` 传给该行的 `--evidence`。不编造 ID，也不把先前任务的证据用于本任务；提交前用 `node plugins/vinea/bin/vinea.mjs check show t-20260804-070507-release-vinea-0-2-0-icon-and-host-update-workflow --json` 确认 R1–R5 全部为 `pass`。

- [x] **Step 6：检查最终差异并提交生成产物与检查记录**

  ```bash
  git status --short
  git diff --check
  git add plugins/vinea .agents/plugins/marketplace.json .claude-plugin/marketplace.json .vinea/tasks/active/t-20260804-070507-release-vinea-0-2-0-icon-and-host-update-workflow
  git diff --staged --check
  git diff --staged --stat
  git commit -m "chore: package Vinea 0.2.0 release"
  ```

  Expected: 暂存内容只有本任务的生成插件产物、marketplace 元数据与 Vinea 检查记录；不包含本机绝对路径、缓存、日志或凭据。

## 实施后门槛

完成上述任务后，运行 `vinea:check` 的检查矩阵并报告实际结果。不要自动归档、推送或合并；在用户查看通过的检查结果后，再按其明确授权执行 Vinea finish、Git 推送或分支合并。
