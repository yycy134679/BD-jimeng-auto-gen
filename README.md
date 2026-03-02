# jimeng-auto-gen

即梦官网批量视频提交自动化脚本（Phase 1：仅批量提交）。

## 功能

- 支持 `CSV/XLSX` 输入（必填 `image_url` + `prompt`，可选 `task_id`/`pid`）
- 图片 URL 自动下载后上传
- Playwright 可视化串行提交
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

## 配置

默认配置文件：`config/jimeng.config.json`

关键字段：

- `baseUrl`: 即梦视频生成页面 URL（如页面路径变化，请更新）
  - 推荐：`https://jimeng.jianying.com/ai-tool/generate?type=video`
- `selectors`: 页面选择器候选列表
- `selectors.policyViolationTexts`: 违规文案关键词（命中后立即跳过该任务）
- `fixedOptions`: 固定模型参数（默认 `Seedance 2.0 / 全能参考 / 9:16 / 720P / 15s`）
  - 如果你的账号当前只显示 `视频 3.0 Fast / 首尾帧 / 16:9 / 5s`，请改成页面上真实可选的文案
  - 当“参考模式”和“模型”不兼容时，脚本会优先锁定 `model`
- `timeouts`: 导航、操作、下载、toast 等超时

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

主键规则：优先 `task_id/pid` 作为前缀，并拼接 `sha256(image_url + prompt)` 的短哈希（避免同一商品多条文案冲突）；缺失时使用完整 `sha256(image_url + prompt)`。

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

### 3) 查看报告

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
- 说明页面结构或文案变了，更新 `config/jimeng.config.json` 里的选择器和固定参数文案。

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
