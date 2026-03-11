import fs from "fs-extra";

import type { BrowserSession } from "../browser/session.js";
import { openPersistentSession } from "../browser/session.js";
import { ensureRuntimeDirs, loadConfig } from "../config.js";
import type { LoginStatus } from "../types.js";

async function profileHasState(profilePath: string): Promise<boolean> {
  if (!(await fs.pathExists(profilePath))) {
    return false;
  }

  const entries = await fs.readdir(profilePath);
  return entries.length > 0;
}

export class AuthService {
  private activeSession?: BrowserSession;

  public constructor(private readonly configPath: string) {}

  public async checkStatus(): Promise<LoginStatus> {
    const config = await loadConfig(this.configPath);
    await ensureRuntimeDirs(config.runtime);

    return {
      loggedIn: await profileHasState(config.runtime.profileDir),
      lastCheckedAt: new Date().toISOString(),
      profilePath: config.runtime.profileDir,
      baseUrl: config.baseUrl,
    };
  }

  public async startLogin(): Promise<LoginStatus> {
    if (this.activeSession) {
      return this.checkStatus();
    }

    const config = await loadConfig(this.configPath);
    await ensureRuntimeDirs(config.runtime);
    this.activeSession = await openPersistentSession({
      userDataDir: config.runtime.profileDir,
      baseUrl: config.baseUrl,
      headless: false,
      navigationTimeoutMs: config.timeouts.navigationMs,
    });

    return this.checkStatus();
  }

  public async completeLogin(): Promise<LoginStatus> {
    if (this.activeSession) {
      await this.activeSession.context.close();
      this.activeSession = undefined;
    }

    return this.checkStatus();
  }

  public async dispose(): Promise<void> {
    if (!this.activeSession) {
      return;
    }

    await this.activeSession.context.close();
    this.activeSession = undefined;
  }
}
