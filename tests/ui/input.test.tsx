import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

  it("bare @ shows a live file suggestion and Tab completes to the top file", async () => {
    const ctx = makeCtx();
    const cwd = ctx.manager.active!.cwd;
    writeFileSync(join(cwd, "alpha.ts"), "");
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("read @");
    await tick();
    // proactive: the file row appears for a bare "@" (no Tab yet).
    expect(lastFrame()).toContain("@ files");
    expect(lastFrame()).toContain("alpha.ts");
    stdin.write("\t");
    await tick();
    // Tab completes the @-token to the top file suggestion.
    expect(lastFrame()).toContain("@alpha.ts");
  });

  it("typing @ shows the file suggestions row live before any Tab", async () => {
    const ctx = makeCtx();
    const cwd = ctx.manager.active!.cwd;
    writeFileSync(join(cwd, "readme.md"), "");
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("@");
    await tick();
    expect(lastFrame()).toContain("@ files");
    expect(lastFrame()).toContain("readme.md");
  });

  it("typing @src filters to src files", async () => {
    const ctx = makeCtx();
    const cwd = ctx.manager.active!.cwd;
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "main.ts"), "");
    writeFileSync(join(cwd, "notes.txt"), "");
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("@src");
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain("src/main.ts");
    expect(frame).not.toContain("notes.txt");
  });

  it("goes inert when the session is crashed (resume key cannot pollute input)", async () => {
    const ctx = makeCtx();
    ctx.manager.active!.status = "crashed";
    ctx.store.getState().bump();
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("r");
    await tick();
    expect(lastFrame()).not.toContain("❯ r");
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
