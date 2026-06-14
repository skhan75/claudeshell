import { describe, it, expect } from "vitest";

const enabled = process.env.OPENSHELL_E2E === "1";

describe.skipIf(!enabled)("e2e smoke (real Claude Code)", () => {
  it("completes a one-turn session and yields a result message", async () => {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const types: string[] = [];
    for await (const msg of query({
      prompt: "Reply with exactly: pong",
      options: { maxTurns: 1, cwd: process.cwd() },
    })) {
      types.push((msg as { type: string }).type);
    }
    expect(types).toContain("result");
  }, 120_000);
});
