import { describe, it, expect } from "vitest";
import { SystemMonitor } from "../../src/core/system-monitor.js";

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
});
