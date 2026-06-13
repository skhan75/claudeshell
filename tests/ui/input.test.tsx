import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup as cleanupInk } from "ink-testing-library";
import { InputBar } from "../../src/ui/InputBar.js";
import { renderWithCtx, makeCtx, tick } from "./helpers.js";

afterEach(cleanupInk);

describe("InputBar", () => {
  it("footer shows the keyboard hints and the effective model", async () => {
    const ctx = makeCtx();
    const { lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    // Before any init, the model falls back to the configured default.
    expect(lastFrame()).toContain("Model:");
    expect(lastFrame()).toContain(ctx.config.models[0]);
    expect(lastFrame()).toContain("history");
    expect(lastFrame()).toContain("autocomplete");
    // The clean prompt box has no PROMPT/MODE labels.
    expect(lastFrame()).not.toContain("PROMPT");
    expect(lastFrame()).not.toContain("MODE:");
    // Once the SDK init reports the effective model, the footer reflects it.
    ctx.manager.active!.transcript.apply({ type: "system", subtype: "init", model: "claude-sonnet-4-6" });
    ctx.store.getState().bump();
    await tick();
    expect(lastFrame()).toContain("claude-sonnet-4-6");
  });

  it("↑ recalls the previously submitted prompt", async () => {
    const ctx = makeCtx();
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("first prompt");
    await tick();
    stdin.write("\r"); // submit → pushed to history, input cleared
    await tick();
    expect(lastFrame()).not.toContain("first prompt");
    stdin.write("\x1b[A"); // up arrow → recall
    await tick();
    expect(lastFrame()).toContain("first prompt");
  });

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

  it("typing / shows the real CLI commands from the live init and the picker is navigable", async () => {
    // The SDK populates transcript.meta.slashCommands with the real CLI commands.
    // Apply a live init, then typing "/" surfaces exactly those commands; the picker
    // is navigable (arrow moves the highlight, Enter inserts and does NOT send).
    const ctx = makeCtx();
    ctx.manager.active!.transcript.apply({
      type: "system", subtype: "init", slash_commands: ["/clear", "/model"],
    });
    ctx.store.getState().bump();
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("/");
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain("/clear");
    expect(frame).toContain("/model");
    const second = ["/clear", "/model"].sort(
      (a, b) => frame.indexOf(a) - frame.indexOf(b)
    )[1];
    stdin.write("\x1b[B"); // Down → 2nd command
    await tick();
    stdin.write("\r"); // Enter inserts the highlighted command, does NOT send
    await tick();
    expect(ctx.manager.active!.transcript.blocks).toHaveLength(0);
    expect(lastFrame()).toContain("❯ " + second);
  });

  it("autocompletes a real slash command with tab", async () => {
    const ctx = makeCtx();
    ctx.manager.active!.transcript.apply({
      type: "system", subtype: "init", slash_commands: ["/commit", "/review"],
    });
    ctx.store.getState().bump();
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    // "/commit" is the unambiguous prefix match among the live list.
    stdin.write("/commi");
    await tick();
    expect(lastFrame()).toContain("/commit");
    stdin.write("\t");
    await tick();
    expect(lastFrame()).toContain("❯ /commit");
  });

  it("ranks slash prefix matches first (slash excluded from scoring)", async () => {
    const ctx = makeCtx();
    ctx.manager.active!.transcript.apply({
      type: "system", subtype: "init", slash_commands: ["/xcommit", "/commit"],
    });
    ctx.store.getState().bump();
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    // "commi" is a prefix of "/commit" (prefix bonus) but only a scattered match in
    // "/xcommit", so both appear and "/commit" outranks "/xcommit".
    stdin.write("/commi");
    await tick();
    const frame = lastFrame()!;
    expect(frame.indexOf("/commit")).toBeLessThan(frame.indexOf("/xcommit"));
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
    // "des" is a subsequence of only these two live commands, so the picker shows
    // exactly these two, making navigation deterministic.
    ctx.manager.active!.transcript.apply({
      type: "system", subtype: "init", slash_commands: ["/destroy", "/desktop"],
    });
    ctx.store.getState().bump();
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    await tick();
    stdin.write("/des");
    await tick();
    const frame = lastFrame()!;
    const second = ["/destroy", "/desktop"].sort(
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
