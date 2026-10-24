# dsh-task-digest

DeepSeek Harness Web 插件：**每晚逐任务 token/金额日报**。

每天 00:05（北京时间）对前一天 Harness 执行过的任务生成中文 Markdown 日报：每个任务消耗多少 token、多少钱、什么类型、结果如何、后续建议；可在独立页面查看，也在 Session 列表里留下一个「每日总结」会话。

> 本插件与 [`dsh-task-plan`](../dsh-task-plan/README.md) **互相独立**：不 import 计划包，也不读 `plan.json`。计划任务本身是普通 Session，日报按 Session 日志统计；两包可分别安装/启停。

## 查看方式

- 左侧栏「每日总结」→ 日报列表 + 正文；「生成昨日总结 / 重新生成」手动触发；「打开总结会话」跳到当天的总结 Session。
- 日报文件落在 `dataDir/reports/`，页面只读索引，不依赖计划页。
- 右侧栏不承载本插件（该版本右侧栏是每会话停靠面板）。

## 功能

- **每日 00:05** 自动总结前一天；Host 白天启动会补最近一天，停机多天只补最近一天（其余可手动生成）。
- **逐任务**：标题、类型（计划任务从 prompt 标记解析，其他用工具/标题启发式）、结果、输入/输出 token、峰/谷金额、耗时、会话 id。
- **子代理归并**：子代理 Session 的用量并入父任务，不单独成行。
- **计划任务识别**：首条 prompt 以 `[[dsh-task-plan]]` 开头时标为计划任务，并解析 `（类型：开发/调研/…）`；不依赖计划包。
- **跨午夜**：会话首条事件在当日 → 统计整段会话；否则只统计当日时间窗。避免计划任务被午夜切半。
- **运行中**：到点前若有 root Session 仍在 running，最多等 `summaryWaitMs`（默认 10 分钟），之后按 running/部分数据出报。
- **LLM 失败兜底**：模型超时/空输出时生成确定性模板日报，数字仍来自完整日志。
- **零常驻 token**：不注册模型侧工具；只有总结 Session 本身消耗 token，金额单独显示为「本次总结消耗」。

## 峰谷与计费口径

与 [`dsh-token-cost`](../dsh-token-cost) 和 [`dsh-task-plan`](../dsh-task-plan) 保持一致：

- 峰时 = 北京时间周一至周五（排除 `holidays` 配置的中国法定节假日）**09:00–12:00、14:00–18:00**；其余全部为谷值。
- 价格（元 / 百万 token，缓存命中 / 未命中 / 输出）：
  - `deepseek-flash`：谷 0.02 / 1 / 4，峰 0.04 / 2 / 8
  - `deepseek-v4-pro`：谷 0.15 / 4.5 / 13.5，峰 0.3 / 9 / 27
- 每个用量样本按它自己的事件时间判峰谷；未知模型只统计 token，金额标未知。

> 金额是按公开单价估算，不是账单。两包的 `lib/tier.js` 是复制关系，`test/parity.test.js` 会对比规则与结果；调价时两份一起改。

## 从 GitHub / 插件市场安装

本包是标准 DSH **组合包**（`dsh.bundle.patch` + `cordis.patch.yml`），可以直接从 GitHub 安装：

```powershell
dsh plugin --profile web add github:nwasvsad/dsh-task-digest#<commit>
```

插件市场索引：

```text
https://cdn.jsdelivr.net/gh/nwasvsad/dsh-plugin-market@main/index.json
```

Git 安装会拉取源码并执行 `prepare`（重新构建 `lib/client.js`）；如果 pnpm 要求构建授权，按提示把包名加入该 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`。`lib/` 已提交，未授权构建时通常仍可直接加载。

安装后默认使用 `$DSH_HOME/task-digest`；计划任务的识别不依赖 `dsh-task-plan`，两个包可以分别安装。

## 本地安装（开发）

```powershell
cd <repo>

node scripts/verify.mjs           # 只读校验
node scripts/verify.mjs --apply   # 追加 patch 行 + pnpm add

# 重启你的 dsh web（例如重新运行: dsh web）
```

刷新 `http://127.0.0.1:3080`，左侧应出现「每日总结」。

`--apply` 追加：

```yaml
# dsh-task-digest: nightly per-task digest
- insert:
    - id: task-digest
      name: dsh-task-digest
      config:
        dataDir: '~/.dsh/task-digest'
        defaultCwd: '~'
        summaryAt: '00:05'
        summaryWaitMs: 600000
        holidays: []
        currency: '¥'
```

## 从旧版合并插件迁移日报

旧版 `dsh-task-plan` 把日报存在 `.../task-plan/reports/`。安装本包后执行一次（源目录不会被修改）：

```powershell
node scripts/migrate-from-plan.mjs `
  --from ~/.dsh/task-plan `
  --to   ~/.dsh/task-digest
```

