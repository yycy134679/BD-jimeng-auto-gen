# jimeng-auto-gen

即梦官网批量视频提交自动化脚本（Phase 1：仅批量提交）。

## 功能

- 支持 `CSV/XLSX` 输入（必填 `image_url` + `prompt`，可选 `task_id`/`pid`）
- 图片 URL 自动下载后上传
- Playwright 可视化串行提交
- 24 小时巡检补单：每隔一小时检查“生成中”数量，不足时自动补到目标值
- 成功判定：页面出现 `提交成功` 或 `已加入队列`
- 违规判定：命中违规文案后当前任务立即跳过（不重试），继续下一条
- 断点续跑（`--resume` 跳过历史已提交）
- 失败重试、日志、截图和 HTML 现场

## 环境要求

- Node.js 20+
- macOS 本机运行（已在你当前需求场景对齐）

## 安装

```bash
npm install
npx playwright install chromium
```

## 桌面版（macOS）

新增了一个基于 `Electron + React + Vite` 的本地桌面壳，保留原有 Playwright 自动化内核。

常用命令：

```bash
# 本地开发模式（先编译 Electron 主进程，再启动 Vite + Electron）
npm run desktop:dev

# 构建桌面端主进程和渲染层
npm run desktop:build

# 打包 DMG（打包前建议先把 Chromium 浏览器装到项目内）
npm run desktop:install-browsers
npm run desktop:dist
```

打包输出：

- DMG：`dist/Jimeng Desktop-<version>-arm64.dmg`
- 应用包：`dist/mac-arm64/Jimeng Desktop.app`

打包说明：

- `desktop:install-browsers` 会把 Playwright Chromium 装到项目内的 `playwright-core/.local-browsers`
- `desktop:dist` 会把这些浏览器资源复制进应用包的 `Contents/Resources/playwright-browsers`
- 桌面端运行时会优先显式使用包内 Chromium，不依赖同事本机额外安装浏览器

桌面端能力：

- 登录引导：打开脚本专用浏览器并保存登录态
- Excel/CSV 导入预览：展示有效任务数、无效行和 sheet 选择
- 批量提交：常用参数直出，高级参数折叠
- 巡检补单：配置目标生成中数量、巡检间隔和总时长
- 运行记录：查看最近 run 的摘要、失败原因和进度事件
- 同事友好提示：内置 CSV 模板下载、首次使用步骤、巡检建议和排障文案

## 配置

默认配置文件：`config/jimeng.config.jsonc`
支持在配置文件里写中文注释（`//` 或 `/* ... */`）。
同时保留 `config/jimeng.config.json`（无注释版，兼容严格 JSON 校验器）。

关键字段：

- `baseUrl`: 即梦视频生成页面 URL（如页面路径变化，请更新）
  - 推荐：`https://jimeng.jianying.com/ai-tool/generate?type=video`
- `selectors`: 页面选择器候选列表
- `selectors.policyViolationTexts`: 违规文案关键词（命中后立即跳过该任务）
- `selectors.rateLimitTexts`: 频控文案关键词（如“操作过于频繁”“点击过快”）
- `fixedOptions`: 固定模型参数（默认 `Seedance 2.0 / 全能参考 / 9:16 / 720P / 15s`）
  - 如果你的账号当前只显示 `视频 3.0 Fast / 首尾帧 / 16:9 / 5s`，请改成页面上真实可选的文案
  - 当“参考模式”和“模型”不兼容时，脚本会优先锁定 `model`
- `timeouts`: 导航、操作、下载、toast 等超时
- `throttleMs`: 节流参数
  - `min/max`: 每条任务之间的短等待（毫秒）
  - `submitMinIntervalMs`: 两次“点击提交”之间的最小间隔（毫秒，默认 25000）
  - `rateLimitCooldownMsMin/rateLimitCooldownMsMax`: 命中频控后重试前冷却区间（毫秒，默认 180000-240000）
  - `batchPauseEveryTasks/batchPauseMs`: 每处理 N 条任务（无论成功失败）后的长等待（毫秒），默认每 10 条等待 120000ms（2 分钟）
  - `batchRefreshEveryTasks`: 每处理 N 条任务后自动刷新页面（默认 10；`--manual-options` 模式下自动禁用）

## 输入文件格式

支持 CSV 或 Excel（首个 sheet，或用 `--sheet` 指定）。

必须列：

- `image_url`
- `prompt`

可选列：

- `task_id`（推荐）
- `pid`（兼容）

