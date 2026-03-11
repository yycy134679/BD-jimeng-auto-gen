import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useState,
} from "react";
import type { JSX, ReactNode } from "react";

import type {
  DesktopSettings,
  ImportInputRequest,
  ImportedTaskPreview,
  LoginStatus,
  RunHistoryDetail,
  RunHistoryEntry,
  RunMode,
  RunProgressEvent,
} from "../../src/types.js";

type PageKey = "login" | "submit" | "monitor" | "history";
type ElectronFile = File & { path?: string };

const PAGES: Array<{ key: PageKey; label: string; title: string }> = [
  { key: "login", label: "登录引导", title: "登录与环境就绪" },
  { key: "submit", label: "批量提交", title: "上传表格并启动批量提交" },
  { key: "monitor", label: "巡检补单", title: "定时巡检生成中数量并自动补单" },
  { key: "history", label: "运行记录", title: "查看最近运行结果与失败原因" },
];

const TEMPLATE_CSV = [
  "task_id,image_url,prompt",
  "sku_001,https://example.com/a.jpg,一个电商产品镜头推进展示",
  "sku_002,https://example.com/b.jpg,运动鞋静物旋转展示，光影高级",
].join("\n");

const DEFAULT_SELECTOR_JSON = JSON.stringify(
  {
    fileInput: [],
    promptTextarea: [],
    promptContentEditable: [],
    submitButton: [],
    successToastTexts: [],
    rateLimitTexts: [],
    policyViolationTexts: [],
  },
  null,
  2,
);

