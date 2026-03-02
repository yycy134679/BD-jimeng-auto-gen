import path from "node:path";
import fs from "fs-extra";

import type { StateRecord, TaskStatus } from "../types.js";

interface CheckpointEntry {
  taskKey: string;
  status: TaskStatus;
  runId: string;
  updatedAt: string;
  lastError?: string;
}

type CheckpointMap = Record<string, CheckpointEntry>;

function safeParseJsonLine(line: string): StateRecord | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as StateRecord;
  } catch {
    return undefined;
  }
}

export class StateStore {
  private readonly runsDir: string;

  private readonly checkpointFile: string;

  private readonly latestRunFile: string;

  private checkpoint: CheckpointMap = {};

  public constructor(private readonly stateDir: string) {
    this.runsDir = path.join(stateDir, "runs");
    this.checkpointFile = path.join(stateDir, "checkpoint.json");
    this.latestRunFile = path.join(stateDir, "latest-run.txt");
  }

  public async init(): Promise<void> {
    await fs.ensureDir(this.stateDir);
    await fs.ensureDir(this.runsDir);
    this.checkpoint = await this.loadCheckpointFromDisk();
  }

  public async setLatestRunId(runId: string): Promise<void> {
    await fs.outputFile(this.latestRunFile, `${runId}\n`, "utf8");
  }

  public async getLatestRunId(): Promise<string | undefined> {
    if (!(await fs.pathExists(this.latestRunFile))) {
      return undefined;
    }

    const raw = await fs.readFile(this.latestRunFile, "utf8");
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  public isAlreadySubmitted(taskKey: string): boolean {
    return this.checkpoint[taskKey]?.status === "submitted";
  }

  public async append(record: StateRecord): Promise<void> {
    const runFile = this.resolveRunFile(record.runId);
    await fs.ensureDir(path.dirname(runFile));
    await fs.appendFile(runFile, `${JSON.stringify(record)}\n`, "utf8");

    this.checkpoint[record.taskKey] = {
      taskKey: record.taskKey,
      status: record.status,
      runId: record.runId,
      updatedAt: record.createdAt,
      lastError: record.lastError,
    };

    await fs.outputJson(this.checkpointFile, this.checkpoint, { spaces: 2 });
  }

  public async readRunRecords(runId: string): Promise<StateRecord[]> {
    const runFile = this.resolveRunFile(runId);
    if (!(await fs.pathExists(runFile))) {
      return [];
    }

    const content = await fs.readFile(runFile, "utf8");
    const records = content
      .split("\n")
      .map((line) => safeParseJsonLine(line))
      .filter((record): record is StateRecord => Boolean(record));

    return records;
  }

  public async listRunIds(): Promise<string[]> {
    if (!(await fs.pathExists(this.runsDir))) {
      return [];
    }

    const files = await fs.readdir(this.runsDir);
    return files
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) => file.replace(/\.jsonl$/, ""))
      .sort();
  }

  public resolveRunFile(runId: string): string {
    return path.join(this.runsDir, `${runId}.jsonl`);
  }

  private async loadCheckpointFromDisk(): Promise<CheckpointMap> {
    if (!(await fs.pathExists(this.checkpointFile))) {
      return {};
    }

    try {
      return (await fs.readJson(this.checkpointFile)) as CheckpointMap;
    } catch {
      return {};
    }
  }
}
