import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { SidePanel } from "../../src/ui/SidePanel.js";
import { TelemetryStrip } from "../../src/ui/TelemetryStrip.js";
import { fmtK, fmtUptime, bar } from "../../src/ui/format.js";
import { renderWithCtx, makeCtx, cleanupInk } from "./helpers.js";

afterEach(cleanupInk);

function seed(ctx: ReturnType<typeof makeCtx>) {
  const s = ctx.manager.active!;
  s.transcript.apply({
    type: "system", subtype: "init", session_id: "x", model: "claude-opus-4-8",
    mcp_servers: [{ name: "vibedrift", status: "connected" }], slash_commands: ["/commit"],
  });
  s.transcript.apply({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/auth.go" } }],
      usage: { input_tokens: 36800, output_tokens: 842 },
    },
  });
  s.transcript.apply({ type: "result", subtype: "success", total_cost_usd: 0.42, num_turns: 12 });
  ctx.store.getState().setHostStats({
    hostname: "mbp-sami", platform: "darwin 25.2.0", memUsedPct: 14, uptimeSec: 90000, branch: "feature/mcp",
  });
  ctx.store.getState().bump();
}

describe("format helpers", () => {
  it("formats tokens, uptime, bars", () => {
    expect(fmtK(36800)).toBe("36.8k");
    expect(fmtK(842)).toBe("842");
    expect(fmtUptime(90000)).toBe("1d 1h");
    expect(bar(50, 10)).toBe("▓▓▓▓▓░░░░░");
  });
});

describe("SidePanel", () => {
  it("shows model, tokens, cost, mcp, context files, and host stats", () => {
    const ctx = makeCtx();
    seed(ctx);
    const frame = renderWithCtx(<SidePanel />, ctx).lastFrame()!;
    expect(frame).toContain("claude-opus-4-8");
    expect(frame).toContain("36.8k");
    expect(frame).toContain("$0.42");
    expect(frame).toContain("vibedrift");
    expect(frame).toContain("src/auth.go");
    expect(frame).toContain("mbp-sami");
    expect(frame).toContain("feature/mcp");
  });
});

describe("TelemetryStrip", () => {
  it("compresses the same telemetry into one line", () => {
    const ctx = makeCtx();
    seed(ctx);
    const frame = renderWithCtx(<TelemetryStrip />, ctx).lastFrame()!;
    expect(frame).toContain("claude-opus-4-8");
    expect(frame).toContain("$0.42");
    expect(frame).toContain("feature/mcp");
  });
});