function metricText(entry: RunHistoryEntry): string {
  if (entry.mode === "monitor") {
    return `巡检 ${entry.metrics.completedCycles ?? 0} 轮 / 补单 ${entry.metrics.totalSubmitted ?? 0} 条`;
  }

  return `成功 ${entry.metrics.success ?? 0} / 失败 ${entry.metrics.failed ?? 0} / 跳过 ${entry.metrics.skipped ?? 0}`;
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return "未记录";
  }

  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function downloadTemplate(): void {
  const blob = new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "jimeng-template.csv";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function isMonitorDetail(
  detail: RunHistoryDetail | null,
): detail is RunHistoryDetail & { mode: "monitor" } {
  return Boolean(detail && detail.mode === "monitor");
}

export function App(): JSX.Element {
  const [page, setPage] = useState<PageKey>("login");
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [authStatus, setAuthStatus] = useState<LoginStatus | null>(null);
  const [preview, setPreview] = useState<ImportedTaskPreview | null>(null);
  const [sourcePath, setSourcePath] = useState<string>("");
  const [selectorsDraft, setSelectorsDraft] = useState(DEFAULT_SELECTOR_JSON);
  const [history, setHistory] = useState<RunHistoryEntry[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<RunHistoryEntry | null>(null);
  const [runDetail, setRunDetail] = useState<RunHistoryDetail | null>(null);
  const [progressEvents, setProgressEvents] = useState<RunProgressEvent[]>([]);
  const [activeRun, setActiveRun] = useState<{ runId: string; mode: RunMode } | null>(null);
  const [busyMessage, setBusyMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const deferredHistory = useDeferredValue(history);

  const refreshHistory = useEffectEvent(async () => {
    const runs = await window.jimengDesktop.jobs.listRuns();
    setHistory(runs);

    if (!selectedHistory && runs[0]) {
      setSelectedHistory(runs[0]);
      return;
    }

    if (selectedHistory) {
      const next = runs.find((item) => item.runId === selectedHistory.runId && item.mode === selectedHistory.mode);
      if (next) {
        setSelectedHistory(next);
      }
    }
  });

  const loadRunDetail = useEffectEvent(async (entry: RunHistoryEntry | null) => {
    if (!entry) {
      setRunDetail(null);
      return;
    }

    const detail = await window.jimengDesktop.jobs.getRunDetail({
      runId: entry.runId,
      mode: entry.mode,
    });
    setRunDetail(detail);
  });

  useEffect(() => {
    let disposed = false;

    async function bootstrap(): Promise<void> {
      try {
        const [nextSettings, nextAuth] = await Promise.all([
          window.jimengDesktop.settings.get(),
          window.jimengDesktop.auth.check(),
        ]);
        if (disposed) {
          return;
        }

        setSettings(nextSettings);
        setSelectorsDraft(JSON.stringify(nextSettings.advanced.selectors, null, 2));
        setAuthStatus(nextAuth);
        await refreshHistory();
      } catch (error) {
        if (!disposed) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void bootstrap();

    const unsubscribe = window.jimengDesktop.jobs.subscribeProgress((event) => {
      startTransition(() => {
        setProgressEvents((current) => [event, ...current].slice(0, 120));
      });

      if (event.phase === "summary") {
        setActiveRun((current) => (current?.runId === event.runId ? null : current));
        void refreshHistory();
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [refreshHistory]);

  useEffect(() => {
    void loadRunDetail(selectedHistory);
  }, [selectedHistory, loadRunDetail]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setSelectorsDraft(JSON.stringify(settings.advanced.selectors, null, 2));
  }, [settings]);

  async function importInput(request: ImportInputRequest): Promise<void> {
    setBusyMessage("正在导入输入文件...");
    setErrorMessage("");

    try {
      const nextPreview = await window.jimengDesktop.input.importFile(request);
      setPreview(nextPreview);
      if (request.sourcePath) {
        setSourcePath(request.sourcePath);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage("");
    }
  }

  async function handleFilePick(file: ElectronFile | undefined): Promise<void> {
    if (!file?.path) {
      setErrorMessage("未能读取本地文件路径，请直接从 Finder 选择 CSV/XLSX 文件。");
      return;
    }

    await importInput({
      sourcePath: file.path,
    });
  }

  async function persistSettings(): Promise<DesktopSettings | null> {
    if (!settings) {
      return null;
    }

    try {
      const parsedSelectors = JSON.parse(selectorsDraft) as DesktopSettings["advanced"]["selectors"];
      const nextSettings = await window.jimengDesktop.settings.update({
        baseUrl: settings.baseUrl,
        resume: settings.resume,
        startAt: settings.startAt,
        maxRetries: settings.maxRetries,
        reloadEachTask: settings.reloadEachTask,
        showExecutionBrowser: settings.showExecutionBrowser,
        fixedOptions: settings.fixedOptions,
        advanced: {
          referenceMode: settings.advanced.referenceMode,
          resolution: settings.advanced.resolution,
          selectors: parsedSelectors,
          timeouts: settings.advanced.timeouts,
          throttleMs: settings.advanced.throttleMs,
        },
        monitorDefaults: settings.monitorDefaults,
      });
      setSettings(nextSettings);
      return nextSettings;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async function startSubmit(): Promise<void> {
    if (!preview || !settings) {
      setErrorMessage("请先上传有效的 CSV/XLSX 文件。");
      return;
    }

    setBusyMessage("正在保存设置并启动批量提交...");
    setErrorMessage("");
    setProgressEvents([]);

    try {
      const nextSettings = await persistSettings();
      if (!nextSettings) {
        return;
      }

      const response = await window.jimengDesktop.jobs.startSubmit({
        fileId: preview.fileId,
        sheet: preview.selectedSheet,
        resume: nextSettings.resume,
        startAt: nextSettings.startAt,
        maxRetries: nextSettings.maxRetries,
        reloadEachTask: nextSettings.reloadEachTask,
        manualOptions: false,
      });

      setActiveRun({ runId: response.runId, mode: "submit" });
      setPage("history");
      await refreshHistory();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage("");
    }
  }

  async function startMonitor(): Promise<void> {
    if (!preview || !settings) {
      setErrorMessage("请先上传有效的 CSV/XLSX 文件。");
      return;
    }

    setBusyMessage("正在保存设置并启动巡检补单...");
    setErrorMessage("");
    setProgressEvents([]);

    try {
      const nextSettings = await persistSettings();
      if (!nextSettings) {
        return;
      }

      const response = await window.jimengDesktop.jobs.startMonitor({
        fileId: preview.fileId,
        sheet: preview.selectedSheet,
        maxRetries: nextSettings.maxRetries,
        reloadEachTask: nextSettings.reloadEachTask,
        targetRunning: nextSettings.monitorDefaults.targetRunning,
        intervalMinutes: nextSettings.monitorDefaults.intervalMinutes,
        durationHours: nextSettings.monitorDefaults.durationHours,
      });

      setActiveRun({ runId: response.runId, mode: "monitor" });
      setPage("history");
      await refreshHistory();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage("");
    }
  }

  async function beginLogin(): Promise<void> {
    setBusyMessage("正在打开登录浏览器...");
    setErrorMessage("");

    try {
      const status = await window.jimengDesktop.auth.startLogin();
      setAuthStatus(status);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage("");
    }
  }

  async function finishLogin(): Promise<void> {
    setBusyMessage("正在保存登录状态...");
    setErrorMessage("");

    try {
      const status = await window.jimengDesktop.auth.completeLogin();
      setAuthStatus(status);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage("");
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">JM</div>
          <div>
            <p className="eyebrow">macOS desktop</p>
            <h1>Jimeng Studio</h1>
          </div>
        </div>

        <nav className="nav">
          {PAGES.map((item) => (
            <button
              key={item.key}
              className={item.key === page ? "nav-item active" : "nav-item"}
              onClick={() => setPage(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <section className="status-card">
          <span className={authStatus?.loggedIn ? "pill ok" : "pill warn"}>
            {authStatus?.loggedIn ? "已检测到登录态" : "尚未登录"}
          </span>
          <p>最近检查：{formatTimestamp(authStatus?.lastCheckedAt)}</p>
          <p>当前输入：{preview ? preview.fileName : "尚未导入"}</p>
          <p>运行状态：{activeRun ? `${activeRun.mode} · ${activeRun.runId}` : "空闲"}</p>
        </section>
      </aside>

      <main className="content">
        <header className="hero">
          <div>
            <p className="eyebrow">workflow control</p>
            <h2>{PAGES.find((item) => item.key === page)?.title}</h2>
            <p className="hero-copy">
              把登录、文件导入、参数配置、批量提交和巡检补单收进一个本地桌面工具里。
            </p>
          </div>
          <div className="hero-metrics">
            <Metric label="有效任务" value={preview?.validCount ?? 0} />
            <Metric label="无效行" value={preview?.invalidCount ?? 0} />
            <Metric label="最近运行" value={history[0]?.runId ?? "--"} compact />
          </div>
        </header>

        {busyMessage ? <Banner tone="info" message={busyMessage} /> : null}
        {errorMessage ? <Banner tone="error" message={errorMessage} /> : null}

        {page === "login" ? (
          <section className="panel-grid single">
            <Panel title="登录向导" description="首次使用时点击开始登录，浏览器会用脚本专属 profile 打开。">
              <div className="action-row">
                <button className="primary-button" onClick={() => void beginLogin()} type="button">
                  开始登录
                </button>
                <button className="secondary-button" onClick={() => void finishLogin()} type="button">
                  我已完成登录
                </button>
              </div>
              <p className="helper-text">登录完成后，点击“我已完成登录”即可关闭浏览器并保存登录态。</p>
              <div className="guide-strip">
                <div className="guide-card">
                  <strong>1. 点击开始登录</strong>
                  <p>系统会打开脚本专用浏览器窗口，不影响你平时使用的浏览器。</p>
                </div>
                <div className="guide-card">
                  <strong>2. 在即梦页面完成登录</strong>
                  <p>扫码或输入账号都可以，保持这个窗口打开，不要手动关闭。</p>
                </div>
                <div className="guide-card">
                  <strong>3. 回到桌面工具确认</strong>
                  <p>点击“我已完成登录”后，工具会保存登录态，后续批量任务可直接使用。</p>
                </div>
              </div>
              <div className="login-meta">
                <div>
                  <span>登录状态</span>
                  <strong>{authStatus?.loggedIn ? "已保存" : "未保存"}</strong>
                </div>
                <div>
                  <span>目标地址</span>
                  <strong>{authStatus?.baseUrl ?? settings?.baseUrl ?? "--"}</strong>
                </div>
                <div>
                  <span>Profile 路径</span>
                  <strong>{authStatus?.profilePath ?? "--"}</strong>
                </div>
              </div>
            </Panel>
          </section>
        ) : null}

        {page === "submit" && settings ? (
          <section className="panel-grid">
            <Panel title="输入文件" description="上传 Excel 或 CSV，先检查列头和无效行，再启动批量提交。">
              <div className="action-row">
                <button className="secondary-button" onClick={() => downloadTemplate()} type="button">
                  下载 CSV 模板
                </button>
              </div>
              <input
                className="file-input"
                type="file"
                accept=".csv,.xls,.xlsx"
                onChange={(event) => void handleFilePick(event.target.files?.[0] as ElectronFile | undefined)}
              />

              {preview ? (
                <div className="preview-card">
                  <div className="preview-head">
                    <strong>{preview.fileName}</strong>
                    {preview.sheetNames.length > 1 ? (
                      <select
                        value={preview.selectedSheet}
                        onChange={(event) =>
                          void importInput({
                            fileId: preview.fileId,
                            sourcePath,
                            sheet: event.target.value,
                          })
                        }
                      >
                        {preview.sheetNames.map((sheetName) => (
                          <option key={sheetName} value={sheetName}>
                            {sheetName}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                  <p>有效任务：{preview.validCount}</p>
                  <p>无效行：{preview.invalidCount}</p>
                  {preview.invalidRows.length > 0 ? (
                    <div className="invalid-list">
                      {preview.invalidRows.slice(0, 8).map((row) => (
                        <div key={`${row.taskKey}-${row.inputRow}`} className="invalid-item">
                          <span>第 {row.inputRow} 行</span>
                          <strong>{row.message}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="helper-text">没有发现无效行，可以直接开始。</p>
                  )}
                </div>
              ) : (
                <div className="helper-card">
                  <strong>推荐准备方式</strong>
                  <p>沿用团队表格模板最稳。必须包含 `image_url` 和 `prompt`，建议额外提供 `task_id` 方便定位结果。</p>
                </div>
              )}
              <div className="guide-strip compact">
                <div className="guide-card">
                  <strong>先小批量试跑</strong>
                  <p>建议先提交 3-5 条确认页面选择器、模型和账号状态都正常。</p>
                </div>
                <div className="guide-card">
                  <strong>推荐使用公开图片链接</strong>
                  <p>如果图片在企业网盘或有鉴权，下载阶段会失败，建议先换成可直接访问的 URL。</p>
                </div>
              </div>
            </Panel>

            <Panel title="提交参数" description="默认展示常用项，高级设置折叠收起。">
              <div className="form-grid">
                <Field label="模型">
                  <input
                    value={settings.fixedOptions.model ?? ""}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        fixedOptions: { ...settings.fixedOptions, model: event.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="比例">
                  <input
                    value={settings.fixedOptions.ratio ?? ""}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        fixedOptions: { ...settings.fixedOptions, ratio: event.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="时长">
                  <input
                    value={settings.fixedOptions.duration ?? ""}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        fixedOptions: { ...settings.fixedOptions, duration: event.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="最大重试">
                  <input
                    type="number"
                    min="0"
                    value={settings.maxRetries}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        maxRetries: Number(event.target.value || 0),
                      })
                    }
                  />
                </Field>
                <Field label="起始行">
                  <input
                    type="number"
                    min="1"
                    value={settings.startAt ?? ""}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        startAt: event.target.value ? Number(event.target.value) : undefined,
                      })
                    }
                  />
                </Field>
                <Toggle
                  label="跳过历史已提交"
                  checked={settings.resume}
                  onChange={(checked) => setSettings({ ...settings, resume: checked })}
                />
                <Toggle
                  label="每条任务前刷新页面"
                  checked={settings.reloadEachTask}
                  onChange={(checked) => setSettings({ ...settings, reloadEachTask: checked })}
                />
                <Toggle
                  label="显示执行浏览器"
                  checked={settings.showExecutionBrowser}
                  onChange={(checked) => setSettings({ ...settings, showExecutionBrowser: checked })}
                />
              </div>

              <details className="advanced">
                <summary>高级设置</summary>
                <div className="form-grid">
                  <Field label="参考模式">
                    <input
                      value={settings.advanced.referenceMode ?? ""}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          advanced: { ...settings.advanced, referenceMode: event.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field label="分辨率">
                    <input
                      value={settings.advanced.resolution ?? ""}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          advanced: { ...settings.advanced, resolution: event.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field label="目标地址" full>
                    <input
                      value={settings.baseUrl}
                      onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })}
                    />
                  </Field>
                  <Field label="Navigation(ms)">
                    <input
                      type="number"
                      min="1000"
                      value={settings.advanced.timeouts.navigationMs}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          advanced: {
                            ...settings.advanced,
                            timeouts: {
                              ...settings.advanced.timeouts,
                              navigationMs: Number(event.target.value || 0),
                            },
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Action(ms)">
                    <input
                      type="number"
                      min="1000"
                      value={settings.advanced.timeouts.actionMs}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          advanced: {
                            ...settings.advanced,
                            timeouts: {
                              ...settings.advanced.timeouts,
                              actionMs: Number(event.target.value || 0),
                            },
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Toast(ms)">
                    <input
                      type="number"
                      min="1000"
                      value={settings.advanced.timeouts.toastMs}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          advanced: {
                            ...settings.advanced,
                            timeouts: {
                              ...settings.advanced.timeouts,
                              toastMs: Number(event.target.value || 0),
                            },
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Download(ms)">
                    <input
                      type="number"
                      min="1000"
                      value={settings.advanced.timeouts.downloadMs}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          advanced: {
                            ...settings.advanced,
                            timeouts: {
                              ...settings.advanced.timeouts,
                              downloadMs: Number(event.target.value || 0),
                            },
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Throttle min(ms)">
                    <input
                      type="number"
                      min="0"
                      value={settings.advanced.throttleMs.min}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          advanced: {
                            ...settings.advanced,
                            throttleMs: {
                              ...settings.advanced.throttleMs,
                              min: Number(event.target.value || 0),
                            },
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Throttle max(ms)">
                    <input
                      type="number"
                      min="0"
                      value={settings.advanced.throttleMs.max}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          advanced: {
                            ...settings.advanced,
                            throttleMs: {
                              ...settings.advanced.throttleMs,
                              max: Number(event.target.value || 0),
                            },
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="批次冷却(ms)">
                    <input
                      type="number"
                      min="0"
                      value={settings.advanced.throttleMs.batchPauseMs}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          advanced: {
                            ...settings.advanced,
                            throttleMs: {
                              ...settings.advanced.throttleMs,
                              batchPauseMs: Number(event.target.value || 0),
                            },
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="选择器 JSON" full>
                    <textarea
                      rows={12}
                      value={selectorsDraft}
                      onChange={(event) => setSelectorsDraft(event.target.value)}
                    />
                  </Field>
                </div>
              </details>

              <div className="helper-card">
                <strong>给非技术同事的建议</strong>
                <p>常用情况下只改模型、比例、时长和最大重试即可。高级设置仅在页面改版或排障时再打开。</p>
              </div>

              <div className="action-row">
                <button className="secondary-button" onClick={() => void persistSettings()} type="button">
                  保存设置
                </button>
                <button
                  className="primary-button"
                  onClick={() => void startSubmit()}
                  type="button"
                  disabled={!preview || Boolean(activeRun)}
                >
                  开始批量提交
                </button>
              </div>
            </Panel>
          </section>
        ) : null}

        {page === "monitor" && settings ? (
          <section className="panel-grid">
            <Panel title="巡检数据源" description="巡检补单会继续使用这份已导入的数据文件。">
              {preview ? (
                <div className="preview-card">
                  <strong>{preview.fileName}</strong>
                  <p>当前使用 sheet：{preview.selectedSheet ?? "默认"}</p>
                  <p>可用于补单的有效任务：{preview.validCount}</p>
                </div>
              ) : (
                <p className="helper-text">请先到“批量提交”页导入文件，或直接在这里重新选择文件。</p>
              )}
              <input
                className="file-input"
                type="file"
                accept=".csv,.xls,.xlsx"
                onChange={(event) => void handleFilePick(event.target.files?.[0] as ElectronFile | undefined)}
              />
              <div className="guide-strip compact">
                <div className="guide-card">
                  <strong>适合长时间排队场景</strong>
                  <p>如果你希望账号持续保持在“生成中”阈值附近，开启巡检补单会比手动盯盘省很多时间。</p>
                </div>
              </div>
            </Panel>

            <Panel title="巡检参数" description="建议先用默认值跑通，再根据账号吞吐逐步调节。">
              <div className="form-grid">
                <Field label="目标生成中数量">
                  <input
                    type="number"
                    min="1"
                    value={settings.monitorDefaults.targetRunning}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        monitorDefaults: {
                          ...settings.monitorDefaults,
                          targetRunning: Number(event.target.value || 1),
                        },
                      })
                    }
                  />
                </Field>
                <Field label="巡检间隔(分钟)">
                  <input
                    type="number"
                    min="1"
                    value={settings.monitorDefaults.intervalMinutes}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        monitorDefaults: {
                          ...settings.monitorDefaults,
                          intervalMinutes: Number(event.target.value || 1),
                        },
                      })
                    }
                  />
                </Field>
                <Field label="总时长(小时)">
                  <input
                    type="number"
                    min="1"
                    value={settings.monitorDefaults.durationHours}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        monitorDefaults: {
                          ...settings.monitorDefaults,
                          durationHours: Number(event.target.value || 1),
                        },
                      })
                    }
                  />
                </Field>
                <Field label="失败重试">
                  <input
                    type="number"
                    min="0"
                    value={settings.maxRetries}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        maxRetries: Number(event.target.value || 0),
                      })
                    }
                  />
                </Field>
                <Toggle
                  label="每轮补单前刷新页面"
                  checked={settings.reloadEachTask}
                  onChange={(checked) => setSettings({ ...settings, reloadEachTask: checked })}
                />
              </div>

              <div className="helper-card">
                <strong>推荐默认值</strong>
                <p>大多数场景可以先用 `目标 10 / 间隔 60 分钟 / 总时长 24 小时`。如果账号经常频控，优先降低目标值而不是一味缩短间隔。</p>
              </div>

              <div className="action-row">
                <button className="secondary-button" onClick={() => void persistSettings()} type="button">
                  保存设置
                </button>
                <button
                  className="primary-button"
                  onClick={() => void startMonitor()}
                  type="button"
                  disabled={!preview || Boolean(activeRun)}
                >
                  启动巡检补单
                </button>
              </div>
            </Panel>
          </section>
        ) : null}

        {page === "history" ? (
          <section className="panel-grid history-layout">
            <Panel title="最近运行" description="提交和巡检都会出现在这里，按 runId 倒序展示。">
              <div className="history-list">
                {deferredHistory.map((entry) => (
                  <button
                    key={`${entry.mode}-${entry.runId}`}
                    className={
                      selectedHistory?.runId === entry.runId && selectedHistory?.mode === entry.mode
                        ? "history-item active"
                        : "history-item"
                    }
                    onClick={() => setSelectedHistory(entry)}
                    type="button"
                  >
                    <div>
                      <strong>{entry.title}</strong>
                      <span>{entry.runId}</span>
                    </div>
                    <p>{metricText(entry)}</p>
                    <small>{formatTimestamp(entry.completedAt)}</small>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="运行详情" description="查看结果摘要、失败原因，以及最近的进度事件。">
              {runDetail ? (
                <div className="detail-stack">
                  <div className="helper-card">
                    <strong>排障提示</strong>
                    <p>如果失败原因集中在选择器或成功提示文案变化，优先去“高级设置”检查 selector 和 toast 文案是否仍然匹配当前页面。</p>
                  </div>
                  <div className="summary-grid">
                    {Object.entries(runDetail.summary)
                      .filter(([, value]) => typeof value === "number" || typeof value === "string")
                      .slice(0, 8)
                      .map(([key, value]) => (
                        <Metric key={key} label={key} value={String(value)} compact />
                      ))}
                  </div>

                  {isMonitorDetail(runDetail) ? null : (
                    <div className="record-list">
                      {(runDetail.records ?? []).slice(-10).reverse().map((record) => (
                        <div key={`${record.taskKey}-${record.createdAt}`} className="record-item">
                          <strong>{record.taskKey}</strong>
                          <span>{record.status}</span>
                          <small>{record.lastError ?? record.submittedAt ?? record.createdAt}</small>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="event-list">
                    {progressEvents.map((event) => (
                      <div key={`${event.runId}-${event.createdAt}-${event.message}`} className="event-item">
                        <span className={`pill ${event.level === "error" ? "error" : event.level === "warn" ? "warn" : "ok"}`}>
                          {event.level}
                        </span>
                        <div>
                          <strong>{event.message}</strong>
                          <small>
                            {event.mode} · {event.runId} · {formatTimestamp(event.createdAt)}
                          </small>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="helper-text">选择左侧运行记录后查看详情。</p>
              )}
            </Panel>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function Panel(props: {
  title: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h3>{props.title}</h3>
          <p>{props.description}</p>
        </div>
      </header>
      {props.children}
    </section>
  );
}

function Metric(props: {
  label: string;
  value: string | number;
  compact?: boolean;
}): JSX.Element {
  return (
    <div className={props.compact ? "metric compact" : "metric"}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function Field(props: {
  label: string;
  full?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className={props.full ? "field full" : "field"}>
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

function Toggle(props: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}): JSX.Element {
  return (
    <label className="toggle">
      <input
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
        type="checkbox"
      />
      <span>{props.label}</span>
    </label>
  );
}

function Banner(props: {
  tone: "info" | "error";
  message: string;
}): JSX.Element {
  return <div className={props.tone === "error" ? "banner error" : "banner"}>{props.message}</div>;
}