示例：

```csv
task_id,image_url,prompt
sku_001,https://xxx/a.jpg,一个电商产品镜头推进展示
sku_002,https://xxx/b.jpg,运动鞋静物旋转展示，光影高级
```

主键规则：优先 `task_id/pid` 作为前缀，并拼接 `sha256(image_url + prompt)` 的短哈希（避免同一商品多条文案冲突）；缺失时使用完整 `sha256(image_url + prompt)`。如果输入文件里存在完全重复的多行，脚本会在内部追加稳定的重复序号后缀，把它们当成独立任务依次提交。

## 使用

### 1) 首次登录（保存脚本专用 profile）

```bash
npm run login
```

完成登录后回到终端按回车，登录态保存在 `.runtime/profile`。

### 2) 批量提交

```bash
npm run submit -- --input ./data/tasks.csv --resume --max-retries 2
```

可选参数：

- `--sheet <name>`: Excel sheet 名称
- `--start-at <N>`: 从第 N 条开始
- `--resume`: 跳过历史已成功提交任务
- `--max-retries <N>`: 失败重试次数（默认 2）
- `--reload-each-task`: 每条任务前刷新页面（默认关闭，推荐关闭）
- `--manual-options`: 使用你当前页面手动选好的参数，不自动设置 `fixedOptions`
- `--config <path>`: 自定义配置文件

推荐模式（不刷新 + 自动参数）：

```bash
npm run submit -- --input ./data/tasks.csv --resume --max-retries 2
```

手动参数模式（你先在页面选好模型/比例/时长，再开始跑）：

```bash
npm run submit -- --input ./data/tasks.csv --resume --max-retries 2 --manual-options
```

说明：
- `--manual-options` 会在开始前暂停，等你在浏览器里设置好参数后按回车继续
- `--manual-options` 不能与 `--reload-each-task` 同时使用

### 3) 24 小时巡检补单

默认每 60 分钟巡检一次，目标是让“生成中”保持在 10 条；如果当前不足，就会从输入文件里继续补提，且自动跳过历史已提交任务。

```bash
npm run monitor -- --input ./data/tasks.csv
```

常用参数：

- `--target-running <N>`: 目标“生成中”数量（默认 10）
- `--interval-minutes <N>`: 巡检间隔分钟数（默认 60）
- `--duration-hours <N>`: 总运行时长小时数（默认 24）
- `--max-retries <N>`: 单条补单失败时的重试次数（默认 2）
- `--reload-each-task`: 每条补单任务前刷新页面（默认关闭）

示例：

```bash
npm run monitor -- --input ./data/tasks.csv --target-running 10 --interval-minutes 60 --duration-hours 24
```

说明：
- 巡检时会读取页面里的 `x/y 生成中...` 指示器，并用右侧的 `y` 作为当前生成中的任务数
- `monitor` 模式固定使用自动参数，不支持 `--manual-options`
- 如需更换模型/比例/时长，请直接修改 `config/jimeng.config.jsonc` 里的 `fixedOptions`

### 4) 查看报告

```bash
npm run report -- --run-id latest
```

也可指定 runId：

```bash
npm run report -- --run-id 20260302-101500
```

## 运行产物

- `.runtime/profile/`: 脚本专用登录态
- `.runtime/images/`: 下载的图片缓存
- `.runtime/logs/run-<runId>.log`: 运行日志
- `.runtime/logs/run-<runId>.summary.json`: 汇总
- `.runtime/screenshots/<runId>/`: 失败截图和 HTML
- `.runtime/state/runs/<runId>.jsonl`: 本次状态流水
- `.runtime/state/checkpoint.json`: 全局断点 checkpoint

## 常见问题

1. 找不到元素（`ui_selector_failed`）
- 说明页面结构或文案变了，更新 `config/jimeng.config.jsonc` 里的选择器和固定参数文案。

2. 一直收不到成功提示（`submit_timeout`）
- 提高 `timeouts.toastMs`，并确认当前页面提示文案是否仍为 `提交成功` 或 `已加入队列`。

3. 下载失败（`download_failed`）
- 检查图片 URL 是否可公开访问，必要时延长 `timeouts.downloadMs`。

## 测试

```bash
npm test
```

说明：

- `tests/mock-submitter.test.ts` 默认跳过（需 `RUN_PLAYWRIGHT_TESTS=1` 才执行）
- 其余为单元测试，覆盖输入解析、主键、状态恢复、下载重试
