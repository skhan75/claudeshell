import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { cleanup as cleanupInk } from "ink-testing-library";
import { InputBar } from "../../src/ui/InputBar.js";
import { PillBar } from "../../src/ui/PillBar.js";
import { renderWithCtx, makeCtx, tick } from "./helpers.js";

afterEach(cleanupInk);

describe("InputBar", () => {
  it("types and submits a prompt to the active session", async () => {
    const ctx = makeCtx();
    const { stdin } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("hi claude");
    await tick();
    stdin.write("\r");
    await tick();
    const blocks = ctx.manager.active!.transcript.blocks;
    expect(blocks[0]).toMatchObject({ kind: "user", text: "hi claude" });
  });

  it("autocompletes slash commands with tab", async () => {
    const ctx = makeCtx();
    ctx.manager.active!.transcript.apply({
      type: "system", subtype: "init", slash_commands: ["/commit", "/review"],
    });
    ctx.store.getState().bump();
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("/com");
    await tick();
    expect(lastFrame()).toContain("/commit");
    stdin.write("\t");
    await tick();
    expect(lastFrame()).toContain("❯ /commit");
  });

  it("tab on empty input hands focus to pills", async () => {
    const ctx = makeCtx();
    const { stdin } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("\t");
    await tick();
    expect(ctx.store.getState().focus).toBe("pills");
  });

  it("ranks slash prefix matches first (slash excluded from scoring)", async () => {
    const ctx = makeCtx();
    ctx.manager.active!.transcript.apply({
      type: "system", subtype: "init", slash_commands: ["/xcom", "/commit"],
    });
    ctx.store.getState().bump();
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("/com");
    await tick();
    const frame = lastFrame()!;
    expect(frame.indexOf("/commit")).toBeLessThan(frame.indexOf("/xcom"));
  });

  it("tab on bare @ does not autocomplete blindly", async () => {
    const ctx = makeCtx();
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("read @");
    await tick();
    stdin.write("\t");
    await tick();
    expect(lastFrame()).toContain("❯ read @");
    expect(lastFrame()).not.toContain("@."); // no surprise first-file completion
  });
});

describe("PillBar", () => {
  it("fires the selected pill into the session and returns focus to input", async () => {
    const ctx = makeCtx();
    ctx.store.getState().setFocus("pills");
    const { stdin } = renderWithCtx(<PillBar />, ctx);
    await tick();
    stdin.write("\r"); // fire first default pill: "fix tests"
    await tick();
    const blocks = ctx.manager.active!.transcript.blocks;
    expect(blocks[0]).toMatchObject({ kind: "user" });
    expect((blocks[0] as { text: string }).text).toContain("test");
    expect(ctx.store.getState().focus).toBe("input");
  });
});
