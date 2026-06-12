import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import type { HostStats } from "./types.js";

const pExecFile = promisify(execFile);

export type GitExec = (cwd: string) => Promise<string>;

const realGitExec: GitExec = async (cwd) => {
  const { stdout } = await pExecFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return stdout;
};

export class SystemMonitor {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private cwd: string, private gitExec: GitExec = realGitExec) {}

  async read(): Promise<HostStats> {
    let branch: string | null = null;
    try {
      branch = (await this.gitExec(this.cwd)).trim() || null;
    } catch {
      branch = null;
    }
    return {
      hostname: os.hostname(),
      platform: `${os.platform()} ${os.release()}`,
      memUsedPct: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
      uptimeSec: Math.round(os.uptime()),
      branch,
    };
  }

  start(intervalMs: number, cb: (stats: HostStats) => void): void {
    this.stopped = false;
    const tick = async () => {
      try {
        const stats = await this.read();
        if (!this.stopped) cb(stats);
      } catch {
        // read() never throws by design; belt-and-braces
      }
      if (!this.stopped) this.timer = setTimeout(tick, intervalMs);
    };
    void tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
