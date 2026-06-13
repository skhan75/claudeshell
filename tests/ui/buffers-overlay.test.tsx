import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { BuffersOverlay } from "../../src/ui/BuffersOverlay.js";
import { renderWithCtx, makeCtx, cleanupInk, tick } from "./helpers.js";
import type { PtyLike, SpawnFn } from "../../src/core/terminal.js";

// A no-op fake PTY so terminal tabs never touch node-pty in these tests.
function fakePty(): PtyLike {
  return {
    onData() {},
    onExit() {},
    write() {},
    resize() {},
    kill() {},
  };
}
const fakeSpawn: SpawnFn = () => fakePty();

describe("BuffersOverlay", () => {
  afterEach(cleanupInk);

  it("lists the open tabs by title and marks the active one", async () => {
    const ctx = makeCtx(); // tab 0: "new session"
    ctx.manager.create({ title: "second session" }); // tab 1
    ctx.manager.create({ title: "third session" }); // tab 2 (active)
    ctx.store.getState().bump();
    const { stdin, lastFrame } = renderWithCtx(<BuffersOverlay onClose={() => {}} />, ctx);
    await tick();
    const frame = lastFrame()!;
    // All three tab titles are listed, numbered 1..3.
    expect(frame).toContain("new session");
    expect(frame).toContain("second session");
    expect(frame).toContain("third session");
    expect(frame).toContain("1:");
    expect(frame).toContain("3:");
    // The currently active tab (index 2) carries the ● marker in the list.
    expect(frame).toContain("●");
    // Navigating to the active tab surfaces an "(active)" marker in the preview
    // (width-independent — the list label may be truncated in the narrow column).
    stdin.write("\x1b[B"); // down → item 2
    stdin.write("\x1b[B"); // down → item 3 (the active tab)
    await tick();
    expect(lastFrame()).toContain("(active)");
  });

  it("shows a $ term badge for terminal tabs", async () => {
    const ctx = makeCtx();
    ctx.manager.createTerminal({ spawnFn: fakeSpawn });
    ctx.store.getState().bump();
    const { lastFrame } = renderWithCtx(<BuffersOverlay onClose={() => {}} />, ctx);
    await tick();
    expect(lastFrame()).toContain("$ term");
  });

  it("Enter on a different tab activates it (activeIndex changes)", async () => {
    const ctx = makeCtx(); // tab 0
    ctx.manager.create({ title: "second session" }); // tab 1 (active)
    ctx.store.getState().bump();
    expect(ctx.manager.activeIndex).toBe(1);
    let closed = false;
    const { stdin } = renderWithCtx(
      <BuffersOverlay onClose={() => (closed = true)} />,
      ctx
    );
    await tick();
    // Default highlight is the first item (tab 0). Enter jumps to it.
    stdin.write("\r");
    await tick();
    expect(ctx.manager.activeIndex).toBe(0);
    expect(closed).toBe(true);
  });

  it("fuzzy-typing filters the listed tabs", async () => {
    const ctx = makeCtx(); // tab 0: "new session"
    ctx.manager.create({ title: "alpha buffer" }); // tab 1
    ctx.manager.create({ title: "zeta buffer" }); // tab 2
    ctx.store.getState().bump();
    const { stdin, lastFrame } = renderWithCtx(
      <BuffersOverlay onClose={() => {}} />,
      ctx
    );
    await tick();
    expect(lastFrame()).toContain("alpha buffer");
    expect(lastFrame()).toContain("zeta buffer");
    stdin.write("zeta");
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain("zeta buffer");
    expect(frame).not.toContain("alpha buffer");
  });

  it("Esc calls onClose", async () => {
    let closed = false;
    const { stdin } = renderWithCtx(<BuffersOverlay onClose={() => (closed = true)} />);
    await tick();
    stdin.write("\x1b"); // real ESC byte
    await tick();
    expect(closed).toBe(true);
  });
});
