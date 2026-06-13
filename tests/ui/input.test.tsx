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

  it("Enter with the @ picker open INSERTS the highlight and does NOT send", async () => {
    const ctx = makeCtx();
    const cwd = ctx.manager.active!.cwd;
    writeFileSync(join(cwd, "CONTRIBUTING.md"), "");
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("@CON");
    await tick();
    expect(lastFrame()).toContain("CONTRIBUTING.md");
    stdin.write("\r"); // Enter selects the highlighted file, must NOT submit
    await tick();
    // No user message was sent: the prompt was completed, not submitted.
    expect(ctx.manager.active!.transcript.blocks).toHaveLength(0);
    // The input now holds the completed @-path with a trailing space.
    expect(lastFrame()).toContain("@CONTRIBUTING.md");
  });

  it("Down arrow moves the @ highlight; Enter inserts the 2nd file", async () => {
    const ctx = makeCtx();
    const cwd = ctx.manager.active!.cwd;
    // Deterministic ordering: prefix-scored so file2 ranks below file1 for "f".
    writeFileSync(join(cwd, "f1.ts"), "");
    writeFileSync(join(cwd, "f2.ts"), "");
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("@f");
    await tick();
    const frame = lastFrame()!;
    const order = ["f1.ts", "f2.ts"].sort(
      (a, b) => frame.indexOf(a) - frame.indexOf(b)
    );
    stdin.write("\x1b[B"); // Down → highlight the 2nd suggestion
    await tick();
    stdin.write("\r"); // Enter inserts the highlighted (2nd) file
    await tick();
    expect(ctx.manager.active!.transcript.blocks).toHaveLength(0);
    expect(lastFrame()).toContain("@" + order[1]);
    expect(lastFrame()).not.toContain("@" + order[0] + " ");
  });

  it("Up arrow clamps the highlight at the top of the @ list", async () => {
    const ctx = makeCtx();
    const cwd = ctx.manager.active!.cwd;
    writeFileSync(join(cwd, "g1.ts"), "");
    writeFileSync(join(cwd, "g2.ts"), "");
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("@g");
    await tick();
    const frame = lastFrame()!;
    const top = ["g1.ts", "g2.ts"].sort(
      (a, b) => frame.indexOf(a) - frame.indexOf(b)
    )[0];
    stdin.write("\x1b[A"); // Up at top → clamps, still on the 1st
    await tick();
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("@" + top);
  });

  it("Down arrow clamps the highlight at the bottom of the @ list", async () => {
    const ctx = makeCtx();
    const cwd = ctx.manager.active!.cwd;
    writeFileSync(join(cwd, "h1.ts"), "");
    writeFileSync(join(cwd, "h2.ts"), "");
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("@h");
    await tick();
    const frame = lastFrame()!;
    const bottom = ["h1.ts", "h2.ts"].sort(
      (a, b) => frame.indexOf(a) - frame.indexOf(b)
    )[1];
    // Three Downs past the end of a 2-item list → clamps at the last item.
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("@" + bottom);
  });

  it("slash picker: Down/Up navigate and Enter inserts without sending", async () => {
    const ctx = makeCtx();
    ctx.manager.active!.transcript.apply({
      type: "system", subtype: "init", slash_commands: ["/commit", "/compact"],
    });
    ctx.store.getState().bump();
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("/com");
    await tick();
    const frame = lastFrame()!;
    const second = ["/commit", "/compact"].sort(
      (a, b) => frame.indexOf(a) - frame.indexOf(b)
    )[1];
    stdin.write("\x1b[B"); // Down → 2nd command
    await tick();
    stdin.write("\r"); // Enter inserts, does NOT send
    await tick();
    expect(ctx.manager.active!.transcript.blocks).toHaveLength(0);
    expect(lastFrame()).toContain("❯ " + second);
  });

  it("Enter still sends when the input is plain text (no @/ token)", async () => {
    const ctx = makeCtx();
    const { stdin } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("just a normal prompt");
    await tick();
    stdin.write("\r");
    await tick();
    const blocks = ctx.manager.active!.transcript.blocks;
    expect(blocks[0]).toMatchObject({ kind: "user", text: "just a normal prompt" });
  });

  it("Esc dismisses the @ picker so the next Enter sends normally", async () => {
    const ctx = makeCtx();
    const cwd = ctx.manager.active!.cwd;
    writeFileSync(join(cwd, "alpha.ts"), "");
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("see @al");
    await tick();
    expect(lastFrame()).toContain("@ files");
    stdin.write("\x1b"); // Esc dismisses the picker
    await tick();
    expect(lastFrame()).not.toContain("@ files");
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
