import { describe, it, expect } from "vitest";
import { Transcript } from "../../src/core/transcript.js";

describe("Transcript", () => {
  it("captures init metadata", () => {
    const t = new Transcript();
    t.apply({
      type: "system", subtype: "init", session_id: "sess-1", model: "claude-opus-4-8",
      mcp_servers: [{ name: "vibedrift", status: "connected" }],
      slash_commands: ["/commit", "/review"],
    });
    expect(t.meta.model).toBe("claude-opus-4-8");
    expect(t.meta.mcpServers[0].name).toBe("vibedrift");
    expect(t.meta.slashCommands).toContain("/commit");
  });

  it("replaces streaming text on partial_assistant, finalizes on assistant", () => {
    const t = new Transcript();
    t.addUser("hello");
    t.apply({ type: "partial_assistant", message: { content: [{ type: "text", text: "Hel" }] } });
    t.apply({ type: "partial_assistant", message: { content: [{ type: "text", text: "Hello there" }] } });
    let last = t.blocks[t.blocks.length - 1];
    expect(last).toMatchObject({ kind: "assistant", text: "Hello there", streaming: true });

    t.apply({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello there!" }],
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 },
        model: "claude-opus-4-8",
      },
    });
    last = t.blocks[t.blocks.length - 1];
    expect(last).toMatchObject({ kind: "assistant", text: "Hello there!", streaming: false });
    expect(t.usage.inputTokens).toBe(100);
    expect(t.usage.outputTokens).toBe(20);
    expect(t.usage.cacheReadTokens).toBe(50);
    expect(t.blocks.filter((b) => b.kind === "assistant")).toHaveLength(1);
  });

  it("creates tool blocks, harvests context files, and marks tools done on tool_result", () => {
    const t = new Transcript();
    t.apply({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/p/auth.go" } }] },
    });
    expect(t.blocks[t.blocks.length - 1]).toMatchObject({ kind: "tool", name: "Edit", status: "running" });
    expect([...t.contextFiles]).toContain("/p/auth.go");

    t.apply({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "x" }] } });
    expect(t.blocks[t.blocks.length - 1]).toMatchObject({ kind: "tool", status: "done" });
  });

  it("updates cost and turns from result messages", () => {
    const t = new Transcript();
    t.apply({ type: "result", subtype: "success", total_cost_usd: 0.42, num_turns: 3 });
    expect(t.usage.costUsd).toBeCloseTo(0.42);
    expect(t.usage.turns).toBe(3);
  });

  it("appends raw stream_event text deltas (installed-SDK shape)", () => {
    const t = new Transcript();
    t.apply({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } });
    t.apply({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } } });
    expect(t.blocks[t.blocks.length - 1]).toMatchObject({ kind: "assistant", text: "Hello", streaming: true });
  });

  it("starts a new assistant block when streaming resumes after a tool block", () => {
    const t = new Transcript();
    t.apply({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "checking" } } });
    t.apply({ type: "assistant", message: { content: [{ type: "text", text: "checking" }, { type: "tool_use", id: "tu1", name: "Read", input: { file_path: "/a" } }] } });
    t.apply({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "found it" } } });
    const kinds = t.blocks.map((b) => b.kind);
    expect(kinds).toEqual(["assistant", "tool", "assistant"]);
  });

  it("marks ALL parallel tools done from one user message with multiple tool_results", () => {
    const t = new Transcript();
    t.apply({
      type: "assistant",
      message: { content: [
        { type: "tool_use", id: "tu1", name: "Read", input: { file_path: "/a" } },
        { type: "tool_use", id: "tu2", name: "Grep", input: {} },
      ] },
    });
    t.apply({ type: "user", message: { content: [
      { type: "tool_result", tool_use_id: "tu2" },
      { type: "tool_result", tool_use_id: "tu1" },
    ] } });
    const tools = t.blocks.filter((b) => b.kind === "tool");
    expect(tools.every((b) => b.kind === "tool" && b.status === "done")).toBe(true);
  });

  it("contextTokens reflects the LAST assistant message, not the sum", () => {
    const t = new Transcript();
    t.apply({ type: "assistant", message: { content: [{ type: "text", text: "a" }], usage: { input_tokens: 50_000, cache_read_input_tokens: 10_000, output_tokens: 1 } } });
    t.apply({ type: "assistant", message: { content: [{ type: "text", text: "b" }], usage: { input_tokens: 60_000, cache_read_input_tokens: 20_000, output_tokens: 1 } } });
    expect(t.usage.contextTokens).toBe(80_000);
    expect(t.usage.inputTokens).toBe(110_000); // cumulative spend unchanged
  });

  it("contextTokens includes cache_creation_input_tokens (FIX 1 pinning)", () => {
    const t = new Transcript();
    t.apply({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "x" }],
        usage: { input_tokens: 40_000, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 30_000, output_tokens: 1 },
      },
    });
    expect(t.usage.contextTokens).toBe(80_000);
  });

  it("assistant message with error field appends an info block (FIX 2a pinning)", () => {
    const t = new Transcript();
    t.apply({
      type: "assistant",
      message: { content: [], usage: undefined },
      error: "authentication_failed",
    } as unknown as Parameters<Transcript["apply"]>[0]);
    const infos = t.blocks.filter((b) => b.kind === "info");
    expect(infos.length).toBeGreaterThan(0);
    expect(infos.some((b) => b.kind === "info" && b.text.includes("authentication_failed"))).toBe(true);
  });

  it("result message with error subtype and errors array includes subtype and errors (FIX 2b pinning)", () => {
    const t = new Transcript();
    t.apply({
      type: "result",
      subtype: "error_max_turns",
      total_cost_usd: 0,
      num_turns: 1,
      errors: ["boom"],
    } as unknown as Parameters<Transcript["apply"]>[0]);
    const infos = t.blocks.filter((b) => b.kind === "info");
    expect(infos.length).toBeGreaterThan(0);
    const text = infos[infos.length - 1];
    expect(text.kind === "info" && text.text.includes("error_max_turns")).toBe(true);
    expect(text.kind === "info" && text.text.includes("boom")).toBe(true);
  });
});