- 复制 `reports/*.json|*.md`，合并索引，`lastSummaryDate` 取最新日期（避免首启重跑 10-22）。
- 幂等；重复执行只补缺失文件。`--force` 可覆盖目标文件。
- 迁移后旧 `reports/` 保留为备份；计划包不再使用它。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `dataDir` | `$DSH_HOME/task-digest` | `reports/` 根目录 |
| `defaultCwd` | `process.cwd()` | 总结 Session 的工作目录 |
| `agentPreset` | 部署默认 | 总结 Session 的 preset |
| `summaryEnabled` | `true` | 每日总结开关 |
| `summaryAt` | `'00:05'` | 总结前一天的时刻（北京时间） |
| `summaryWaitMs` | `600000` | 等待运行中 root Session 的上限；0 表示不等 |
| `summaryTimeoutMs` | `600000` | 总结 Session 超时 |
| `summaryMaxSessions` | `40` | 日报最多任务数 |
| `summaryResultChars` | `400` | 每任务结果进 prompt 的截断 |
| `skipEmptyDays` | `true` | 无会话不生成日报，只推进日期 |
| `reportKeepDays` | `180` | 预留的报告保留天数 |
| `holidays` | `[]` | 全天谷值的 `YYYY-MM-DD` |
| `currency` | `'¥'` | 金额前缀 |
| `startTimeoutMs` | `15000` | 总结 Agent 进入 running 的上限 |
| `pollIntervalMs` | `500` | 状态轮询 |

`holidays` / `currency` 应与计划包保持一致，否则两边的金额口径会不同；代码规则本身由 parity 测试保证。

## 数据

```text
<dataDir>/
  reports/
    index.json          # { version, lastSummaryDate, items[] }
    2026-10-22.json     # 事实 + Markdown + summaryUsage/summaryCost
    2026-10-22.md       # Markdown 原文
```

- 索引与报告均原子写；索引缺失/损坏时从 `reports/*.json` 重建，`lastSummaryDate` 取最新日期。
- `lastSummaryDate` 只前进不后退；空日跳过也会推进，避免反复重试。
- 历史总结 Session 通过索引里的 `summarySessionId` 与 prompt 标记排除，不会进入下一次日报。

## HTTP API

全部走 `connection.requestRejection`，body ≤ 64KB。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/task-digest/state` | 下次总结、运行状态、日报列表 |
| POST | `/api/task-digest/summary` | `{date?}`，默认昨天；运行中 409 |
| GET | `/api/task-digest/reports` | 日报列表 |
| GET | `/api/task-digest/report?date=` | 单份日报 |

## 运行机制

1. 每 30 秒 tick；当前 ≥ 当天 `summaryAt` 且 `lastSummaryDate !== 昨天` 时触发。
2. `sessionController.list` 取 root Session；按 `updatedAt` 过滤当日候选；排除子代理与历史总结会话。
3. 逐个读日志：
   - `createdAt` 在当日 → 折叠整段会话；否则只折叠当日时间窗。
   - 计划任务识别 `[[dsh-task-plan]]`，类型解析 `（类型：X）`；否则用标题/工具启发式。
   - 最后一条 non-empty assistant 文本作为结果；子代理用量归并。
4. 构建事实 JSON → 总结 Session 写中文 Markdown；失败用 fallback 模板。
5. 写报告文件 + 索引 + `lastSummaryDate`；页面轮询 state。

## 注意与限制

- **Host 必须常开**；停机则当天不生成，启动后补最近一天。
- **计划任务的边界**：若任务在创建 Session 前就失败（无会话），日报看不到；计划页仍会显示失败。
- **跨午夜**：当日创建的会话按整段统计，可能包含少量次日凌晨用量；报告会标注 `whole-session`。
- **审批**：总结 Session 继承部署的 sandbox/approval 策略；Prompt 要求不调用工具，但不会强制。
- **配置重复**：两包的 `tier.js`/`usage.js` 是复制关系；修改价格/峰谷规则时两份一起改，parity 测试会失败提醒。
- 不新增模型侧工具；日报质量取决于当天日志与总结模型。

## 开发与测试

```powershell
node scripts/build-client.mjs
node scripts/verify.mjs
npm test
```

源码结构：

```text
lib/tier.js       峰谷、价格、日期/时刻（与计划包同一份规则）
lib/usage.js      会话日志 → 用量/费用/结果/工具统计
lib/session.js    create → rename → prompt → 等 idle → 读日志
lib/store.js      reports/index.json、lastSummaryDate、原子写
lib/report.js     仅扫描 Session 的事实/提示词/fallback
lib/scheduler.js  00:05 判定、等待 running、去重
lib/routes.js     HTTP 路由
lib/index.js      Host 入口
src/client.js     浏览器日报页
scripts/migrate-from-plan.mjs  旧日报迁移
```
