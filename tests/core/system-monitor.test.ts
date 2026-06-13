import { describe, it, expect } from "vitest";
import { SystemMonitor, type GitExec } from "../../src/core/system-monitor.js";

describe("SystemMonitor", () => {
  it("reads host stats with an injected git exec", async () => {
    const mon = new SystemMonitor("/repo", async () => "feature/mcp\n");
    const stats = await mon.read();
    expect(stats.hostname.length).toBeGreaterThan(0);
    expect(stats.memUsedPct).toBeGreaterThanOrEqual(0);
    expect(stats.memUsedPct).toBeLessThanOrEqual(100);
    expect(stats.branch).toBe("feature/mcp");
  });

  it("returns null branch when git fails (not a repo)", async () => {
    const mon = new SystemMonitor("/repo", async () => {
      throw new Error("not a git repo");
    });
    const stats = await mon.read();
    expect(stats.branch).toBeNull();
  });

  // FIX 1 pinning: a rejecting GitExec (simulating a hung/failed git) still yields branch:null
  it("returns null branch when GitExec rejects (timeout/no-repo simulation)", async () => {
    const hangingGitExec: GitExec = () => new Promise<string>((_, reject) => {
      // Immediately reject to simulate a timed-out or failed git call
      reject(new Error("ETIMEDOUT"));
    });
    const mon = new SystemMonitor("/repo", hangingGitExec);
    const stats = await mon.read();
    expect(stats.branch).toBeNull();
    // The existing catch block handles rejection; this test pins that behavior
    // (The timeout: 2000 option is passed to the real pExecFile — verified by code reading)
  });

  it("CLAUDESHELL_HOST overrides the displayed hostname", async () => {
    const prev = process.env.CLAUDESHELL_HOST;
    process.env.CLAUDESHELL_HOST = "demo-host";
    try {
      const mon = new SystemMonitor("/repo", async () => "main\n");
      expect((await mon.read()).hostname).toBe("demo-host");
    } finally {
      if (prev === undefined) delete process.env.CLAUDESHELL_HOST;
      else process.env.CLAUDESHELL_HOST = prev;
    }
  });

  it("start/stop: ticks repeatedly, never fires cb after stop", async () => {
    let calls = 0;
    const mon = new SystemMonitor("/repo", async () => "main\n");
    await new Promise<void>((resolve) => {
      mon.start(5, () => {
        calls++;
        if (calls === 3) {
          mon.stop();
          resolve();
        }
      });
    });
    const after = calls;
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(after);
  });
});
