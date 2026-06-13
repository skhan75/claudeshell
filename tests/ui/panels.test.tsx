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
    expect(frame).toContain("auth.go");
    expect(frame).toContain("mbp-sami");
    expect(frame).toContain("feature/mcp");
  });

  it("renders the TOKEN_USAGE meter with a percent and current / MAX tokens", () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    // 40k context tokens of a 200k window → 20%.
    s.transcript.apply({
      type: "assistant",
      message: { content: [{ type: "text", text: "x" }], usage: { input_tokens: 40_000, output_tokens: 1 } },
    });
    ctx.store.getState().bump();
    const frame = renderWithCtx(<SidePanel />, ctx).lastFrame()!;
    expect(frame).toContain("TOKEN_USAGE");
    expect(frame).toContain("20%");
    expect(frame).toContain("40,000");
    expect(frame).toContain("200,000 MAX");
  });

  it("shows total cost and current-inference (last turn) cost separately", () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    // Two cumulative results: total climbs 0.30 → 0.50, so the last turn cost 0.20.
    s.transcript.apply({ type: "result", subtype: "success", total_cost_usd: 0.3, num_turns: 1 });
    s.transcript.apply({ type: "result", subtype: "success", total_cost_usd: 0.5, num_turns: 2 });
    ctx.store.getState().bump();
    const frame = renderWithCtx(<SidePanel />, ctx).lastFrame()!;
    expect(frame).toContain("COST");
    expect(frame).toContain("$0.50 total");
    expect(frame).toContain("INFER");
    expect(frame).toContain("$0.20 last turn");
  });

  it("shows a filetype icon and right-aligned size for loaded buffers", () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    // Point at a real file so statSync yields a size; package.json always exists.
    s.transcript.contextFiles.add(`${process.cwd()}/package.json`);
    ctx.store.getState().bump();
    const frame = renderWithCtx(<SidePanel />, ctx).lastFrame()!;
    expect(frame).toContain("LOADED BUFFERS");
    expect(frame).toContain("package.json");
    expect(frame).toContain("{}"); // json icon
    expect(frame).toMatch(/\d+kb|\d+b/); // a size label
  });

  it("shows the configured default model before the first turn (no SDK init yet)", () => {
    const ctx = makeCtx();
    // No transcript.apply at all — meta.model is undefined. The panel must fall
    // back to the user's primary configured model (config.models[0]).
    expect(ctx.config.models[0]).toBe("claude-opus-4-8");
    const frame = renderWithCtx(<SidePanel />, ctx).lastFrame()!;
    expect(frame).toContain("claude-opus-4-8");
    expect(frame).not.toContain("MODEL  —");
  });

  it("shows a TAB n/total line and a MSGS count", () => {
    const ctx = makeCtx();
    // Open a second tab so total is 2; activate the first so we read TAB 1/2.
    ctx.manager.create();
    ctx.manager.activate(0);
    const s = ctx.manager.active!;
    // Two user/assistant blocks → MSGS 2 (tool/info/thinking blocks excluded).
    s.transcript.addUser("hello");
    s.transcript.apply({
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }], usage: { input_tokens: 10, output_tokens: 2 } },
    });
    ctx.store.getState().bump();
    const frame = renderWithCtx(<SidePanel />, ctx).lastFrame()!;
    expect(frame).toContain("1/2");
    expect(frame).toContain("MSGS");
    expect(frame).toMatch(/MSGS\s+2/);
  });

  it("lists every open session/terminal in an AGENTS section with status", () => {
    const ctx = makeCtx();
    ctx.manager.active!.title = "refactor parser";
    ctx.manager.create(); // a second agent
    ctx.manager.activate(0);
    ctx.store.getState().bump();
    const frame = renderWithCtx(<SidePanel />, ctx).lastFrame()!;
    expect(frame).toContain("AGENTS");
    expect(frame).toContain("refactor parser");
    expect(frame).toContain("idle"); // each agent shows its status
  });

  it("surfaces a running-tools ACTIVE indicator", () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    s.transcript.apply({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] },
    });
    ctx.store.getState().bump();
    const frame = renderWithCtx(<SidePanel />, ctx).lastFrame()!;
    expect(frame).toContain("ACTIVE");
    expect(frame).toContain("running");
  });

  it("relabels the permission mode as PERMS", () => {
    const ctx = makeCtx();
    seed(ctx);
    const frame = renderWithCtx(<SidePanel />, ctx).lastFrame()!;
    expect(frame).toContain("PERMS");
    expect(frame).toContain("default");
    expect(frame).not.toContain("MODE ");
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

  // FIX 4 pinning: long model id + many MCP servers + long branch must never produce more than one line.
  it("never wraps to more than one line with very long content", () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    // Long model id, multiple MCP servers, long branch.
    s.transcript.apply({
      type: "system",
      subtype: "init",
      session_id: "x",
      model: "claude-opus-very-long-model-name-with-extra-description-v99",
      mcp_servers: [
        { name: "vibedrift", status: "connected" },
        { name: "playwright", status: "connected" },
        { name: "google-drive", status: "connected" },
        { name: "gmail-mcp-server", status: "connected" },
      ],
      slash_commands: [],
    });
    s.transcript.apply({
      type: "assistant",
      message: { content: [{ type: "text", text: "x" }], usage: { input_tokens: 12345, output_tokens: 678 } },
    });
    ctx.store.getState().setHostStats({
      hostname: "my-very-long-hostname",
      platform: "darwin",
      memUsedPct: 77,
      uptimeSec: 3600,
      branch: "feature/very-long-branch-name-that-could-overflow-strip",
    });
    ctx.store.getState().bump();
    const frame = renderWithCtx(<TelemetryStrip />, ctx).lastFrame()!;
    // The rendered output must be a single line (no newline characters).
    expect(frame).not.toContain("\n");
  });
});

describe("format edge cases", () => {
  it("fmtUptime shows minutes under an hour", () => {
    expect(fmtUptime(1800)).toBe("30m");
  });
  it("bar clamps out-of-range and non-finite pct", () => {
    expect(bar(150, 4)).toBe("▓▓▓▓");
    expect(bar(-10, 4)).toBe("░░░░");
    expect(bar(Number.NaN, 4)).toBe("░░░░");
  });
  it("fmtK boundaries", () => {
    expect(fmtK(999)).toBe("999");
    expect(fmtK(1000)).toBe("1.0k");
    expect(fmtK(1_200_000)).toBe("1.2M");
  });
});

describe("SidePanel edge cases", () => {
  it("renders cleanly with zero data", () => {
    const ctx = makeCtx();
    const frame = renderWithCtx(<SidePanel />, ctx).lastFrame()!;
    expect(frame).toContain("(no files yet)");
    // Fresh session shows the configured default model, not a placeholder dash.
    expect(frame).toContain("claude-opus-4-8");
    expect(frame).not.toContain("MODEL  —");
    expect(frame).toContain("0%");
  });
  it("clamps the context percent label at 100", () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    s.transcript.apply({
      type: "assistant",
      message: { content: [{ type: "text", text: "x" }], usage: { input_tokens: 500_000, cache_read_input_tokens: 0, output_tokens: 1 } },
    });
    ctx.store.getState().bump();
    const frame = renderWithCtx(<SidePanel />, ctx).lastFrame()!;
    expect(frame).toContain("100%");
    expect(frame).not.toMatch(/\d{3,}%.*\d/);
  });
});
