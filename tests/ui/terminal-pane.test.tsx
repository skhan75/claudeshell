import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { TerminalPane } from "../../src/ui/TerminalPane.js";
import { renderWithCtx, makeCtx, cleanupInk, tick } from "./helpers.js";
import type { PtyLike, SpawnFn } from "../../src/core/terminal.js";

// ---------------------------------------------------------------------------
// Fake PTY — records what TerminalPane forwards and lets the test push data in.
// ---------------------------------------------------------------------------

interface FakePty extends PtyLike {
  written: string[];
  push(data: string): void;
}

function makeFakePty(): FakePty {
  const dataHandlers: Array<(data: string) => void> = [];
  const pty: FakePty = {
    written: [],
    onData(cb) {
      dataHandlers.push(cb);
    },
    onExit() {},
    write(data) {
      this.written.push(data);
    },
    resize() {},
    kill() {},
    push(data) {
      for (const h of dataHandlers) h(data);
    },
  };
  return pty;
}

const spawnFor = (pty: FakePty): SpawnFn => () => pty;

// xterm.write() flushes asynchronously; wait a macrotask so the buffer updates.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("TerminalPane", () => {
  afterEach(cleanupInk);

  it("renders the live PTY screen on store bumps", async () => {
    const ctx = makeCtx();
    const pty = makeFakePty();
    ctx.manager.createTerminal({ spawnFn: spawnFor(pty) });
    const { lastFrame } = renderWithCtx(<TerminalPane height={20} />, ctx);

    pty.push("hello\r\nworld");
    await tick();
    await flush();
    await tick();

    const frame = lastFrame()!;
    expect(frame).toContain("hello");
    expect(frame).toContain("world");
    // Title line shows the terminal id.
    expect(frame).toContain(`TERM ${ctx.manager.activeTab!.id}`);
  });

  it("forwards a printable key to the PTY", async () => {
    const ctx = makeCtx();
    const pty = makeFakePty();
    ctx.manager.createTerminal({ spawnFn: spawnFor(pty) });
    const { stdin } = renderWithCtx(<TerminalPane height={20} />, ctx);
    await tick();
    stdin.write("l");
    await tick();
    expect(pty.written).toContain("l");
  });

  it("forwards Enter as a carriage return", async () => {
    const ctx = makeCtx();
    const pty = makeFakePty();
    ctx.manager.createTerminal({ spawnFn: spawnFor(pty) });
    const { stdin } = renderWithCtx(<TerminalPane height={20} />, ctx);
    await tick();
    stdin.write("\r");
    await tick();
    expect(pty.written).toContain("\r");
  });

  it("leader (Ctrl+\\) then 't' creates a terminal and is NOT written to the PTY", async () => {
    const ctx = makeCtx();
    const pty = makeFakePty();
    ctx.manager.createTerminal({ spawnFn: spawnFor(pty) });
    // The leader 't' command calls createTerminal() with no args (would spawn a
    // real PTY); inject the fake spawn so the test never touches node-pty.
    const realCreateTerminal = ctx.manager.createTerminal.bind(ctx.manager);
    ctx.manager.createTerminal = (init) =>
      realCreateTerminal({ spawnFn: spawnFor(makeFakePty()), ...init });
    const tabsBefore = ctx.manager.tabs.length;
    const { stdin } = renderWithCtx(<TerminalPane height={20} />, ctx);
    await tick();
    stdin.write(String.fromCharCode(0x1c)); // leader
    await tick();
    stdin.write("t"); // command: new terminal
    await tick();
    expect(ctx.manager.tabs.length).toBe(tabsBefore + 1);
    // Neither the leader byte nor 't' should have been forwarded to the PTY.
    expect(pty.written).not.toContain("t");
    expect(pty.written).not.toContain("\x1c");
  });

  it("leader then 'b' opens the buffers overlay and is NOT written to the PTY", async () => {
    const ctx = makeCtx();
    const pty = makeFakePty();
    ctx.manager.createTerminal({ spawnFn: spawnFor(pty) });
    const { stdin } = renderWithCtx(<TerminalPane height={20} />, ctx);
    await tick();
    stdin.write(String.fromCharCode(0x1c)); // leader
    await tick();
    stdin.write("b"); // command: buffer switcher
    await tick();
    expect(ctx.store.getState().overlay).toBe("buffers");
    // Neither the leader byte nor 'b' should have reached the PTY.
    expect(pty.written).not.toContain("b");
    expect(pty.written).not.toContain("\x1c");
  });

  it("leader then '1' activates tab 0", async () => {
    const ctx = makeCtx();
    const pty = makeFakePty();
    ctx.manager.createTerminal({ spawnFn: spawnFor(pty) }); // tab index 1 (tab 0 is the makeCtx claude session)
    expect(ctx.manager.activeIndex).toBe(1);
    const { stdin } = renderWithCtx(<TerminalPane height={20} />, ctx);
    await tick();
    stdin.write(String.fromCharCode(0x1c)); // leader
    await tick();
    stdin.write("1"); // activate tab 0
    await tick();
    expect(ctx.manager.activeIndex).toBe(0);
  });

  it("renders null when the active tab is not a terminal", () => {
    const ctx = makeCtx(); // active tab is the claude session
    const { lastFrame } = renderWithCtx(<TerminalPane height={20} />, ctx);
    expect(lastFrame()).toBe("");
  });
});
