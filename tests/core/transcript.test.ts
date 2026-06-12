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
});
